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

import type { InterviewAnswers, QuestionId, SessionStatus, StockedDrugId } from "@moda/domain";
import { LANGUAGES } from "@moda/i18n";

import { NetworkError, RuleError } from "../session-api";
import { EmergencyRecords } from "./emergency-records";
import { pharmacistApi, type PharmacistView } from "./pharmacist-api";

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
};

const ERROR_MESSAGES: Record<string, string> = {
  CONTRAINDICATED_NOT_SELECTABLE: "禁忌の薬は選べません（解除は承認の作業 T9 で作ります）。",
  QUANTITY_NOT_ALLOWED: "この年齢・個数・包装の組み合わせでは販売できません（18歳未満の大箱・複数個など）。",
  INVALID_TRANSITION: "いまの状態ではこの操作はできません。画面を読み直しました。",
  INTERVIEW_INCOMPLETE: "問診が終わっていません。患者さんの画面に戻って、問診を最後まで進めてください。",
  NO_DRUG_SELECTED: "販売する薬を選んでからチェックしてください。",
  STEP_NOT_YET_AVAILABLE: "この手順は承認の後に記録します（承認の前には ✓ を付けられません）。",
  SESSION_NOT_FOUND: "この接客の記録が見つかりません（サーバーの再起動など）。",
  SESSION_ALREADY_ENDED: "この接客はすでに終わっています。",
  INVALID_REQUEST: "送った内容の形が違います。",
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
        <p className="text-sm font-semibold tracking-widest text-teal-700">MODA 薬剤師用</p>
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
      </header>

      {error ? (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900">
          {error}
        </p>
      ) : null}

      {view !== null ? <EmergencyRecords sessionId={sessionId} refreshKey={view.status} /> : null}

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
    <section className="space-y-3 rounded-2xl border border-slate-200 p-5">
      <h2 className="text-xl font-bold">{title}</h2>
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
}) {
  if (view.status === "declined") {
    return (
      <Section title="販売しないで終えました">
        <p>
          理由：<span className="font-semibold">{view.declinedReason ?? "（記録なし）"}</span>
        </p>
        <p className="text-sm text-slate-500">患者さんへの受診案内の画面は、次の作業（T11）で作ります。</p>
        <a href={patientUrl} className="inline-block rounded-xl border-2 border-slate-300 px-4 py-2 font-semibold">
          患者さんの画面に戻る
        </a>
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
          </tbody>
        </table>
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
                  <p className="text-sm text-slate-700">
                    この薬のために聞いた項目：{drug.questionIds.map((q) => `${q} ${QUESTION_LABELS[q]}`).join("、")}
                  </p>
                  <label className={`flex items-center gap-3 rounded-lg bg-white px-3 py-2 ${contraindicated ? "opacity-60" : ""}`}>
                    <input
                      type="checkbox"
                      className="h-6 w-6"
                      checked={selected}
                      disabled={busy || contraindicated}
                      onChange={(e) => onToggleSale(drug.drugId, e.target.checked)}
                    />
                    <span className="font-semibold">販売する薬として選ぶ</span>
                    {contraindicated ? (
                      <span className="text-sm text-red-900">禁忌のため選べません（解除は承認の作業 T9 で作ります）</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <CandidatesSection view={view} busy={busy} onChoose={onChooseCandidates} />

      <Section title="販売手順のチェックリスト">
        {view.procedureError ? (
          <p role="alert" className="text-red-900">
            {ERROR_MESSAGES[view.procedureError] ?? `販売手順を作れません（${view.procedureError}）。`}
          </p>
        ) : view.procedure === null ? (
          <p className="text-slate-600">販売する薬を選ぶと、区分ごとの手順がここに出ます。</p>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              手順の版：{view.procedure.effectiveFrom} 施行。✓ は記録に足していきます（消したり書き換えたりしません）。
              ✓ がそろうまで承認できない仕組みは、承認の作業（T9）で作ります。
            </p>
            <ul className="space-y-2">
              {view.procedure.steps.map((step) => (
                <li key={step.id}>
                  <label
                    className={`flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 ${step.gate === "before_approval" ? "" : "bg-slate-50 text-slate-500"}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-6 w-6"
                      checked={step.checked}
                      disabled={busy || step.gate !== "before_approval"}
                      onChange={(e) => onCheck(step.id, e.target.checked)}
                    />
                    <span className="flex-1">
                      {step.label}
                      <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs text-slate-600">
                        {step.gate === "before_approval" ? "承認の前に" : "承認の後・会計の前に（記録は T9・T10）"}
                      </span>
                    </span>
                    {step.changedAt ? <span className="text-xs text-slate-500">{time(step.changedAt)}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
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

      <Section title="確認を終える">
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
          <p className="text-xs text-slate-500">受診をすすめる患者さん向けの画面は、次の作業（T11）で作ります。</p>
        </div>
        <p className="text-sm text-slate-500">承認（PIN）は、次の作業（T9）で作ります。</p>
      </Section>
    </>
  );
}

/**
 * 候補の薬（「症状から探す」）・代わりの薬（「ほしい薬がある」）を選ぶ（backlog C-03）。
 * 出すのは「いまの答えでの仮の判定」。選ぶと、その薬の項目を聞く問診に戻し、答えがそろってから判定をやり直す。
 * いまの答えで禁忌と分かっている薬は選べない（サーバーでも止める。ルール4）。
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
  if (view.candidates.length === 0) return null;
  const symptom = view.route === "symptom";
  const noDrug = view.drugs.length === 0;
  const body = (
    <>
      <p className="text-sm text-slate-600">
        いまの答えでの仮の判定です（まだ聞いていない項目は判定していません。「問題なし」は、その薬の項目をすべて答えているときだけ出します）。
        症状から薬を自動で選ぶ仕組みはありません。症状の原文を見て選んでください。
        {noDrug ? "" : "選ぶと、いま選んでいる薬と入れ替わります。"}
      </p>
      <ul className="space-y-2">
        {view.candidates.map((c) => {
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
              <label className={`flex flex-wrap items-center gap-3 ${contraindicated ? "opacity-70" : ""}`}>
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={chosen.includes(c.drugId)}
                  disabled={busy || contraindicated}
                  onChange={(e) =>
                    setChosen(e.target.checked ? [...chosen, c.drugId] : chosen.filter((d) => d !== c.drugId))
                  }
                />
                <span className="rounded-lg border bg-white px-2 py-0.5 text-sm font-bold">{style.text}</span>
                <span className="font-bold">{c.name}</span>
                <span className="text-sm">（{c.classification}）</span>
                {contraindicated ? <span className="text-sm text-red-900">禁忌のため選べません（解除は T9）</span> : null}
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
              {c.status === "needs_questions" && !contraindicated ? (
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
    <section className="rounded-2xl border border-slate-200 p-5">
      <details className="space-y-3">
        <summary className="cursor-pointer text-xl font-bold">
          {symptom ? "ほかの候補の薬に選び直す" : "代わりの薬を選ぶ"}（いまの答えでの仮の判定）
        </summary>
        <div className="mt-3 space-y-3">{body}</div>
      </details>
    </section>
  );
}
