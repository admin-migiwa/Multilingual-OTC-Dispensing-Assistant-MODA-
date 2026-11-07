"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { STOCKED_DRUGS, detectEmergency, type InterviewAnswers, type QuestionId, type StockedDrugId } from "@moda/domain";
import { LANGUAGES, getMessages, isSupportedLanguage, needsAiTranslationNotice, type LanguageCode } from "@moda/i18n";

import { EMPTY_FOLLOW_UP, type FollowUpState } from "./emergency-follow-up";
import { EmergencyGuide, type EmergencyTrigger } from "./emergency-guide";
import { ProductFinder } from "./product-finder";
import { QuestionInput } from "./question-input";
import { ReferralGuide } from "./referral-guide";
import { RuleError, sessionApi, type PatientView } from "./session-api";
import { StaffAfterApprovalPanel } from "./staff-after-approval";
import { TranslationChat, type ChatEmergency } from "./translation-chat";

/**
 * 患者さんの画面（T7c）：言語選択 → 年齢・性別 → 1問ずつの問診 → ほしい薬／症状から探す → その薬の問診 → 薬剤師の確認待ち。
 *
 * - 次に聞く項目と答えの確かめは、すべてサーバー（packages/domain のルール）が行う。画面は返ってきた1問を出すだけ
 *   （CLAUDE.md 絶対に守るルール3）。
 * - 薬剤師用の小さな「緊急の確認を開く」をどの画面にも出す。自由に入力された文は、送る前に端末の中で緊急キーワードを確かめる。
 *   緊急の確認と119番の案内は、サーバーへの通信が失敗しても端末の中だけで出す（ルール2、spec.md 決まったこと No.38）。
 * - 通信が止まったときは、推測で続けず「通信が止まりました」の画面を出し、薬剤師が緊急の確認か受診の案内を選ぶ
 *   （ルール7、docs/backlog.md C-06）。
 */

/** 画面だけで持つ切り替え（流れの選び直し・症状の入力・受診の案内）。どこまで進んだかはサーバーが持つ */
/** reselect：「ほしい薬がある」で、薬を選んだあとの問診の途中から薬を選び直す */
type Mode = "questions" | "choose" | "symptom" | "reselect" | "not_for_sale";

/**
 * 「戻る」（11/7 依頼主の依頼）：患者さんが通ってきた画面を端末の中だけで覚え、1つずつ戻る。
 * - 戻った質問に答え直すと、サーバーの「訂正」として記録に残る（answer の corrected・answers_cleared）。
 *   次に聞く項目はこれまでどおりサーバーが決める（ルール3）。前の答えは画面に出さない（もう一度答えてもらう）。
 * - 問診を進めてよい状態（attributes・interview・drug_selection）の間だけ戻れる。薬剤師が確認を始めたあと・承認のあと・
 *   緊急の確認のあとは、ここでは戻らない（承認と販売記録を守るため。ルール1・6）。
 */
type Step = { kind: "question"; id: QuestionId } | { kind: "choose" } | { kind: "symptom" } | { kind: "drug" };
const EDITABLE_STATUSES: readonly string[] = ["attributes", "interview", "drug_selection"];

