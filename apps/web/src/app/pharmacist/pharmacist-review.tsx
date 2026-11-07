"use client";

/**
 * 薬剤師の確認画面（T8a。日本語だけ。患者さんには見せない）。
 *
 * - 患者さんの答えの日本語のまとめ（自由に入力された文は原文のまま。翻訳は T13）
 * - 選んだ薬ごとに、その薬のために聞いた項目と、禁忌の判定
 * - 販売する薬を選ぶ（禁忌の薬は選べない。サーバーでも止める。CLAUDE.md 絶対に守るルール4。解除は T9）
 * - 区分ごとの販売手順のチェックリスト（✓ は記録に足していく。✓ がそろうまで承認できない関所は T9）
 * - 「戻る」（薬の選択へ）と「販売しない」（理由は必須。受診案内の画面は T11）
 */

import { useEffect, useState, type ReactNode } from "react";

import {
  OVERRIDE_REASONS,
  SYMPTOM_CATEGORIES,
  matchingSymptomCategories,
  visibleCandidates,
  type SymptomCategoryId,
  type InterviewAnswers, type QuestionId, type SessionStatus, type StockedDrugId, type UndoStep } from "@moda/domain";
import { LANGUAGES } from "@moda/i18n";

import { ModaBrand } from "../decor";
import { NetworkError, RuleError } from "../session-api";
import { TranslationChat, type ChatEmergency } from "../translation-chat";
import { EmergencyRecords } from "./emergency-records";
import { pharmacistApi, type OverrideInput, type PharmacistView } from "./pharmacist-api";

/** 問診の項目名（docs/demo-data/interview-items.md） */
const QUESTION_LABELS: Readonly<Record<QuestionId, string>> = {
  Q01: "年齢",
  Q02: "性別",
  Q03: "妊娠",
  Q03a: "出産予定日まで12週以内か",
  Q04: "授乳中",
  Q05: "体重",
  Q06: "ぜんそくを起こしたことがあるか",
  Q07: "治療中の病気",
  Q08: "薬でアレルギーが出たことがあるか",
  Q09: "いま飲んでいる薬",
  Q10: "薬を飲んだあとに運転する予定",
  Q11: "飲む前後にお酒を飲む予定",
  Q12: "飲む予定の日数",
  Q13: "ソフトコンタクトレンズをつけているか",
  Q14: "貼る場所",
  R01: "ほかの店で同じような薬を買ったか",
  R02: "買いたい個数・包装",
  R03: "複数・大容量が必要な理由",
  R04: "使う目的（症状）",
};

const SEX: Record<string, string> = { male: "男性", female: "女性", other: "その他", no_answer: "答えない" };
const PREGNANCY: Record<string, string> = {
  pregnant: "妊娠している",
  maybe: "妊娠しているかもしれない",
  no: "していない",
  not_applicable: "該当しない",
};
const YES_NO_UNKNOWN: Record<string, string> = { yes: "はい", no: "いいえ", unknown: "わからない" };
const BREASTFEEDING: Record<string, string> = { yes: "はい", no: "いいえ", not_applicable: "該当しない" };
const CONDITIONS: Record<string, string> = {
  gastric_ulcer: "胃潰瘍",
  liver: "肝臓病",
  kidney: "腎臓病",
  heart: "心臓病",
  hypertension: "高血圧",
  glaucoma: "緑内障",
  dialysis: "透析を受けている",
};
const MEDICATIONS: Record<string, string> = {
  cold: "かぜ薬",
  analgesic: "解熱鎮痛薬",
  antihistamine: "アレルギー・鼻炎の薬（抗ヒスタミン）",
  kampo: "漢方",
  prescription: "病院で出された薬（処方薬）",
  other: "その他",
};
const SITES: Record<string, string> = {
  normal: "首・肩・腰など",
  eye_or_mucosa: "目の周り・粘膜の近く",
  eczema_or_wound: "湿疹・かぶれ・傷がある場所",
};
const PACKAGES: Record<string, string> = { small_one: "小箱1個", large_one: "大箱1個", multiple: "複数個" };

const STATUS_LABELS: Partial<Record<SessionStatus, string>> = {
  attributes: "年齢・性別の入力中",
  interview: "問診中",
  drug_selection: "薬の選択",
  pharmacist_review: "薬剤師の確認中",
  emergency_review: "緊急を確認中",
  emergency_ended: "緊急で終了",
  declined: "販売しないで終了",
  approved: "承認済み",
  counseling: "服薬指導中",
  checkout: "会計案内",
  completed: "完了",
};

const ERROR_MESSAGES: Record<string, string> = {
  CONTRAINDICATED_NOT_SELECTABLE: "禁忌の薬は、解除しないと選べません（薬の欄の「禁忌を解除する」から）。",
  QUANTITY_NOT_ALLOWED: "この年齢・個数・包装の組み合わせでは販売できません（18歳未満の大箱・複数個など）。",
  INVALID_TRANSITION: "いまの状態ではこの操作はできません。画面を読み直しました。",
  INTERVIEW_INCOMPLETE: "問診が終わっていません。患者さんの画面に戻って、問診を最後まで進めてください。",
  NO_DRUG_SELECTED: "販売する薬を選んでからチェックしてください。",
  STEP_NOT_YET_AVAILABLE: "この手順は承認の後に記録します（承認の前には ✓ を付けられません）。",
  SESSION_NOT_FOUND: "この接客の記録が見つかりません（サーバーの再起動など）。",
  SESSION_ALREADY_ENDED: "この接客はすでに終わっています。",
  INVALID_REQUEST: "送った内容の形が違います。",
  PROCEDURE_INCOMPLETE_FOR_APPROVAL: "承認の前に必要な販売手順が終わっていません。チェックリストを確かめてください。",
  PIN_INVALID: "PIN が違います。",
  PIN_LOCKED: "PIN を続けて間違えたため、しばらく使えません（5分ほど待ってください）。",
  PIN_NOT_CONFIGURED: "薬剤師の PIN が設定されていません（サーバーの .env.local に MODA_PHARMACIST_PINS を書いてください）。",
  UNKNOWN_PHARMACIST: "薬剤師を選んでください。",
  OVERRIDE_REASON_INVALID: "解除の理由を選んでください（「その他」は理由を書いてください）。",
  NOT_CONTRAINDICATED: "禁忌ではない薬は解除しません。",
};

/** 自由に入力された文（原文のまま出す。翻訳は T13） */
function FreeText({ children }: { children: ReactNode }) {
  return (
    <span>
      <span className="rounded bg-yellow-50 px-1">「{children}」</span>
      <span className="ml-2 text-xs text-slate-500">原文のまま（翻訳は T13）</span>
    </span>
  );
}

function yesNo(value: boolean | undefined): string {
  return value === undefined ? "（答えなし）" : value ? "はい" : "いいえ";
}

function label(map: Record<string, string>, value: string | undefined): string {
  return value === undefined ? "（答えなし）" : (map[value] ?? value);
}