export function LanguageStart() {
  const [language, setLanguage] = useState<LanguageCode | null>(null);
  const [view, setView] = useState<PatientView | null>(null);
  const [mode, setMode] = useState<Mode>("questions");
  const [busy, setBusy] = useState(false);
  /** サーバーから新しい内容を受け取った回数（薬剤師用の欄に読み直しを知らせる） */
  const [revision, setRevision] = useState(0);
  const [networkDown, setNetworkDown] = useState(false);
  const [notUnderstood, setNotUnderstood] = useState(false);
  /** 接客の記録がなくなった（サーバーの再起動など）か、終了済み。最初からやり直すしかない */
  const [sessionLost, setSessionLost] = useState(false);
  /** null：緊急の確認・案内を出していない */
  const [emergency, setEmergency] = useState<EmergencyTrigger | null>(null);
  /** いま出している緊急の確認（画面から外れたチャットが、あとから届いた答えで呼んでくるときに、最新の値を見るため） */
  const emergencyRef = useRef<EmergencyTrigger | null>(null);
  emergencyRef.current = emergency;
  /** 緊急の確認で聞いた答えと観察の印（判断のときにサーバーの記録に残す） */
  const [followUp, setFollowUp] = useState<FollowUpState>(EMPTY_FOLLOW_UP);
  /** サーバーの記録に残せなかったとき（表示は続ける。薬剤師に知らせる） */
  const [recordFailed, setRecordFailed] = useState(false);
  /** 緊急キーワードの判定に使う年齢（Q01 の答え。こどもの項目を使うかを決める） */
  const age = useRef<number | undefined>(undefined);
  /** 「119番の案内を出す」をサーバーの記録に残せたか（残せたら、その接客は終わっている） */
  const show119Recorded = useRef(false);
  /** 「119番の案内を出す」の記録の通信（取り消しは、この記録が終わってから行う） */
  const show119Pending = useRef<Promise<void>>(Promise.resolve());
  /** 住所の ?session= から読み直している接客（読み直しが済むまでは、新しい接客を始めずにこの接客を読み直す） */
  const restoringId = useRef<string | null>(null);
  /**
   * 薬剤師の確認画面から緊急の確認を開いたときの、後ろで動く記録の処理。緊急の確認を記録できたら、その接客の内容になる
   * （記録できなければ null）。薬剤師の判断は、この記録が終わってから残す（記録の順番を守るため）
   */
  const pendingOpen = useRef<Promise<PatientView | null> | null>(null);
  /** 通ってきた画面（「戻る」で1つずつ戻る） */
  const [trail, setTrail] = useState<readonly Step[]>([]);
  /** 「戻る」で戻って、いま出している画面（null：サーバーが決めた画面をそのまま出す） */
  const [revisit, setRevisit] = useState<Step | null>(null);

  /** サーバーを呼び、結果で画面を進める。通信が止まったら「通信が止まりました」の画面にする。onDone は受け付けられたときだけ呼ぶ */
  async function run(action: () => Promise<PatientView>, onDone?: (next: PatientView) => void): Promise<void> {
    setBusy(true);
    setNotUnderstood(false);
    try {
      const next = await action();
      setView(next);
      onDone?.(next);
      setRevision((r) => r + 1);
      // 緊急キーワードの確認に使う年齢は、サーバーが受け取った答えにそろえる（断られた値を端末に残さない。C-13）
      age.current = next.age ?? undefined;
      setNetworkDown(false);
    } catch (error: unknown) {
      if (error instanceof RuleError && (error.code === "SESSION_NOT_FOUND" || error.code === "SESSION_ALREADY_ENDED")) {
        setSessionLost(true);
      } else if (error instanceof RuleError && error.code === "INVALID_TRANSITION" && view !== null) {
        // 画面とサーバーの状態がずれた（例：緊急の判断の記録だけ通信に失敗した）。サーバーの状態を読み直して合わせる
        try {
          const latest = await sessionApi.get(view.id);
          setView(latest);
          if (latest.status === "emergency_review") setEmergency({ kind: "staff" });
          // 119番の案内で接客が終わっていたら、先に進めず「すでに終わっています」の画面にする
          if (latest.status === "emergency_ended") setSessionLost(true);
        } catch {
          setNetworkDown(true);
        }
      } else if (error instanceof RuleError) {
        // 決められた形でない答えなど。推測で進めず、同じ質問をもう一度出す
        setNotUnderstood(true);
      } else {
        setNetworkDown(true);
      }
    } finally {
      setBusy(false);
    }
  }

  /** 読み直した接客の言語と年齢を画面に戻す（年齢は、緊急キーワードの確認で子どもの項目を使うかを決める） */
  function restoreBasics(latest: PatientView) {
    setLanguage(latest.language);
    age.current = latest.age ?? undefined;
  }

  /** 読み直した接客を、状態に合わせて画面に出す（緊急を確認中なら緊急の確認、119番の案内で終わっていれば「終わっています」） */
  function applyRestored(latest: PatientView): PatientView {
    restoreBasics(latest);
    restoringId.current = null;
    clearSteps(); // 読み直した接客では、通ってきた画面がわからないので、ここから先だけを覚える
    if (latest.status === "emergency_review") setEmergency({ kind: "staff" });
    if (latest.status === "emergency_ended") setSessionLost(true);
    return latest;
  }

  // 薬剤師の確認画面（/pharmacist/[id]）から戻ったときは、住所の ?session= の接客を読み直して続ける（T8a）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("session");
    if (!id) return;
    restoringId.current = id;

    if (params.get("emergency") === "staff") {
      // 薬剤師の確認画面の「緊急の確認を開く」から来た（CLAUDE.md ルール2）。通信を待たずに、すぐに緊急の確認を出す。
      // 住所から印を外し、読み直しでもう一度開かないようにする
      const lang = params.get("lang");
      if (lang !== null && isSupportedLanguage(lang)) setLanguage(lang);
      setEmergency({ kind: "staff" });
      setRecordFailed(false);
      show119Recorded.current = false;
      window.history.replaceState(null, "", `/?session=${encodeURIComponent(id)}`);
      pendingOpen.current = (async () => {
        try {
          const latest = await sessionApi.get(id);
          restoreBasics(latest);
          const opened = latest.status === "emergency_review" ? latest : await sessionApi.openEmergency(id, { trigger: "staff" });
          setView(opened);
          // restoringId はここでは消さない（画面が描き直される前に「緊急ではない」が押されても、新しい接客を始めないため）
          return opened;
        } catch {
          // 記録に残せなかった（通信が止まっている、接客が終わっているなど）。案内はこのまま出せる
          setRecordFailed(true);
          return null;
        }
      })();
      return;
    }

    void run(async () => applyRestored(await sessionApi.get(id)));
  }, []);

  function chooseLanguage(code: LanguageCode) {
    if (busy) return; // 読み直しなどの通信の途中では受け付けない（同じ接客の読み直しが重ならないように）
    setLanguage(code);
    // 住所の ?session= の接客を読み直せていない（通信が止まっていたなど）ときは、新しい接客を始めずに読み直す
    const restoring = restoringId.current;
    if (restoring !== null) {
      void run(async () => applyRestored(await sessionApi.get(restoring)));
      return;
    }
    void run(() => sessionApi.start(code));
  }

  /** 次の画面に進んだときに、いまの画面を覚える */
  function stepForward(step: Step) {
    setTrail((prev) => [...prev, step]);
    setRevisit(null);
  }

  function clearSteps() {
    setTrail([]);
    setRevisit(null);
  }

  /** 最初の質問から「戻る」：言語の選択に戻る（始めた接客はそのまま置いておき、言語を選ぶと新しい接客を始める） */
  function backToLanguage() {
    clearSteps();
    setView(null);
    setMode("questions");
    setNotUnderstood(false);
    restoringId.current = null;
    pendingOpen.current = null;
    window.history.replaceState(null, "", "/");
    setLanguage(null);
  }

  // 「戻る」：問診を進めてよい状態の間だけ。通ってきた画面がなければ、年齢・性別の質問からは言語の選択に戻る
  const editable = view !== null && EDITABLE_STATUSES.includes(view.status);
  const goBack: (() => void) | null = !editable
    ? null
    : trail.length > 0
      ? () => {
          setRevisit(trail[trail.length - 1] ?? null);
          setTrail(trail.slice(0, -1));
          setMode("questions");
          setNotUnderstood(false);
        }
      : view.status === "attributes"
        ? backToLanguage
        : null;

  /** 緊急の確認を開く。表示はすぐに切り替え、記録は通信できれば残す */
  function openEmergency(trigger: EmergencyTrigger) {
    setEmergency(trigger);
    setRecordFailed(false);
    show119Recorded.current = false;
    if (view === null) return;
    sessionApi
      .openEmergency(view.id, {
        trigger: trigger.kind,
        matchedRuleIds: trigger.kind === "keyword" ? trigger.hits.map((h) => h.id) : [],
        inputText: trigger.kind === "keyword" ? trigger.text : null,
      })
      .catch(() => setRecordFailed(true));
  }

  /**
   * 翻訳のチャットが緊急を知らせたとき（backlog C-09）。画面を緊急の確認に切り替えるだけにする。
   * サーバーは翻訳の処理の中で緊急の確認を開いている（開き済みのところに /emergency を呼ぶと INVALID_TRANSITION になる）ので、ここでは呼ばない。
   * kind "keyword" は、通信がなくても出すための端末の中の知らせ（記録できていなければ、判断のときに「記録に残せていません」を出す）
   */
  function onChatEmergency(found: ChatEmergency) {
    // チャットは、端末の中のキーワード（keyword）と、サーバーが開いた知らせ（server）の2回知らせることがある。
    // すでに緊急の確認を出していれば、根拠の表示（入力した文・当てはまった項目）や 119番の記録の状態を上書きしない
    // （チャットは画面から外れても、届いた答えで呼んでくるため、前の値を見て決める）
    const next: EmergencyTrigger =
      found.kind === "keyword" ? { kind: "keyword", text: found.text, hits: found.hits } : { kind: "staff" };
    if (emergencyRef.current !== null) return;
    emergencyRef.current = next;
    setEmergency(next);
    setRecordFailed(false);
    show119Recorded.current = false;
  }

  /** 自由に入力された文に緊急キーワードがあれば、緊急の確認に切り替えて true を返す */
  function checkFreeText(text: string): boolean {
    if (language === null) return false;
    // 薬剤師が一度緊急の確認をして「緊急ではない」と判断した接客では、以降はキーワードで自動に切り替えない。
    // 必要なら薬剤師が「緊急の確認を開く」を押す（11/6 依頼主の判断。CLAUDE.md ルール2・spec.md No.38 の例外）
    if (view?.emergencyCleared === true) return false;
    const detection = detectEmergency(text, { language, age: age.current });
    if (!detection.isEmergency) return false;
    openEmergency({ kind: "keyword", text, hits: detection.hits });
    return true;
  }

  /** 薬剤師の判断を記録に残す（追加の答えを先に残す） */
  async function recordDecision(decision: "show_119" | "not_emergency"): Promise<PatientView | null> {
    // 薬剤師の確認画面から開いて、まだ画面に接客がないときは、緊急の確認の記録が終わるのを待って、その接客に残す
    const id = view?.id ?? (await pendingOpen.current)?.id ?? null;
    if (id === null) return null;
    const answers: Record<string, string> = {};
    for (const [key, value] of Object.entries(followUp.answers)) {
      if (typeof value === "string") answers[key] = value;
    }
    await sessionApi.recordFollowUp(id, { answers, scale: followUp.scale, observedRuleIds: [...followUp.observed] });
    return sessionApi.decideEmergency(id, decision);
  }

  if (emergency !== null) {
    return (
      <>
        {recordFailed ? (
          <p lang="ja" className="rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-700">
            緊急の確認を記録に残せていません（通信が止まっているなど。案内はこのまま出せます）。
          </p>
        ) : null}
        <EmergencyGuide
          language={language}
          onLanguageChange={setLanguage}
          trigger={emergency}
          followUp={followUp}
          onFollowUpChange={setFollowUp}
          onShowGuide={() => {
            if (show119Recorded.current) return; // すでに記録した（2回目の押下）。案内はそのまま出す
            show119Pending.current = recordDecision("show_119")
              .then((result) => {
                if (result !== null) show119Recorded.current = true;
              })
              .catch(() => {
                // 通信の失敗でも、記録の順番のずれ（緊急の確認を開いた記録がまだ届いていない）でも、薬剤師に知らせる
                setRecordFailed(true);
              });
          }}
          onCancelGuide={async () => {
            // 押し間違い：119番の案内を取り消し、押す前の薬剤師の確認に戻る（11/6 依頼主の判断）。
            // 「緊急ではない」の判断ではないので、以降の緊急キーワードの確認はそのまま続く
            await show119Pending.current; // 記録の途中なら、記録が終わってから取り消す
            // 薬剤師の確認画面から開いて、押した時点で画面に接客がなかったときも、緊急の確認を記録した接客で取り消す
            const id = view?.id ?? (await pendingOpen.current)?.id ?? null;
            if (!show119Recorded.current || id === null) return true; // 記録できていない（通信が止まっていた）ので画面だけ戻す
            try {
              setView(await sessionApi.cancelEmergency119(id));
              show119Recorded.current = false;
              return true;
            } catch {
              return false; // 取り消しを記録できなかった。案内は出したままにする
            }
          }}
          onReturn={() => {
            setEmergency(null);
            setFollowUp(EMPTY_FOLLOW_UP);
            if (view === null) {
              // 薬剤師の確認画面から来て、まだ画面に接客がないときは、新しい接客を始めない。
              // 緊急の確認の記録が終わるのを待ち、記録できていれば「緊急ではない」を残す。記録できていなければ読み直す
              // （読み直して緊急を確認中なら、もう一度緊急の確認を出す。安全側）
              const restoring = restoringId.current;
              if (restoring !== null) {
                void run(async () => {
                  const opened = await pendingOpen.current;
                  const decided = opened === null ? null : await recordDecision("not_emergency");
                  return applyRestored(decided ?? (await sessionApi.get(restoring)));
                });
                return;
              }
              // 言語を選ぶ前に開いて、確認の画面で言語を選んだときは、ここから接客を始める
              if (language !== null) void run(() => sessionApi.start(language));
              return;
            }
            const id = view.id;
            restoringId.current = null; // 画面に接客があるので、読み直しは済んでいる
            void run(async () => (await recordDecision("not_emergency")) ?? sessionApi.get(id));
          }}
        />
      </>
    );
  }

  return (
    <>
      <StaffEmergencyButton onOpen={() => openEmergency({ kind: "staff" })} />
      {language === null ? (
        <LanguageSelect onSelect={chooseLanguage} />
      ) : sessionLost ? (
        <SessionLost
          language={language}
          onRestart={() => {
            setSessionLost(false);
            setView(null);
            clearSteps();
            restoringId.current = null;
            pendingOpen.current = null;
            setMode("questions");
            setLanguage(null);
          }}
        />
      ) : networkDown ? (
        <NetworkDown
          language={language}
          onEmergency={() => openEmergency({ kind: "staff" })}
          onNotForSale={() => {
            setNetworkDown(false);
            setMode("not_for_sale");
          }}
          onRetry={() => {
            const restoring = restoringId.current;
            // 住所の ?session= の接客を読み直せていないときは、新しい接客を始めずに、その接客を読み直す
            if (view === null && restoring !== null) void run(async () => applyRestored(await sessionApi.get(restoring)));
            else if (view === null) void run(() => sessionApi.start(language));
            else {
              // 読み直した状態に合わせて画面を出す（緊急を確認中なら緊急の確認に戻す）
              const id = view.id;
              void run(async () => applyRestored(await sessionApi.get(id)));
            }
          }}
        />
      ) : (
        <PatientFrame language={language}>
          {notUnderstood ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-lg">{getMessages(language).interview.notUnderstood}</p>
          ) : null}
          <PatientBody
            language={language}
            view={view}
            mode={mode}
            busy={busy}
            onMode={setMode}
            revisit={revisit}
            onBack={goBack}
            onStartSymptom={() => {
              stepForward({ kind: "choose" });
              setRevisit({ kind: "symptom" });
            }}
            onFreeText={checkFreeText}
            onAnswer={(answers: InterviewAnswers) => {
              if (view === null) return;
              const asked = revisit?.kind === "question" ? revisit.id : view.nextQuestion;
              void run(
                () => sessionApi.answer(view.id, answers),
                () => {
                  if (asked !== null) stepForward({ kind: "question", id: asked });
                },
              );
            }}
            onChooseDrug={(id: StockedDrugId) => {
              if (view === null) return;
              setMode("questions");
              void run(
                () => sessionApi.chooseDrugs(view.id, [id]),
                () => stepForward({ kind: "drug" }),
              );
            }}
            onChooseProduct={() => {
              if (view === null) return;
              setMode("questions");
              void run(
                () => sessionApi.chooseRoute(view.id, "product"),
                (next) => {
                  stepForward({ kind: "choose" });
                  // 前に選んだ薬が残っていれば、薬の選び直しの画面を出す（そのまま選べば問診の続きに進む）
                  if (next.selectedDrugs.length > 0) setRevisit({ kind: "drug" });
                },
              );
            }}
            onChatEmergency={onChatEmergency}
            onUnderstanding={(answer) => {
              if (view === null) return;
              void run(() => sessionApi.answerUnderstanding(view.id, answer));
            }}
            onFeedback={(rating) => {
              if (view === null) return;
              void run(() => sessionApi.giveFeedback(view.id, rating));
            }}
            revision={revision}
            onReload={() => {
              if (view === null) return;
              const id = view.id;
              void run(() => sessionApi.get(id));
            }}
            onSymptom={(text: string) => {
              if (view === null) return;
              if (checkFreeText(text)) return; // 緊急キーワードに当てはまったら、緊急の確認に切り替わる
              setMode("questions");
              void run(
                () => sessionApi.chooseRoute(view.id, "symptom", text),
                () => stepForward({ kind: "symptom" }),
              );
            }}
          />
        </PatientFrame>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * 薬剤師用の「緊急の確認を開く」（日本語・小さく右上）。患者さんのどの画面にも出す。
 * 見てわかる緊急・言葉にできない人・通信が止まったときに、薬剤師が手動で緊急の確認を開く。
 */
function StaffEmergencyButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      lang="ja"
      onClick={onOpen}
      className="fixed right-3 top-3 z-10 rounded-lg border border-red-300 bg-white/90 px-3 py-1.5 text-xs font-semibold text-red-800 shadow-sm hover:bg-red-50"
    >
      薬剤師用：緊急の確認を開く
    </button>
  );
}

function LanguageSelect({ onSelect }: { onSelect: (code: LanguageCode) => void }) {
  return (
    <>
      <header className="space-y-2 text-center">
        <p className="text-sm font-semibold tracking-widest text-teal-700">MODA</p>
        <h1 className="text-3xl font-bold">{getMessages("ja").languageSelect.title}</h1>
        <p lang="en" className="text-lg text-slate-600">
          {getMessages("en").languageSelect.title}
        </p>
      </header>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {LANGUAGES.map((lang) => (
          <li key={lang.code}>
            <button
              type="button"
              lang={lang.code}
              onClick={() => onSelect(lang.code)}
              className="flex min-h-20 w-full items-center justify-center rounded-2xl border-2 border-slate-200 px-4 text-xl font-semibold transition hover:border-teal-600 hover:bg-teal-50 focus-visible:outline-4 focus-visible:outline-teal-600"
            >
              {lang.nativeName}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function PatientFrame({ language, children }: { language: LanguageCode; children: ReactNode }) {
  const t = getMessages(language);
  return (
    <section lang={language} className="space-y-8">
      <header className="space-y-1 text-center">
        <p className="text-sm font-semibold tracking-widest text-teal-700">MODA</p>
        <p className="text-base text-slate-500">{t.languageSelect.selected}</p>
      </header>
      {children}
      {needsAiTranslationNotice(language) ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{t.common.aiTranslationNotice}</p>
      ) : null}
    </section>
  );
}

function PatientBody({
  language,
  view,
  mode,
  busy,
  onMode,
  onAnswer,
  onChooseDrug,
  onChooseProduct,
  onSymptom,
  onFreeText,
  onChatEmergency,
  onUnderstanding,
  onFeedback,
  revision,
  onReload,
  revisit,
  onBack,
  onStartSymptom,
}: {
  language: LanguageCode;
  view: PatientView | null;
  mode: Mode;
  busy: boolean;
  onMode: (mode: Mode) => void;
  revisit: Step | null;
  onBack: (() => void) | null;
  onStartSymptom: () => void;
  onAnswer: (answers: InterviewAnswers) => void;
  onChooseDrug: (id: StockedDrugId) => void;
  onChooseProduct: () => void;
  onSymptom: (text: string) => void;
  onFreeText: (text: string) => boolean;
  onChatEmergency: (found: ChatEmergency) => void;
  onUnderstanding: (answer: "understood" | "partly" | "not_understood") => void;
  onFeedback: (rating: "good" | "fair" | "poor") => void;
  revision: number;
  onReload: () => void;
}) {
  // 承認のあと（T10）：説明書・理解の確認・会計案内と評価。承認の前には出さない（状態はサーバーが決める。ルール1）
  const afterApproval =
    view !== null && ["approved", "counseling", "checkout", "completed"].includes(view.status) ? (
      <AfterApprovalPatient
        language={language}
        view={view}
        busy={busy}
        onUnderstanding={onUnderstanding}
        onFeedback={onFeedback}
        revision={revision}
        onReload={onReload}
      />
    ) : null;
  const body = afterApproval ?? (
    <PatientBodyMain
      language={language}
      view={view}
      mode={mode}
      busy={busy}
      onMode={onMode}
      revisit={revisit}
      onBack={onBack}
      onStartSymptom={onStartSymptom}
      onAnswer={onAnswer}
      onChooseDrug={onChooseDrug}
      onChooseProduct={onChooseProduct}
      onSymptom={onSymptom}
      onFreeText={onFreeText}
    />
  );
  // 翻訳のチャット（患者さんと薬剤師が一緒に使う。日本語の見出し・たたんでおく。backlog C-09）。
  // 接客が始まっていて、終わっていないときだけ出す
  const chatOpen = view !== null && mode !== "not_for_sale" && !["completed", "declined", "emergency_ended", "emergency_review"].includes(view.status);
  if (!chatOpen) return body;
  return (
    <>
      {body}
      <details lang="ja" className="rounded-2xl border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          翻訳のチャットを開く（薬剤師と一緒に使う）
        </summary>
        <div className="mt-3">
          <TranslationChat
            sessionId={view.id}
            language={language}
            age={view.age ?? undefined}
            emergencyCleared={view.emergencyCleared}
            emergencyReviewOpen={view.status === "emergency_review"}
            onEmergency={onChatEmergency}
          />
        </div>
      </details>
    </>
  );
}

function PatientBodyMain({
  language,
  view,
  mode,
  busy,
  onMode,
  onAnswer,
  onChooseDrug,
  onChooseProduct,
  onSymptom,
  onFreeText,
  revisit,
  onBack,
  onStartSymptom,
}: {
  language: LanguageCode;
  view: PatientView | null;
  mode: Mode;
  busy: boolean;
  onMode: (mode: Mode) => void;
  onAnswer: (answers: InterviewAnswers) => void;
  onChooseDrug: (id: StockedDrugId) => void;
  onChooseProduct: () => void;
  onSymptom: (text: string) => void;
  onFreeText: (text: string) => boolean;
  revisit: Step | null;
  onBack: (() => void) | null;
  onStartSymptom: () => void;
}) {
  const t = getMessages(language);
  const backButton = onBack ? <BackButton label={t.common.back} busy={busy} onBack={onBack} /> : null;

  // 受診をすすめる案内（T11）：薬剤師の確認画面で「販売しない」を選んだとき、
  // または通信が止まった画面で「受診をすすめる案内を出す」を押したとき（通信なしで出せる）
  if (mode === "not_for_sale" || view?.status === "declined") {
    return <ReferralGuide language={language} />;
  }
  if (view === null) {
    return <p className="text-center text-lg text-slate-500">…</p>;
  }

  // 「ほしい薬がある」で薬を選んだあと：問診の途中でも、薬剤師の確認から「戻る」で薬の選択に戻ったときも、
  // 薬を選び直せる（サーバーの chooseDrugs が受け付ける）
  const canReselect =
    view.route === "product" &&
    view.selectedDrugs.length > 0 &&
    (!view.interviewComplete || view.status === "drug_selection");
  if (mode === "reselect" && canReselect) {
    return <DrugSearch language={language} busy={busy} onChoose={onChooseDrug} onBack={() => onMode("questions")} />;
  }

  // 「戻る」で戻った画面（問診を進めてよい状態の間だけ出す）
  const editable = EDITABLE_STATUSES.includes(view.status);
  if (revisit !== null && editable) {
    if (revisit.kind === "question") {
      return (
        <>
          <QuestionInput
            key={`again-${revisit.id}`}
            language={language}
            questionId={revisit.id}
            busy={busy}
            onSubmit={onAnswer}
            onFreeText={onFreeText}
            packageOptions={view.nextQuestion === revisit.id ? view.packageOptions : null}
          />
          {backButton}
        </>
      );
    }
    if (revisit.kind === "symptom") {
      return <SymptomInput language={language} onSubmit={onSymptom} onBack={onBack ?? (() => onMode("choose"))} />;
    }
    if (revisit.kind === "drug") {
      return <DrugSearch language={language} busy={busy} onChoose={onChooseDrug} onBack={onBack ?? (() => onMode("questions"))} />;
    }
  }
  /** 「戻る」で「ほしい薬がある／症状から探す」に戻っている */
  const choosing = revisit?.kind === "choose" && editable;

  // 問診（年齢・性別から、サーバーが決めた1問ずつ）
  if (view.nextQuestion !== null && !choosing) {
    return (
      <>
        {view.status === "attributes" ? <p className="text-lg text-slate-600">{t.interview.intro}</p> : null}
        <QuestionInput
          key={view.nextQuestion}
          language={language}
          questionId={view.nextQuestion}
          busy={busy}
          onSubmit={onAnswer}
          onFreeText={onFreeText}
          packageOptions={view.packageOptions}
        />
        {canReselect ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMode("reselect")}
            className="rounded-2xl border-2 border-slate-300 px-5 py-3 text-lg font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            {t.start.changeDrug}
          </button>
        ) : null}
        {backButton}
      </>
    );
  }

  // 選んだ薬の項目まで答え終えた、または「症状から探す」で基本の項目を答え終えた → 薬剤師の確認待ち
  const noDrug = view.selectedDrugs.length === 0;
  const waitingStatus = view.status === "drug_selection" || view.status === "pharmacist_review";
  if (!choosing && (view.interviewComplete || (view.route === "symptom" && waitingStatus && noDrug))) {
    return (
      <div className="space-y-4 rounded-2xl bg-teal-50 px-5 py-6">
        <p className="text-2xl font-bold">{t.interview.done}</p>
        <p className="text-lg">{t.pharmacist.waiting}</p>
        {/* 薬剤師用（日本語・小さく）。いまは同じ iPad で開くので、仮にここに置く（T8a） */}
        <a
          lang="ja"
          href={`/pharmacist/${encodeURIComponent(view.id)}`}
          className="inline-block rounded-lg border border-teal-400 bg-white px-3 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-100"
        >
          薬剤師用：確認の画面を開く
        </a>
        {canReselect ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMode("reselect")}
            className="block rounded-2xl border-2 border-slate-300 bg-white px-5 py-3 text-lg font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            {t.start.changeDrug}
          </button>
        ) : null}
        {/* 薬剤師が確認を始める前なら、最後の質問に戻って答え直せる */}
        {backButton}
      </div>
    );
  }

  // 症状から探す：症状を入力（送る前に緊急キーワードを確かめる）→ 基本の項目を1問ずつ
  if (mode === "symptom" && !choosing) {
    return <SymptomInput language={language} onSubmit={onSymptom} onBack={onBack ?? (() => onMode("choose"))} />;
  }

  // ほしい薬がある：薬を探して選ぶ → その薬の判定に使う項目だけを1問ずつ（11/6 の判断）
  if (!choosing && view.route === "product" && noDrug && mode !== "choose") {
    return <DrugSearch language={language} busy={busy} onChoose={onChooseDrug} onBack={onBack ?? (() => onMode("choose"))} />;
  }

  // 年齢・性別を答えた → ほしい薬がある／症状から探す
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t.start.title}</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy}
          onClick={onChooseProduct}
          className="flex min-h-28 flex-col items-start justify-center gap-1 rounded-2xl border-2 border-slate-200 px-5 py-4 text-left transition hover:border-teal-600 hover:bg-teal-50 disabled:opacity-50"
        >
          <span className="text-xl font-semibold">{t.start.haveProduct}</span>
          <span className="text-sm text-slate-600">{t.start.haveProductHint}</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onStartSymptom}
          className="flex min-h-28 flex-col items-start justify-center gap-1 rounded-2xl border-2 border-slate-200 px-5 py-4 text-left transition hover:border-teal-600 hover:bg-teal-50 disabled:opacity-50"
        >
          <span className="text-xl font-semibold">{t.start.findBySymptom}</span>
          <span className="text-sm text-slate-600">{t.start.findBySymptomHint}</span>
        </button>
      </div>
      {backButton}
    </div>
  );
}