/** 1つの項目の答えを日本語で出す */
function AnswerText({ id, answers }: { id: QuestionId; answers: InterviewAnswers }): ReactNode {
  switch (id) {
    case "Q01":
      return answers.age === undefined ? "（答えなし）" : `${answers.age}歳`;
    case "Q02":
      return label(SEX, answers.sex);
    case "Q03":
      return label(PREGNANCY, answers.pregnancy);
    case "Q03a":
      return label(YES_NO_UNKNOWN, answers.dueWithin12Weeks);
    case "Q04":
      return label(BREASTFEEDING, answers.breastfeeding);
    case "Q05":
      return answers.weightKg === undefined ? "（答えなし）" : `${answers.weightKg}kg`;
    case "Q06":
      return label(YES_NO_UNKNOWN, answers.asthmaHistory);
    case "Q07": {
      const list = (answers.conditions ?? []).map((c) => CONDITIONS[c] ?? c);
      return (
        <>
          {answers.conditions === undefined ? "（答えなし）" : list.length > 0 ? list.join("、") : answers.otherConditionText ? "" : "なし"}
          {answers.otherConditionText ? (
            <span className="block">
              その他：<FreeText>{answers.otherConditionText}</FreeText>
            </span>
          ) : null}
        </>
      );
    }
    case "Q08":
      return (
        <>
          {label(YES_NO_UNKNOWN, answers.drugAllergy)}
          {answers.drugAllergy === "yes" ? (
            (answers.allergyDrugNames ?? []).length > 0 ? (
              <span className="block">
                アレルギーが出た薬の名前：<FreeText>{(answers.allergyDrugNames ?? []).join("、")}</FreeText>
              </span>
            ) : (
              <span className="block text-sm text-amber-800">薬の名前は入力されていません（口頭で確かめてください）</span>
            )
          ) : null}
        </>
      );
    case "Q09": {
      const list = (answers.currentMedications ?? []).map((m) => MEDICATIONS[m] ?? m);
      const names = answers.prescriptionDrugNames ?? [];
      return (
        <>
          {answers.currentMedications === undefined ? "（答えなし）" : list.length > 0 ? list.join("、") : "なし"}
          {names.length > 0 ? (
            <span className="block">
              処方薬の名前：<FreeText>{names.join("、")}</FreeText>
            </span>
          ) : null}
        </>
      );
    }
    case "Q10":
      return yesNo(answers.drivingAfter);
    case "Q11":
      return yesNo(answers.alcohol);
    case "Q12":
      return answers.plannedDays === undefined ? "（答えなし）" : `${answers.plannedDays}日`;
    case "Q13":
      return yesNo(answers.softContactLens);
    case "Q14":
      return label(SITES, answers.applicationSite);
    case "R01":
      return label(YES_NO_UNKNOWN, answers.otherStorePurchase);
    case "R02":
      return answers.packageChoice === "multiple"
        ? `複数個（${answers.multipleCount ?? "?"}個）`
        : label(PACKAGES, answers.packageChoice);
    case "R03":
      return answers.reasonText ? <FreeText>{answers.reasonText}</FreeText> : "（答えなし）";
    case "R04":
      return answers.purposeText ? <FreeText>{answers.purposeText}</FreeText> : "（答えなし）";
  }
}