/** 「戻る」のボタン（患者さんの言語。iPad で押しやすい高さにする） */
function BackButton({ label, busy, onBack }: { label: string; busy: boolean; onBack: () => void }) {
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={onBack}
        className="min-h-11 px-1 text-lg text-slate-600 underline underline-offset-4 disabled:opacity-50"
      >
        ← {label}
      </button>
    </div>
  );
}

/** 文字の形をそろえる（全角・半角、大文字・小文字、「（架空）」の有無の違いで見落とさないため） */
function normalizeName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[（(]架空[）)]/g, "").replace(/\s/g, "");
}

/** ほしい薬を商品名で探す（取扱薬だけ。写真の読み取りは T12） */
function DrugSearch({
  language,
  busy,
  onChoose,
  onBack,
}: {
  language: LanguageCode;
  busy: boolean;
  onChoose: (id: StockedDrugId) => void;
  onBack: () => void;
}) {
  const t = getMessages(language);
  const [query, setQuery] = useState("");
  /** 写真・商品名の候補から選ばれた薬（薬剤師の確認を待っている。backlog C-10） */
  const [pending, setPending] = useState<StockedDrugId | null>(null);
  const pendingDrug = pending === null ? undefined : STOCKED_DRUGS.find((drug) => drug.id === pending);
  const q = normalizeName(query);
  const matches = q === "" ? STOCKED_DRUGS : STOCKED_DRUGS.filter((drug) => normalizeName(drug.name).includes(q));
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t.start.haveProduct}</h1>
      {/*
        写真・商品名から候補を出す（T12。backlog C-10）。候補のボタンは薬剤師が押すもの（spec.md 決まったこと No.22・CLAUDE.md ルール10）なので、
        選んだらすぐには進めず、薬剤師用の日本語の確認をはさむ。取扱薬でない候補は選べない
      */}
      <ProductFinder
        language={language}
        onChoose={(drugId) => {
          const stocked = STOCKED_DRUGS.find((drug) => drug.id === drugId);
          if (stocked) setPending(stocked.id);
        }}
      />
      {pendingDrug ? (
        <div lang="ja" className="space-y-3 rounded-2xl border-2 border-teal-500 bg-teal-50 p-4">
          <p className="font-semibold">
            薬剤師用：候補「{pendingDrug.name}」で問診を進めますか？（箱やスマホの画面の名前と見比べて、薬剤師が確かめてから押してください）
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => onChoose(pendingDrug.id)}
              className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              薬剤師が確かめた：この薬で進める
            </button>
            <button type="button" onClick={() => setPending(null)} className="rounded-xl border-2 border-slate-300 bg-white px-4 py-2">
              やめる
            </button>
          </div>
        </div>
      ) : null}
      <input
        type="search"
        value={query}
        placeholder={t.start.searchPlaceholder}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-xl"
        autoFocus
      />
      {matches.length === 0 ? (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-lg">{t.start.noMatch}</p>
      ) : (
        <ul className="grid gap-3">
          {matches.map((drug) => (
            <li key={drug.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose(drug.id)}
                className="flex w-full items-center justify-between gap-4 rounded-2xl border-2 border-slate-200 px-5 py-4 text-left hover:border-teal-600 hover:bg-teal-50 disabled:opacity-50"
              >
                {/* 商品名は日本の商品の表記（日本語）のまま出す */}
                <span lang="ja" className="text-xl font-semibold">
                  {drug.name}
                </span>
                <span className="shrink-0 text-base text-teal-800">{t.start.chooseDrug}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onBack} className="min-h-11 px-1 text-lg text-slate-600 underline underline-offset-4">
        ← {t.common.back}
      </button>
    </div>
  );
}

/** 症状から探す（症状を自由に入力。送る前に緊急キーワードを確かめる） */
function SymptomInput({
  language,
  onSubmit,
  onBack,
}: {
  language: LanguageCode;
  onSubmit: (text: string) => void;
  onBack: () => void;
}) {
  const t = getMessages(language);
  const [text, setText] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim() !== "") onSubmit(text.trim());
  }
  return (
    <form onSubmit={submit} className="space-y-6">
      <h1 className="text-3xl font-bold">{t.start.symptomPrompt}</h1>
      <textarea
        value={text}
        maxLength={500}
        onChange={(event) => setText(event.target.value)}
        className="h-36 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-xl"
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={text.trim() === ""}
          className="rounded-2xl bg-teal-700 px-6 py-4 text-xl font-bold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {t.common.next}
        </button>
        <button type="button" onClick={onBack} className="min-h-11 px-1 text-lg text-slate-600 underline underline-offset-4">
          ← {t.common.back}
        </button>
      </div>
    </form>
  );
}

/** 接客の記録がなくなったとき（サーバーの再起動など）・終了済みのとき。推測で続けず、最初からやり直す */
function SessionLost({ language, onRestart }: { language: LanguageCode; onRestart: () => void }) {
  return (
    <section className="space-y-6">
      <p lang={language} className="rounded-2xl border-4 border-amber-500 bg-amber-50 px-5 py-6 text-2xl font-bold">
        {getMessages(language).emergency.staffHelp}
      </p>
      <div lang="ja" className="space-y-3 rounded-2xl border-2 border-slate-300 p-5">
        <p className="text-lg font-bold">
          薬剤師の方へ：この接客の記録が見つからないか、すでに終わっています（サーバーの再起動など）。最初からやり直してください。
        </p>
        <button
          type="button"
          onClick={onRestart}
          className="rounded-2xl bg-slate-800 px-4 py-3 text-lg font-bold text-white hover:bg-slate-900"
        >
          最初からやり直す
        </button>
      </div>
    </section>
  );
}

/** 通信が止まったとき（推測で続けない。薬剤師が緊急の確認か受診の案内を選ぶ） */
function NetworkDown({
  language,
  onEmergency,
  onNotForSale,
  onRetry,
}: {
  language: LanguageCode;
  onEmergency: () => void;
  onNotForSale: () => void;
  onRetry: () => void;
}) {
  const t = getMessages(language);
  return (
    <section className="space-y-6">
      <p lang={language} className="rounded-2xl border-4 border-amber-500 bg-amber-50 px-5 py-6 text-2xl font-bold">
        {t.common.networkError}
      </p>
      <div lang="ja" className="space-y-3 rounded-2xl border-2 border-slate-300 p-5">
        <p className="text-lg font-bold">薬剤師の方へ：通信が止まったため、問診を続けられません。</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onEmergency}
            className="rounded-2xl bg-red-700 px-4 py-4 text-lg font-bold text-white hover:bg-red-800"
          >
            緊急の確認を開く
          </button>
          <button
            type="button"
            onClick={onNotForSale}
            className="rounded-2xl border-2 border-slate-400 px-4 py-4 text-lg font-semibold hover:bg-slate-100"
          >
            受診をすすめる案内を出す
          </button>
        </div>
        <button type="button" onClick={onRetry} className="text-base text-slate-700 underline underline-offset-4">
          {t.common.retry}
        </button>
      </div>
    </section>
  );
}