const VERDICT_STYLE = {
  contraindicated: { text: "禁忌", className: "bg-red-100 text-red-900 border-red-300" },
  caution: { text: "注意", className: "bg-amber-100 text-amber-900 border-amber-300" },
  ok: { text: "問題なし", className: "bg-emerald-100 text-emerald-900 border-emerald-300" },
} as const;

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function PharmacistReview({ sessionId }: { sessionId: string }) {
  const [view, setView] = useState<PharmacistView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const patientUrl = `/?session=${encodeURIComponent(sessionId)}`;

  async function run(action: () => Promise<PharmacistView>): Promise<PharmacistView | null> {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setView(next);
      return next;
    } catch (e: unknown) {
      if (e instanceof RuleError) {
        setError(ERROR_MESSAGES[e.code] ?? `処理できませんでした（${e.code}）。`);
        // 画面とサーバーの状態がずれたときは、サーバーの今の内容を読み直す
        try {
          setView(await pharmacistApi.get(sessionId));
        } catch {
          /* 読み直せなければ、前の表示のまま知らせる */
        }
      } else if (e instanceof NetworkError) {
        setError("通信が止まりました。記録に残っていない可能性があります。通信を確かめて、もう一度押してください。");
      } else {
        setError("想定していないエラーです。");
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // 開いたら、薬の選択の状態なら薬剤師の確認を始める（確認中・終了済みならそのまま出す。問診の途中などでは理由を出す）
    void run(async () => {
      const current = await pharmacistApi.get(sessionId);
      return current.status === "drug_selection" ? pharmacistApi.open(sessionId) : current;
    });
  }, [sessionId]);

  const languageName = view ? (LANGUAGES.find((l) => l.code === view.language)?.japaneseName ?? view.language) : "";

  // 緊急の確認は患者さんの画面で開く（患者さんの言語の案内と、通信が止まっていても出せる画面がそこにあるため。CLAUDE.md ルール2）。
  // 状態は変えずに移り、移った先ですぐに緊急の確認を出してから記録する
  const emergencyUrl = `${patientUrl}&emergency=staff${view ? `&lang=${encodeURIComponent(view.language)}` : ""}`;

  return (
    <>
      <a
        href={emergencyUrl}
        className="fixed right-3 top-3 z-10 rounded-lg border border-red-300 bg-white/90 px-3 py-1.5 text-xs font-semibold text-red-800 shadow-sm hover:bg-red-50"
      >
        緊急の確認を開く
      </a>
      <header className="space-y-2">
        {/* どの状態でも、患者さんの画面に戻れる（画面を移るだけ。確認の状態は変えない） */}
        <div className="flex flex-wrap items-center gap-x-6">
          <a href={patientUrl} className="inline-flex min-h-11 items-center text-lg text-slate-600 underline underline-offset-4">
            ← 患者さんの画面に戻る
          </a>
          {/* 途中でやめる人のために、いつでも最初の画面（言語の選択）に戻れる（11/8 依頼主の判断。緊急の確認中も）。記録は消さない */}
          <button
            type="button"
            onClick={() => {
              if (window.confirm("この接客をやめて、最初の画面（言語の選択）に戻ります。よろしいですか？\n（ここまでの記録は消えずに残ります）")) {
                window.location.assign("/");
              }
            }}
            className="inline-flex min-h-11 items-center text-lg text-slate-600 underline underline-offset-4"
          >
            最初の画面に戻る（接客をやめる）
          </button>
        </div>
        <div className="flex items-center gap-3">
          <ModaBrand />
          <span className="rounded-full bg-teal-700 px-3 py-1 text-sm font-bold text-white">薬剤師用</span>
        </div>
        <h1 className="text-3xl font-bold">薬剤師の確認</h1>
        {view ? (
          <p className="text-slate-600">
            接客の言語：{languageName} ／ 流れ：
            {view.route === "product" ? "ほしい薬がある" : view.route === "symptom" ? "症状から探す" : "未選択"} ／ 状態：
            {STATUS_LABELS[view.status] ?? view.status}
          </p>
        ) : null}
        <p className="text-sm text-slate-500">
          表示は薬剤師への提案です。販売してよいかの判断は薬剤師が行います。
        </p>
        {view ? <PhaseSteps view={view} /> : null}
      </header>

      {error ? (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900">
          {error}
        </p>
      ) : null}

      {view !== null ? <EmergencyRecords sessionId={sessionId} refreshKey={view.status} /> : null}

      {/* 緊急の確認中は出さない（確認は患者さんの画面で行う。チャットのキーワードで画面が移ってしまわないように） */}
      {view !== null && !["completed", "declined", "emergency_ended", "emergency_review"].includes(view.status) ? (
        <details className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
          <summary className="cursor-pointer font-semibold">翻訳のチャット（患者さんに画面を見せて、くわしいことをたずねる）</summary>
          <div className="mt-3">
            <TranslationChat
              sessionId={sessionId}
              language={view.language}
              age={view.answers.age}
              emergencyCleared={view.emergencyCleared}
              emergencyReviewOpen={view.status === "emergency_review"}
              onEmergency={(found: ChatEmergency) => {
                // 緊急の確認は患者さんの画面で出す（患者さんの言語の案内と、通信がなくても出せる画面がそこにあるため。ルール2）。
                // サーバーが開いたとき（server）は、開き済みなので患者さんの画面に移るだけ（/emergency をもう一度呼ばない）。
                // 端末の中のキーワード（keyword）は、サーバーが開けていないこともあるので「緊急の確認を開く」と同じ道で移る
                // （移った先で、まだ開いていなければ開く。開き済みなら開き直さない）
                window.location.assign(found.kind === "keyword" ? emergencyUrl : patientUrl);
              }}
            />
          </div>
        </details>
      ) : null}

      {view === null ? (
        <p className="text-slate-500">読み込み中…</p>
      ) : (
        <ReviewBody
          view={view}
          busy={busy}
          reason={reason}
          onReason={setReason}
          patientUrl={patientUrl}
          onToggleSale={(drugId, selected) => {
            const next = selected ? [...view.saleDrugIds, drugId] : view.saleDrugIds.filter((d) => d !== drugId);
            void run(() => pharmacistApi.chooseSaleDrugs(sessionId, next));
          }}
          onCheck={(stepId, checked) => void run(() => pharmacistApi.checkStep(sessionId, stepId, checked))}
          onBack={async () => {
            const done = await run(() => pharmacistApi.back(sessionId));
            if (done) window.location.assign(patientUrl);
          }}
          onDecline={() => void run(() => pharmacistApi.decline(sessionId, reason))}
          onUndo={(step) => void run(() => pharmacistApi.undo(sessionId, step))}
          onApprove={(pharmacistId, pin) => void run(() => pharmacistApi.approve(sessionId, pharmacistId, pin))}
          onOverride={(input) => void run(() => pharmacistApi.override(sessionId, input))}
          onGuidance={(action) => {
            void (async () => {
              const actions = {
                create: () => pharmacistApi.createGuidance(sessionId),
                print: () => pharmacistApi.printGuidance(sessionId),
                counsel: () => pharmacistApi.startCounseling(sessionId),
                checkout: () => pharmacistApi.checkout(sessionId),
              } as const;
              const next = await run(actions[action]);
              if (next === null) return;
              // 印刷は、サーバーで承認のあとか確かめてから（ルール1）、ブラウザの印刷を開く
              if (action === "print") window.print();
              // 服薬指導・会計案内は患者さんの画面で行う
              if (action === "counsel" || action === "checkout") window.location.assign(patientUrl);
            })();
          }}
          onPostStep={(stepId, checked) => void run(() => pharmacistApi.checkPostStep(sessionId, stepId, checked))}
          onChooseCandidates={async (drugIds) => {
            // 候補の薬を選ぶと、その薬の項目を聞く問診に戻る（聞く項目がなければ、そのまま薬剤師の確認をやり直す）
            const next = await run(() => pharmacistApi.chooseCandidates(sessionId, drugIds));
            if (next?.status === "interview") window.location.assign(patientUrl);
            else if (next?.status === "drug_selection") void run(() => pharmacistApi.open(sessionId));
          }}
        />
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <span aria-hidden="true" className="h-6 w-1.5 shrink-0 rounded-full bg-teal-500" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function ReviewBody({
  view,
  busy,
  reason,
  onReason,
  patientUrl,
  onToggleSale,
  onCheck,
  onBack,
  onDecline,
  onChooseCandidates,
  onApprove,
  onOverride,
  onGuidance,
  onPostStep,
  onUndo,
}: {
  view: PharmacistView;
  busy: boolean;
  reason: string;
  onReason: (value: string) => void;
  patientUrl: string;
  onToggleSale: (drugId: StockedDrugId, selected: boolean) => void;
  onCheck: (stepId: string, checked: boolean) => void;
  onBack: () => void;
  onDecline: () => void;
  onChooseCandidates: (drugIds: StockedDrugId[]) => void;
  onApprove: (pharmacistId: string, pin: string) => void;
  onOverride: (input: OverrideInput) => void;
  onGuidance: (action: GuidanceAction) => void;
  onPostStep: (stepId: string, checked: boolean) => void;
  onUndo: (step: UndoStep) => void;
}) {
  if (view.saleRecord !== null && ["approved", "counseling", "checkout", "completed"].includes(view.status)) {
    return (
      <>
        <ApprovedSummary view={view} patientUrl={patientUrl} />
        <AfterApprovalSection view={view} busy={busy} onGuidance={onGuidance} onPostStep={onPostStep} />
        <UndoSection view={view} busy={busy} onUndo={onUndo} />
      </>
    );
  }
  if (view.status === "declined") {
    return (
      <Section title="販売しないで終えました">
        <p>
          理由：<span className="font-semibold">{view.declinedReason ?? "（記録なし）"}</span>
        </p>
        <p className="text-sm text-slate-600">患者さんの画面に、受診をすすめる案内が出ています。</p>
        <a href={patientUrl} className="inline-block rounded-xl border-2 border-slate-300 px-4 py-2 font-semibold">
          患者さんの画面に戻る（受診の案内）
        </a>
        <UndoSection view={view} busy={busy} onUndo={onUndo} />
      </Section>
    );
  }

  if (view.status !== "pharmacist_review") {
    return (
      <Section title="いまは薬剤師の確認を始められません">
        <p>
          いまの状態は「{STATUS_LABELS[view.status] ?? view.status}」です。患者さんの画面に戻って、問診を最後まで進めるか、緊急の確認を済ませてください。
        </p>
        <a href={patientUrl} className="inline-block rounded-xl border-2 border-slate-300 px-4 py-2 font-semibold">
          患者さんの画面に戻る
        </a>
      </Section>
    );
  }

  return (
    <>
      <Section title="患者さんの答えのまとめ">
        {view.symptomText ? (
          <p>
            症状：<FreeText>{view.symptomText}</FreeText>
          </p>
        ) : null}
        <table className="w-full text-left">
          <tbody>
            {view.askedQuestionIds.map((id) => (
              <tr key={id} className="border-t border-slate-100 align-top">
                <td className="w-14 py-2 text-sm text-slate-500">{id}</td>
                <td className="w-72 py-2 pr-3">{QUESTION_LABELS[id]}</td>
                <td className="py-2 font-semibold">
                  <AnswerText id={id} answers={view.answers} />
                </td>
              </tr>
            ))}
            {view.keptQuestionIds.map((id) => (
              <tr key={`kept-${id}`} className="border-t border-slate-100 bg-slate-50 align-top">
                <td className="w-14 py-2 text-sm text-slate-500">{id}</td>
                <td className="w-72 py-2 pr-3">
                  {QUESTION_LABELS[id]}
                  <span className="block text-xs text-slate-500">前に選んだ薬のために聞いた答え（判定に使います）</span>
                </td>
                <td className="py-2 font-semibold">
                  <AnswerText id={id} answers={view.answers} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {view.pastDrugNames.length > 0 ? (
          <p className="text-sm text-slate-600">前に選んでいた薬：{view.pastDrugNames.join("、")}（選び直しで外れました）</p>
        ) : null}
      </Section>

      <Section title="選んだ薬と禁忌の判定">
        {view.drugs.length === 0 ? (
          <p className="text-slate-600">
            患者さんはまだ薬を選んでいません（「症状から探す」）。下の「候補の薬」から選んでください。
          </p>
        ) : (
          <ul className="space-y-4">
            {view.drugs.map((drug) => {
              const verdict = VERDICT_STYLE[drug.judgment.verdict];
              const contraindicated = drug.judgment.verdict === "contraindicated";
              // 薬剤師が PIN と理由で解除した禁忌の薬は、販売する薬として選べる（T9b。サーバーでも確かめる）
              const blocked = contraindicated && drug.override === null;
              const selected = view.saleDrugIds.includes(drug.drugId);
              return (
                <li key={drug.drugId} className={`space-y-2 rounded-xl border-2 p-4 ${verdict.className}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-lg border bg-white px-2 py-0.5 text-sm font-bold">{verdict.text}</span>
                    <span className="text-lg font-bold">{drug.name}</span>
                    <span className="text-sm">（{drug.classification}）</span>
                  </div>
                  {drug.judgment.reasons.length > 0 ? (
                    <ul className="list-disc pl-6">
                      {drug.judgment.reasons.map((r) => (
                        <li key={`${r.code}-${r.label}`}>
                          {r.verdict === "contraindicated" ? "禁忌" : "注意"}：{r.label}
                          <span className="ml-2 text-sm">（{r.itemIds.join("・")}）</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <DrugInfo info={drug.info} age={view.answers.age} />
                  <p className="text-sm text-slate-700">
                    この薬のために聞いた項目：{drug.questionIds.map((q) => `${q} ${QUESTION_LABELS[q]}`).join("、")}
                  </p>
                  <label className={`flex items-center gap-3 rounded-lg bg-white px-3 py-2 ${contraindicated ? "opacity-60" : ""}`}>
                    <input
                      type="checkbox"
                      className="h-6 w-6"
                      checked={selected}
                      disabled={busy || blocked}
                      onChange={(e) => onToggleSale(drug.drugId, e.target.checked)}
                    />
                    <span className="font-semibold">販売する薬として選ぶ</span>
                    {blocked ? <span className="text-sm text-red-900">禁忌のため、解除しないと選べません</span> : null}
                  </label>
                  {drug.override !== null ? <OverrideNote override={drug.override} /> : null}
                  {blocked ? <OverrideForm drugId={drug.drugId} busy={busy} onOverride={onOverride} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* 接客ごとに作り直す（前の接客のチェックや絞り込みを、次の患者さんに持ち込まない） */}
      <CandidatesSection key={view.id} view={view} busy={busy} onChoose={onChooseCandidates} />

      {/* 段階ごとに出す（11/8 依頼主の判断）：薬を選ぶまでは手順と承認を出さない。承認の欄は、承認の前の手順がそろってから出す
          （承認できるかは、いままでどおりサーバーが確かめる。ルール1・5） */}
      {view.saleDrugIds.length === 0 ? (
        <Section title="次にすること">
          <p className="text-slate-700">
            {view.drugs.length === 0
              ? "上の「候補の薬」から薬を選び、そのあと「販売する薬として選ぶ」に ✓ を付けると、説明書の準備・販売手順のチェックリスト・承認の欄が出ます。"
              : "上の薬の「販売する薬として選ぶ」に ✓ を付けると、説明書の準備・販売手順のチェックリスト・承認の欄が出ます。"}
          </p>
        </Section>
      ) : (
        <>
          <GuidancePreview view={view} busy={busy} onCreate={() => onGuidance("create")} />

          <Section title="販売手順のチェックリスト">
            {view.procedureError ? (
              <p role="alert" className="text-red-900">
                {ERROR_MESSAGES[view.procedureError] ?? `販売手順を作れません（${view.procedureError}）。`}
              </p>
            ) : view.procedure === null ? (
              <p className="text-slate-600">販売手順を読み込めていません。画面を読み直してください。</p>
            ) : (
              <>
                <p className="text-sm text-slate-500">
                  手順の版：{view.procedure.effectiveFrom} 施行。✓ は記録に足していきます（消したり書き換えたりしません）。
                  承認の前の手順に ✓ がそろうまで、下の「承認する」は押せません。
                </p>
                {/* いま ✓ を付けるのは承認の前の手順だけ。承認の後の手順は、承認のあとの「服薬指導と会計案内」で ✓ を付ける */}
                <ul className="space-y-2">
                  {view.procedure.steps
                    .filter((step) => step.gate === "before_approval")
                    .map((step) => (
                      <li key={step.id}>
                        <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2">
                          <input
                            type="checkbox"
                            className="mt-1 h-6 w-6"
                            checked={step.checked}
                            disabled={busy}
                            onChange={(e) => onCheck(step.id, e.target.checked)}
                          />
                          <span className="flex-1">{step.label}</span>
                          {step.changedAt ? <span className="text-xs text-slate-500">{time(step.changedAt)}</span> : null}
                        </label>
                      </li>
                    ))}
                </ul>
                {view.procedure.steps.some((step) => step.gate !== "before_approval") ? (
                  <p className="text-sm text-slate-500">
                    承認のあとにすること：
                    {view.procedure.steps
                      .filter((step) => step.gate !== "before_approval")
                      .map((step) => step.label)
                      .join("、")}
                  </p>
                ) : null}
                {view.checkHistory.length > 0 ? (
                  <details className="text-sm text-slate-600">
                    <summary>チェックの記録（{view.checkHistory.length}件）</summary>
                    <ol className="mt-2 list-decimal pl-6">
                      {view.checkHistory.map((c, i) => (
                        <li key={`${c.at}-${i}`}>
                          {time(c.at)} {c.checked ? "✓ を付けた" : "✓ を外した"}：{c.label}
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}
              </>
            )}
          </Section>

          {readyToApprove(view) ? (
            <ApproveSection view={view} busy={busy} onApprove={onApprove} />
          ) : (
            <Section title="承認する（薬剤師の PIN）">
              <p className="text-amber-900">{approveBlockedReason(view)}</p>
              {view.procedureError ? null : <p className="text-sm text-slate-600">承認の前の手順に ✓ がそろうと、ここに承認の欄が出ます。</p>}
            </Section>
          )}
        </>
      )}

      <details className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <summary className="cursor-pointer text-lg font-bold">販売しない・薬の選択に戻す</summary>
        <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onBack}
            className="rounded-xl border-2 border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            戻る：薬の選択に戻す（患者さんの画面へ）
          </button>
        </div>
        <div className="space-y-2 rounded-xl bg-slate-50 p-4">
          <label className="block font-semibold" htmlFor="decline-reason">
            販売しない（理由は必須）
          </label>
          <textarea
            id="decline-reason"
            value={reason}
            maxLength={200}
            onChange={(e) => onReason(e.target.value)}
            className="w-full rounded-lg border border-slate-300 p-2"
            rows={2}
            placeholder="例：禁忌に当たるため、受診をすすめる"
          />
          <button
            type="button"
            disabled={busy || reason.trim() === ""}
            onClick={onDecline}
            className="rounded-xl bg-slate-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            販売しないで終える
          </button>
          <p className="text-xs text-slate-500">患者さんの画面に、受診をすすめる案内が出ます。</p>
        </div>
        </div>
      </details>
    </>
  );
}

/**
 * 候補の薬（「症状から探す」）・代わりの薬（「ほしい薬がある」）を選ぶ（backlog C-03）。
 * 出すのは「いまの答えでの仮の判定」。選ぶと、その薬の項目を聞く問診に戻し、答えがそろってから判定をやり直す。
 * 禁忌と分かっている薬も選べる（11/7 依頼主の判断）。販売する薬に選ぶには、確認画面で禁忌の解除が要る（ルール4）。
 */
function CandidatesSection({
  view,
  busy,
  onChoose,
}: {
  view: PharmacistView;
  busy: boolean;
  onChoose: (drugIds: StockedDrugId[]) => void;
}) {
  const [chosen, setChosen] = useState<readonly StockedDrugId[]>([]);
  // 絞り込み（backlog C-16）。表示のためだけで、記録もサーバーへの送信もしない
  const [query, setQuery] = useState("");
  const [symptomIds, setSymptomIds] = useState<readonly SymptomCategoryId[]>([]);
  if (view.candidates.length === 0) return null;
  const symptom = view.route === "symptom";
  const noDrug = view.drugs.length === 0;
  const filtering = query.trim() !== "" || symptomIds.length > 0;
  // チェックした薬・いま選んでいる薬は、絞り込みで隠さない（選んだまま見えなくならないように）
  const visible = visibleCandidates(view.candidates, {
    symptomIds,
    query,
    keepDrugIds: [...chosen, ...view.drugs.map((d) => d.drugId)],
  });
  const hiddenCount = view.candidates.length - visible.length;
  const body = (
    <>
      <p className="text-sm text-slate-600">
        いまの答えでの仮の判定です（まだ聞いていない項目は判定していません。「問題なし」は、その薬の項目をすべて答えているときだけ出します）。
        症状から薬を自動で選ぶ仕組みはありません。症状の原文を見て選んでください。
        {noDrug ? "" : "チェックした薬の組み合わせに選び直します（いま選んでいる薬も、残すならチェックしてください）。"}
      </p>
      <div className="space-y-2 rounded-xl bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-700">
          絞り込み（薬剤師が症状の原文を見て押してください。仕組みは症状の文から分類を決めません。印は効き目の分類が合うことだけを示し、禁忌の判定は変わりません）
        </p>
        <div className="flex flex-wrap gap-2">
          {SYMPTOM_CATEGORIES.map((sc) => {
            const on = symptomIds.includes(sc.id);
            return (
              <button
                key={sc.id}
                type="button"
                aria-pressed={on}
                onClick={() => setSymptomIds(on ? symptomIds.filter((id) => id !== sc.id) : [...symptomIds, sc.id])}
                className={`min-h-11 rounded-full border-2 px-3 py-1 text-sm ${
                  on ? "border-teal-700 bg-teal-700 font-semibold text-white" : "border-slate-300 bg-white text-slate-800"
                }`}
              >
                {sc.label}
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="薬の名前・成分・効き目の分類・区分で探す（例：ペイン、N1、抗ヒスタミン、第1類）"
          className="w-full rounded-xl border-2 border-slate-300 bg-white px-3 py-2"
        />
        {filtering ? (
          <p className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
            <span>
              {visible.length}件を表示中（絞り込みで{hiddenCount}件を隠しています。チェックした薬・いま選んでいる薬は隠しません。隠した薬にも、仮の判定〈禁忌・注意〉はそのまま付いています）
            </span>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSymptomIds([]);
              }}
              className="min-h-11 rounded-lg border-2 border-slate-300 bg-white px-3 py-1"
            >
              絞り込みを外す（すべて表示）
            </button>
          </p>
        ) : null}
      </div>
      {visible.length === 0 ? <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm">絞り込みに合う薬はありません。</p> : null}
      <ul className="space-y-2">
        {visible.map((c) => {
          const symptomMatches = matchingSymptomCategories(c.drugId, symptomIds);
          const known = c.status === "judged" ? c.judgment.reasons : c.knownReasons;
          const contraindicated = known.some((r) => r.verdict === "contraindicated");
          const style =
            c.status === "judged"
              ? VERDICT_STYLE[c.judgment.verdict]
              : contraindicated
                ? VERDICT_STYLE.contraindicated
                : { text: "追加の質問が要る", className: "bg-slate-50 text-slate-900 border-slate-300" };
          return (
            <li key={c.drugId} className={`space-y-1 rounded-xl border-2 p-3 ${style.className}`}>
              <label className="flex flex-wrap items-center gap-3">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={chosen.includes(c.drugId)}
                  disabled={busy}
                  onChange={(e) =>
                    setChosen(e.target.checked ? [...chosen, c.drugId] : chosen.filter((d) => d !== c.drugId))
                  }
                />
                <span className="rounded-lg border bg-white px-2 py-0.5 text-sm font-bold">{style.text}</span>
                <span className="font-bold">{c.name}</span>
                {view.drugs.some((d) => d.drugId === c.drugId) ? (
                  <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs text-teal-900">いま選んでいる薬</span>
                ) : null}
                <span className="text-sm">（{c.classification}）</span>
                {symptomMatches.map((sc) => (
                  <span key={sc.id} className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
                    症状の分類「{sc.label.split("（")[0]}」と効き目の分類が合う
                  </span>
                ))}
                {contraindicated ? (
                  <span className="text-sm text-red-900">選ぶと、確認の画面で禁忌の解除（薬剤師の PIN と理由）ができます</span>
                ) : null}
              </label>
              {known.length > 0 ? (
                <ul className="list-disc pl-12 text-sm">
                  {known.map((r) => (
                    <li key={`${r.code}-${r.label}`}>
                      {r.verdict === "contraindicated" ? "禁忌" : "注意"}：{r.label}（{r.itemIds.join("・")}）
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="pl-9">
                <DrugInfo info={c.info} age={view.answers.age} />
              </div>
              {c.status === "needs_questions" ? (
                <p className="pl-9 text-sm">選ぶと追加で聞く項目：{c.questionIds.map((q) => `${q} ${QUESTION_LABELS[q]}`).join("、")}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={busy || chosen.length === 0}
        onClick={() => onChoose([...chosen])}
        className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        選んだ薬の項目を聞く問診に戻る（患者さんの画面へ）
      </button>
    </>
  );
  if (symptom && noDrug) return <Section title="候補の薬（いまの答えでの仮の判定）">{body}</Section>;
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <details className="space-y-3">
        <summary className="cursor-pointer text-xl font-bold">
          {symptom ? "ほかの候補の薬に選び直す" : "代わりの薬を選ぶ"}（いまの答えでの仮の判定）
        </summary>
        <div className="mt-3 space-y-3">{body}</div>
      </details>
    </section>
  );
}

/**
 * 薬の基本の情報（成分・効き目の分類・用法用量・包装・服用できない年齢。docs/demo-data/drugs.md の架空のデータ。11/7 依頼主の要望）。
 * 添付文書の代わりではない（ハッカソン版は架空の薬だけ）。用量は、年齢別の表がある薬だけ患者さんの年齢に当たる量を出す
 */
function DrugInfo({ info, age }: { info: PharmacistView["drugs"][number]["info"]; age: number | undefined }) {
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-0.5 rounded-lg bg-white/70 px-3 py-2 text-sm text-slate-800">
      <dt className="text-slate-500">成分</dt>
      <dd>
        {info.ingredients.map((i) => `${i.name}（${i.kind}）`).join("、")}
        {info.hasUnlistedIngredients ? "　ほか" : ""}
      </dd>
      <dt className="text-slate-500">効き目の分類</dt>
      <dd>{info.category}</dd>
      <dt className="text-slate-500">用法・用量</dt>
      <dd>
        {info.usage}
        {info.doseForPatient !== null && age !== undefined ? (
          <span className="block font-semibold">
            {age}歳の1回量：{info.doseForPatient.dose ?? "服用しない年齢です"}
          </span>
        ) : null}
      </dd>
      <dt className="text-slate-500">包装</dt>
      <dd>{info.packages}</dd>
      <dt className="text-slate-500">服用できない年齢</dt>
      <dd>{info.minAge === null ? "制限なし" : `${info.minAge}歳未満`}</dd>
    </dl>
  );
}

/**
 * 薬剤師の PIN での承認（T9a。CLAUDE.md 絶対に守るルール1）。
 * 承認の前に必要な販売手順の ✓ がそろうまで押せない（サーバーでも同じように止める）。PIN は送ったら画面から消す
 */
/** 承認できない理由（なければ null）。表示の切り替えに使うだけで、最後に止めるのはサーバー（ルール1・5） */
function approveBlockedReason(view: PharmacistView): string | null {
  const missing = (view.procedure?.steps ?? []).filter((s) => s.gate === "before_approval" && !s.checked);
  return view.saleDrugIds.length === 0
    ? "販売する薬を選んでください。"
    : view.procedureError
      ? "販売手順を作れないため承認できません。"
      : view.procedure === null
        ? "販売手順を読み込めていません。"
        : missing.length > 0
          ? `承認の前に必要な手順が残っています：${missing.map((s) => s.label).join("、")}`
          : null;
}

function readyToApprove(view: PharmacistView): boolean {
  return approveBlockedReason(view) === null;
}

/** いまどの段階かを上に出す（薬を選ぶ → 手順を確かめる → 承認 → 説明と会計） */
function PhaseSteps({ view }: { view: PharmacistView }) {
  const labels = ["薬を選ぶ", "手順を確かめる", "承認", "説明と会計"] as const;
  let current: number;
  if (view.status === "pharmacist_review") current = view.saleDrugIds.length === 0 ? 0 : readyToApprove(view) ? 2 : 1;
  else if (["approved", "counseling", "checkout"].includes(view.status)) current = 3;
  else if (view.status === "completed") current = 4;
  else return null;
  return (
    <ol className="flex flex-wrap gap-2 pt-1">
      {labels.map((l, i) => (
        <li
          key={l}
          aria-current={i === current ? "step" : undefined}
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            i === current ? "bg-teal-700 text-white" : i < current ? "bg-teal-100 text-teal-900" : "bg-slate-100 text-slate-500"
          }`}
        >
          {i < current ? "✓ " : `${i + 1}. `}
          {l}
        </li>
      ))}
    </ol>
  );
}

function ApproveSection({
  view,
  busy,
  onApprove,
}: {
  view: PharmacistView;
  busy: boolean;
  onApprove: (pharmacistId: string, pin: string) => void;
}) {
  const pharmacists = usePharmacists();
  const [pharmacistId, setPharmacistId] = useState("");
  const [pin, setPin] = useState("");
  const blocked = approveBlockedReason(view);
  return (
    <Section title="承認する（薬剤師の PIN）">
      {blocked ? <p className="text-amber-900">{blocked}</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-sm text-slate-600">薬剤師</span>
          <select
            value={pharmacistId}
            onChange={(e) => setPharmacistId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="">選んでください</option>
            {pharmacists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-slate-600">PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="w-32 rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <button
          type="button"
          disabled={busy || blocked !== null || pharmacistId === "" || pin.length < 4}
          onClick={() => {
            onApprove(pharmacistId, pin);
            setPin("");
          }}
          className="rounded-xl bg-teal-700 px-5 py-2 font-semibold text-white disabled:opacity-50"
        >
          承認して販売記録を作る
        </button>
      </div>
      <p className="text-xs text-slate-500">
        承認すると、同時に販売記録ができます（あとから書き換えず、直すときは新しい版を足します）。説明書の印刷・服薬指導・会計案内は、承認のあとに出ます。
      </p>
    </Section>
  );
}

/**
 * 工程を1つ戻す（11/7 依頼主の判断：どの工程でも間違いは起こりうる。PIN は求めない）。
 * どの状態から戻せるかはサーバー（packages/domain の undoStep）が決める。販売記録は消さずに版を足す（ルール6）
 */
function UndoSection({ view, busy, onUndo }: { view: PharmacistView; busy: boolean; onUndo: (step: UndoStep) => void }) {
  const buttons: { step: UndoStep; label: string; confirm: string }[] = [];
  if (view.status === "counseling" && view.afterApproval?.understanding === "confirmed") {
    buttons.push({ step: "reset_understanding", label: "理解の確認をやり直す", confirm: "理解の確認を「未」に戻して、患者さんにもう一度聞きます。よろしいですか？" });
  }
  if (view.status === "checkout") {
    buttons.push({ step: "back_to_counseling", label: "会計案内から説明に戻る", confirm: "会計案内をやめて、説明書と理解の確認の画面に戻ります。よろしいですか？" });
  }
  if (["approved", "counseling", "checkout"].includes(view.status)) {
    buttons.push({
      step: "cancel_approval",
      label: "承認を取り消す（薬剤師の確認に戻る）",
      confirm: "承認を取り消して、薬剤師の確認に戻ります。販売記録には「取り消し」の版が残ります。もう一度承認するまで、説明書の印刷や会計はできません。よろしいですか？",
    });
  }
  if (view.status === "declined") {
    buttons.push({ step: "cancel_decline", label: "「販売しない」を取り消す（薬剤師の確認に戻る）", confirm: "「販売しない」を取り消して、薬剤師の確認に戻ります。よろしいですか？" });
  }
  if (buttons.length === 0) return null;
  return (
    <div className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3">
      <p className="text-sm font-semibold text-slate-700">工程を戻す（押し間違いのとき）</p>
      <div className="flex flex-wrap gap-3">
        {buttons.map((b) => (
          <button
            key={b.step}
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(b.confirm)) onUndo(b.step);
            }}
            className="min-h-11 rounded-xl border-2 border-slate-400 bg-white px-4 py-2 font-semibold hover:bg-slate-100 disabled:opacity-50"
          >
            ← {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 承認したあとの表示（販売記録の版1の内容） */
function ApprovedSummary({ view, patientUrl }: { view: PharmacistView; patientUrl: string }) {
  const sale = view.saleRecord;
  const v = sale?.versions.at(-1);
  return (
    <Section title="承認しました">
      {sale && v ? (
        <>
          <p>
            販売記録：<span className="font-mono text-sm">{sale.id}</span>（版{v.version}）／ 承認した薬剤師：{v.pharmacist.name} ／ 販売日時：
            {new Date(v.soldAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
          </p>
          <ul className="list-disc pl-6">
            {v.items.map((item) => (
              <li key={item.drugId}>
                {item.name}（{item.classification}）{item.packageAmount !== null ? `${item.packageAmount}錠入り` : ""} × {item.quantity}
              </li>
            ))}
          </ul>
          {v.overrides.length > 0 ? (
            <p className="text-sm text-red-900">
              禁忌の解除：
              {v.overrides
                .map(
                  (o) =>
                    `${o.drugId}（${OVERRIDE_REASONS.find((r) => r.code === o.reasonCode)?.label ?? o.reasonCode}${o.reasonText ? "：" + o.reasonText : ""}／${o.pharmacist.name}）`,
                )
                .join("、")}
            </p>
          ) : null}
          <p className="text-sm text-slate-600">
            理解の確認：{v.understanding === "confirmed" ? "済み" : "未（患者さんが「わかった」と答えたら、記録に版を足します）"}
          </p>
        </>
      ) : (
        <p>販売記録を読み込めませんでした。</p>
      )}
      <div className="flex flex-wrap gap-3">
        <a href="/pharmacist/records" className="inline-block rounded-xl border-2 border-slate-300 px-4 py-2 font-semibold">
          販売記録の一覧を見る
        </a>
        <a href={patientUrl} className="inline-block rounded-xl border-2 border-slate-300 px-4 py-2 font-semibold">
          患者さんの画面に戻る
        </a>
      </div>
    </Section>
  );
}

/** 承認・禁忌の解除で選ぶ薬剤師の一覧（架空。読めなければ空のまま＝押せない側に止まる） */
function usePharmacists(): readonly { id: string; name: string }[] {
  const [pharmacists, setPharmacists] = useState<readonly { id: string; name: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pharmacists", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { pharmacists: { id: string; name: string }[] }) : { pharmacists: [] }))
      .then((data) => {
        if (!cancelled) setPharmacists(data.pharmacists);
      })
      .catch(() => {
        /* 一覧を読めなければ選べないまま */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return pharmacists;
}

/** 解除したことの表示（理由・薬剤師・時刻） */
function OverrideNote({ override }: { override: NonNullable<PharmacistView["drugs"][number]["override"]> }) {
  const label = OVERRIDE_REASONS.find((r) => r.code === override.reasonCode)?.label ?? override.reasonCode;
  return (
    <p className="rounded-lg bg-white px-3 py-2 text-sm text-red-900">
      禁忌を解除しました：{label}
      {override.reasonText ? `（${override.reasonText}）` : ""} ／ {override.pharmacist.name} ／ {time(override.at)}
    </p>
  );
}

/**
 * 禁忌を解除する（T9b。CLAUDE.md 絶対に守るルール4）。理由を選び、薬剤師の PIN で再認証する。
 * 解除はこの確認の中だけ有効（戻ると、もう一度解除する）。PIN は送ったら画面から消す
 */
function OverrideForm({
  drugId,
  busy,
  onOverride,
}: {
  drugId: StockedDrugId;
  busy: boolean;
  onOverride: (input: OverrideInput) => void;
}) {
  const pharmacists = usePharmacists();
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [pharmacistId, setPharmacistId] = useState("");
  const [pin, setPin] = useState("");
  const reason = OVERRIDE_REASONS.find((r) => r.code === reasonCode);
  const ready =
    reason !== undefined && (!reason.requiresText || reasonText.trim() !== "") && pharmacistId !== "" && pin.length >= 4;
  return (
    <details className="rounded-lg bg-white px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold text-red-900">禁忌を解除する（薬剤師の PIN と理由が必要）</summary>
      <div className="mt-2 space-y-2 text-sm">
        <fieldset className="space-y-1">
          <legend className="text-slate-600">理由</legend>
          {OVERRIDE_REASONS.map((r) => (
            <label key={r.code} className="flex items-center gap-2">
              <input
                type="radio"
                name={`override-${drugId}`}
                value={r.code}
                checked={reasonCode === r.code}
                onChange={() => setReasonCode(r.code)}
              />
              {r.label}
            </label>
          ))}
        </fieldset>
        {reason?.requiresText ? (
          <textarea
            value={reasonText}
            maxLength={200}
            rows={2}
            onChange={(e) => setReasonText(e.target.value)}
            className="w-full rounded-lg border border-slate-300 p-2"
            placeholder="理由を書いてください"
          />
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <select
            value={pharmacistId}
            onChange={(e) => setPharmacistId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="">薬剤師を選ぶ</option>
            {pharmacists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="w-28 rounded-lg border border-slate-300 px-3 py-2"
          />
          <button
            type="button"
            disabled={busy || !ready}
            onClick={() => {
              onOverride({ drugId, pharmacistId, pin, reasonCode, reasonText: reason?.requiresText ? reasonText : null });
              setPin("");
            }}
            className="rounded-xl bg-red-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            禁忌を解除する
          </button>
        </div>
      </div>
    </details>
  );
}

type GuidanceAction = "create" | "print" | "counsel" | "checkout";

/** 説明書の中身（日本語の原文・患者さんの言語の参考訳・訳し戻し）。印刷のときは参考訳と原文だけを出す */
function GuidanceText({ guidance, printable }: { guidance: NonNullable<PharmacistView["guidance"]>; printable: boolean }) {
  return (
    <div className="space-y-3">
      {guidance.provider === "mock" ? (
        <p className="text-sm text-slate-500">仮の AI（開発用）の訳です。本番では Claude が訳します。</p>
      ) : null}
      {/* 印刷に出すのは承認のあとだけ（承認の前にブラウザの印刷を使っても出さない。ルール1） */}
      <div className={`${printable ? "print-leaflet " : ""}space-y-4`}>
        <div>
          <p className="text-xs text-slate-500">参考訳（AI の訳）</p>
          <p lang={guidance.language} className="whitespace-pre-wrap rounded-lg bg-white p-3">
            {guidance.translation}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">原文（日本語）</p>
          <p lang="ja" className="whitespace-pre-wrap rounded-lg bg-white p-3">
            {guidance.japanese}
          </p>
        </div>
      </div>
      <details className="text-sm text-slate-600">
        <summary>確認用：日本語に訳し戻した文（訳の意味がずれていないか、薬剤師が確かめる）</summary>
        <p className="mt-2 whitespace-pre-wrap">{guidance.backTranslation}</p>
      </details>
    </div>
  );
}

/**
 * 承認の前に説明書を作って中身を確かめる（手順「書面の準備」のため。T10）。
 * 印刷と患者さんへの表示は承認のあとだけ（ルール1）
 */
function GuidancePreview({ view, busy, onCreate }: { view: PharmacistView; busy: boolean; onCreate: () => void }) {
  if (view.saleDrugIds.length === 0) return null;
  return (
    <Section title="説明書（書面の準備）">
      <p className="text-sm text-slate-600">
        販売する薬の説明書を作り、日本語の原文と参考訳を確かめてから、チェックリストの「書面の準備」に ✓ を付けてください。印刷は承認のあとです。
      </p>
      {view.guidance ? <GuidanceText guidance={view.guidance} printable={false} /> : null}
      <button
        type="button"
        disabled={busy}
        onClick={onCreate}
        className="rounded-xl border-2 border-teal-600 px-4 py-2 font-semibold text-teal-800 disabled:opacity-50"
      >
        {view.guidance ? "説明書を作り直す" : "説明書を作る（AI で患者さんの言語に訳す）"}
      </button>
    </Section>
  );
}

/** 承認のあと：説明書の印刷・服薬指導・理解の確認・承認の後の手順・会計案内（T10） */
function AfterApprovalSection({
  view,
  busy,
  onGuidance,
  onPostStep,
}: {
  view: PharmacistView;
  busy: boolean;
  onGuidance: (action: GuidanceAction) => void;
  onPostStep: (stepId: string, checked: boolean) => void;
}) {
  const after = view.afterApproval;
  if (after === null) return null;
  const status = view.status;
  const canCounsel = status === "approved" || status === "counseling";
  const allDone = after.steps.every((s) => s.done);
  return (
    <Section title="服薬指導と会計案内">
      {status === "completed" ? (
        <p className="font-semibold">
          接客を終えました。患者さんの評価：
          {after.feedback === "good" ? "わかりやすかった" : after.feedback === "fair" ? "ふつう" : after.feedback === "poor" ? "わかりにくかった" : "なし"}
        </p>
      ) : null}
      {status === "checkout" ? <p className="font-semibold">会計案内中です。患者さんの画面で評価をお願いしてください。</p> : null}

      {canCounsel ? (
        <>
          {view.guidance ? <GuidanceText guidance={view.guidance} printable /> : <p>説明書がまだありません。作ってください。</p>}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => onGuidance("create")}
              className="rounded-xl border-2 border-teal-600 px-4 py-2 font-semibold text-teal-800 disabled:opacity-50"
            >
              {view.guidance ? "説明書を作り直す" : "説明書を作る"}
            </button>
            <button
              type="button"
              disabled={busy || view.guidance === null}
              onClick={() => onGuidance("print")}
              className="rounded-xl border-2 border-slate-400 px-4 py-2 font-semibold disabled:opacity-50"
            >
              説明書を印刷する{after.printed ? "（印刷済み）" : ""}
            </button>
            {status === "approved" ? (
              <button
                type="button"
                disabled={busy || view.guidance === null}
                onClick={() => onGuidance("counsel")}
                className="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                患者さんの画面で説明を始める
              </button>
            ) : null}
          </div>
          {status === "approved" ? (
            <p className="text-sm text-slate-600">
              説明を始めたあとは、この画面に戻らなくても、患者さんの画面の下の「薬剤師用：会計の前の手順と会計案内」で手順の ✓ と会計案内に進めます。
            </p>
          ) : null}

          <div className="space-y-2">
            <p className="font-semibold">
              理解の確認：
              {after.understanding === "confirmed"
                ? "済み（患者さんが「わかった」と答えました。販売記録に版を足しました）"
                : status === "counseling"
                  ? "まだ（患者さんの画面で答えてもらいます）"
                  : "まだ（説明を始めると、患者さんの画面に出ます）"}
            </p>
            {after.lastNotUnderstood && after.understanding !== "confirmed" ? (
              <p className="text-amber-900">
                患者さんの答え：{after.lastNotUnderstood === "partly" ? "少しわからないところがある" : "わからなかった"}。もう一度説明してください（翻訳のチャットも使えます）。
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="font-semibold">会計の前の手順</p>
            <ul className="space-y-2">
              {after.steps.map((step) => (
                <li key={step.id}>
                  <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-6 w-6"
                      checked={step.done}
                      disabled={busy || step.byPatient}
                      onChange={(e) => onPostStep(step.id, e.target.checked)}
                    />
                    <span>
                      {step.label}
                      {step.byPatient ? <span className="ml-2 text-xs text-slate-500">（患者さんの答えで記録します）</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          {status === "counseling" ? (
            <button
              type="button"
              disabled={busy || !allDone}
              onClick={() => onGuidance("checkout")}
              className="rounded-xl bg-teal-700 px-5 py-2 font-semibold text-white disabled:opacity-50"
            >
              会計案内に進む（患者さんの画面へ）
            </button>
          ) : null}
          {status === "counseling" && !allDone ? (
            <p className="text-sm text-amber-900">会計の前の手順と理解の確認がそろうまで、会計案内に進めません。</p>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