/**
 * 承認のあとの患者さんの画面（T10）。
 * - approved：薬剤師が説明書を用意している間は「確認しています」
 * - counseling：患者さんの言語の説明書（参考訳。日本語の原文も開ける）と「説明はわかりましたか？」。
 *   下に日本語の「薬剤師用」の欄を置き、薬剤師の画面に戻らずに会計の前の手順の ✓ と会計案内に進める（11/7 依頼主の判断）
 * - checkout：お会計の案内と評価。completed：お礼とお会計の案内
 */
function AfterApprovalPatient({
  language,
  view,
  busy,
  onUnderstanding,
  onFeedback,
  revision,
  onReload,
}: {
  language: LanguageCode;
  view: PatientView;
  busy: boolean;
  onUnderstanding: (answer: "understood" | "partly" | "not_understood") => void;
  onFeedback: (rating: "good" | "fair" | "poor") => void;
  revision: number;
  onReload: () => void;
}) {
  const t = getMessages(language);
  /** 会計案内・お礼の画面から、説明書をもう一度見る（見るだけ。承認・販売記録・状態は変えない） */
  const [leafletAgain, setLeafletAgain] = useState(false);
  const choice =
    "w-full rounded-2xl border-2 border-slate-200 px-5 py-4 text-left text-xl font-semibold hover:border-teal-600 hover:bg-teal-50 disabled:opacity-50";
  const guidanceAgain = view.guidance;
  if (leafletAgain && guidanceAgain && (view.status === "checkout" || view.status === "completed")) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">{t.guidance.title}</h1>
        <p className="whitespace-pre-wrap rounded-2xl bg-slate-50 px-5 py-4 text-lg leading-relaxed">{guidanceAgain.translation}</p>
        <BackButton label={t.common.back} busy={false} onBack={() => setLeafletAgain(false)} />
      </div>
    );
  }
  const leafletAgainButton = guidanceAgain ? (
    <button
      type="button"
      onClick={() => setLeafletAgain(true)}
      className="rounded-2xl border-2 border-slate-300 bg-white px-5 py-3 text-lg font-semibold hover:bg-slate-50"
    >
      {t.guidance.title}
    </button>
  ) : null;
  const pharmacistLink = (
    <a
      lang="ja"
      href={`/pharmacist/${encodeURIComponent(view.id)}`}
      className="inline-block rounded-lg border border-teal-400 bg-white px-3 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-100"
    >
      薬剤師用：確認の画面を開く
    </a>
  );

  if (view.status === "approved") {
    return (
      <div className="space-y-4 rounded-2xl bg-teal-50 px-5 py-6">
        <p className="text-lg">{t.pharmacist.waiting}</p>
        {pharmacistLink}
      </div>
    );
  }

  if (view.status === "counseling") {
    const guidance = view.guidance;
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">{t.guidance.title}</h1>
        {guidance ? (
          <>
            {guidance.printed ? <p className="text-lg">{t.guidance.printed}</p> : null}
            <p className="whitespace-pre-wrap rounded-2xl bg-slate-50 px-5 py-4 text-lg leading-relaxed">{guidance.translation}</p>
            <details lang="ja" className="text-sm text-slate-600">
              <summary>日本語の原文（説明書）</summary>
              <p className="mt-2 whitespace-pre-wrap">{guidance.japanese}</p>
            </details>
          </>
        ) : null}
        {view.understandingConfirmed ? (
          <div className="space-y-3 rounded-2xl bg-teal-50 px-5 py-4">
            <p className="text-lg">{t.pharmacist.waiting}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-2xl font-bold">{t.guidance.understandQuestion}</h2>
            <button type="button" disabled={busy} onClick={() => onUnderstanding("understood")} className={choice}>
              {t.guidance.understandOptions.understood}
            </button>
            <button type="button" disabled={busy} onClick={() => onUnderstanding("partly")} className={choice}>
              {t.guidance.understandOptions.partly}
            </button>
            <button type="button" disabled={busy} onClick={() => onUnderstanding("not_understood")} className={choice}>
              {t.guidance.understandOptions.notUnderstood}
            </button>
            <p className="text-base text-slate-600">{t.guidance.askAgain}</p>
          </div>
        )}
        {/* 薬剤師用（日本語・たたんでおく）：薬剤師の画面に戻らずに、会計の前の手順の ✓ と会計案内に進む（11/7 依頼主の判断） */}
        <StaffAfterApprovalPanel sessionId={view.id} refreshKey={String(revision)} onCheckout={onReload} />
      </div>
    );
  }

  if (view.status === "checkout") {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">{t.checkout.title}</h1>
        <p className="text-xl">{t.checkout.body}</p>
        <div className="space-y-3">
          <h2 className="text-2xl font-bold">{t.feedback.question}</h2>
          <button type="button" disabled={busy} onClick={() => onFeedback("good")} className={choice}>
            {t.feedback.options.good}
          </button>
          <button type="button" disabled={busy} onClick={() => onFeedback("fair")} className={choice}>
            {t.feedback.options.fair}
          </button>
          <button type="button" disabled={busy} onClick={() => onFeedback("poor")} className={choice}>
            {t.feedback.options.poor}
          </button>
        </div>
        {leafletAgainButton}
      </div>
    );
  }

  // completed
  return (
    <div className="space-y-4 rounded-2xl bg-teal-50 px-5 py-6">
      <p className="text-2xl font-bold">{t.feedback.title}</p>
      <p className="text-xl">{t.checkout.body}</p>
      {leafletAgainButton}
    </div>
  );
}
