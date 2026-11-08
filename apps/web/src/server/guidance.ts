/**
 * 母国語の説明書・服薬指導・理解の確認・会計案内・患者さんの評価（T10。spec.md 決まったこと No.25、CLAUDE.md 絶対に守るルール1・6・7・10）。
 *
 * 流れ：承認（approved）→ 服薬指導（counseling）→ 理解の確認（販売記録に版を足す）→ 会計案内（checkout）→ 評価して完了（completed）。
 * - 印刷・服薬指導・会計の処理は、最初に assertActionAllowed を呼ぶ（承認の前には進めない。ルール1）。
 * - 説明書の日本語は、サーバーが架空の薬のデータ（drugs.md）と、薬剤師が確認した注意の文（docs/demo-data/leaflet.md）から組み立てる。
 *   AI は患者さんの言語に訳すだけ（ルール10）。説明書は承認の前（薬剤師の確認中）から作って中身を確かめられる（手順「書面の準備」のため）。
 *   印刷と患者さんへの表示は承認のあとだけ。承認した品目と違う説明書は使わない。
 * - 理解の確認の正は、販売記録の版（understanding: confirmed）。SessionSnapshot.understandingConfirmed は、同じ書き込みで作る写し（backlog C-02）。
 * - 会計案内へ進む道は proceedToCheckout だけ（backlog C-01 の会計の側）。販売手順は、承認したときの版と品目で作り直す（日付が変わってもずれない）。
 * - 記録は足すだけ。説明書の文・理解の答え・評価は、履歴（events）には種類だけを残す（ルール9）。
 */

import {
  DomainRuleError,
  INGREDIENTS,
  STOCKED_DRUGS,
  abusePreventionAnswers,
  assertActionAllowed,
  buildRequiredProcedure,
  doseForAge,
  proceedToCheckout,
  saleSelectionsFor,
  transition,
  undoStep,
  type DrugJudgment,
  type RequiredProcedure,
  type StockedDrugId,
} from "@moda/domain";
import type { LanguageCode } from "@moda/i18n";

import type { AiClient } from "./ai/index.ts";
import type { SaleRecord, SaleRecordVersion } from "./approval.ts";
import { currentRound, currentSaleDrugIds, judgmentsOf, overriddenDrugIdsOf } from "./pharmacist-service.ts";
import { activeApproval } from "./sale-versions.ts";
import { event, load, moveTo, SessionServiceError, type ServiceDeps, type SessionRecord } from "./session-service.ts";
import { translateLeaflet } from "./translation.ts";

// ---------------------------------------------------------------------------
// 説明書の注意の文（docs/demo-data/leaflet.md の ☑ の行の写し。キーは禁忌判定の注意の理由の文）
// ---------------------------------------------------------------------------

export interface LeafletCaution {
  readonly id: string;
  readonly drugIds: readonly StockedDrugId[];
  /** 禁忌判定の注意の理由の文（packages/domain の contraindication/data.ts の label） */
  readonly reasonLabel: string;
  readonly text: string;
}

export const LEAFLET_CAUTIONS: readonly LeafletCaution[] = [
  { id: "LF01", drugIds: ["A"], reasonLabel: "服用後24時間は授乳を避ける", text: "この薬を飲んでから24時間は、授乳をしないでください。" },
  { id: "LF02", drugIds: ["B", "C", "D", "J"], reasonLabel: "妊娠中（相談）", text: "妊娠中の方は、使う前に医師または薬剤師に相談してください。" },
  {
    id: "LF03",
    drugIds: ["B", "D", "E"],
    reasonLabel: "眠くなる成分（運転しない）",
    text: "この薬を飲んだあとは、眠くなることがあるので、車やバイクの運転をしないでください。",
  },
  {
    id: "LF04",
    drugIds: ["B"],
    reasonLabel: "5日を超えて飲む予定",
    text: "5日を超えて続けて飲まないでください。症状が続くときは、医師または薬剤師に相談してください。",
  },
  { id: "LF05", drugIds: ["C", "D", "E", "I"], reasonLabel: "飲酒", text: "この薬を飲む前後は、お酒を飲まないでください。" },
  {
    id: "LF06",
    drugIds: ["F"],
    reasonLabel: "14日を超えて飲む予定",
    text: "14日を超えて続けて飲まないでください。症状が続くときは、医師または薬剤師に相談してください。",
  },
  { id: "LF07", drugIds: ["G"], reasonLabel: "コンタクトを外して使う", text: "ソフトコンタクトレンズを外してから使ってください。" },
  { id: "LF08", drugIds: ["G"], reasonLabel: "緑内障（相談）", text: "緑内障の方は、使う前に医師または薬剤師に相談してください。" },
  { id: "LF09", drugIds: ["H"], reasonLabel: "目の周り・粘膜には使わない", text: "目の周りや粘膜には使わないでください。" },
  { id: "LF10", drugIds: ["H"], reasonLabel: "湿疹・かぶれ・傷口には使わない", text: "湿疹・かぶれ・傷口には使わないでください。" },
  {
    id: "LF11",
    drugIds: ["I"],
    reasonLabel: "肝臓病で治療中（相談）",
    text: "肝臓の病気で治療中の方は、使う前に医師または薬剤師に相談してください。",
  },
  {
    id: "LF12",
    drugIds: ["J"],
    reasonLabel: "カンゾウの類（むくみ・高血圧）",
    text: "高血圧・心臓や腎臓の病気がある方、むくみがある方は、使う前に医師または薬剤師に相談してください。",
  },
  { id: "LF13", drugIds: ["J"], reasonLabel: "生薬の重なり", text: "ほかの漢方薬と一緒に飲む前に、薬剤師に相談してください。" },
];

/**
 * 禁忌を解除して販売した薬の文（leaflet.md LF21〜LF23 の ☑ の行。キーは禁忌の理由の文）。
 * 言葉の壁があって口頭の念押しが届きにくいため、説明書にも書く（11/7 依頼主の判断）
 */
export const LEAFLET_OVERRIDE_CAUTIONS: readonly LeafletCaution[] = [
  {
    id: "LF21",
    drugIds: ["B", "C", "D", "I"],
    reasonLabel: "ほかの解熱鎮痛薬との併用",
    text: "ほかの解熱鎮痛薬（痛み止め・熱さまし）と一緒に飲まないでください。前の薬から切り替えるときは、前の薬をやめてから飲んでください。",
  },
  { id: "LF22", drugIds: ["B", "D", "E", "I"], reasonLabel: "ほかのかぜ薬との併用", text: "ほかのかぜ薬と一緒に飲まないでください。" },
  {
    id: "LF23",
    drugIds: ["E"],
    reasonLabel: "ほかの抗ヒスタミン薬との併用",
    text: "ほかのアレルギー・鼻炎の薬（抗ヒスタミン薬）と一緒に飲まないでください。",
  },
];

/** LF29：上のほかの禁忌を解除して販売したときの決まった形の文（leaflet.md ☑） */
function overriddenLine(drugId: StockedDrugId, label: string): string {
  const found = LEAFLET_OVERRIDE_CAUTIONS.find((c) => c.reasonLabel === label && c.drugIds.includes(drugId));
  if (found) return found.text;
  return `「${label}」に当てはまる方は、ふつうはこの薬を使えません。薬剤師が確認して販売しました。体調が変わったときや気になることがあるときは、使う前に医師または薬剤師に相談してください。`;
}

/** 説明書の最後の文（受診案内 RF05 と同じ。referral.md ☑） */
const LEAFLET_FOOTER = "わからないことは、スタッフに聞いてください。";

function cautionLine(drugId: StockedDrugId, label: string): string {
  const found = LEAFLET_CAUTIONS.find((c) => c.reasonLabel === label && c.drugIds.includes(drugId));
  // 表にない注意（「わからない」と答えたときの理由など）は、文を推測で作らず、項目の名前と確認のお願いだけを出す（leaflet.md）
  return found ? found.text : `${label}：薬剤師に確認してください。`;
}

/**
 * 説明書の日本語（原文）を組み立てる。
 * 「この方への注意」は、判定で「注意」になった理由と、薬剤師が禁忌を解除して販売する薬の禁忌の理由（overriddenDrugIds）
 */
export function buildLeafletJapanese(
  drugIds: readonly StockedDrugId[],
  judgments: readonly DrugJudgment[],
  age: number,
  overriddenDrugIds: readonly StockedDrugId[] = [],
): string {
  const blocks: string[] = ["お薬の説明"];
  for (const drugId of drugIds) {
    const drug = STOCKED_DRUGS.find((d) => d.id === drugId);
    if (!drug) throw new DomainRuleError("UNKNOWN_DRUG", `取扱薬 ${drugId} が見つかりません`);
    const lines = [`■ ${drug.name}（${drug.classification}）`, `効き目の分類：${drug.category}`];
    lines.push(
      `成分：${drug.ingredients.map((i) => `${INGREDIENTS[i].name}（${INGREDIENTS[i].kind}）`).join("、")}${drug.hasUnlistedIngredients ? " ほか" : ""}`,
    );
    lines.push(`用法・用量：${drug.usage}`);
    const row = doseForAge(drugId, age);
    if (row !== null) lines.push(row.dose === null ? `${age}歳：この薬は飲めない年齢です。` : `${age}歳の1回量：${row.dose}`);
    lines.push(`包装：${drug.packages}`);
    const judgment = judgments.find((j) => j.drugId === drugId);
    if (!judgment) throw new DomainRuleError("DRUG_NOT_JUDGED", `薬 ${drugId} の禁忌判定がありません`);
    const cautionLines = judgment.reasons.filter((r) => r.verdict === "caution").map((r) => cautionLine(drugId, r.label));
    const overrideLines = overriddenDrugIds.includes(drugId)
      ? judgment.reasons.filter((r) => r.verdict === "contraindicated").map((r) => overriddenLine(drugId, r.label))
      : [];
    const all = [...overrideLines, ...cautionLines];
    if (all.length > 0) {
      lines.push("この方への注意：");
      for (const line of all) lines.push(`・${line}`);
    }
    blocks.push(lines.join("\n"));
  }
  blocks.push(LEAFLET_FOOTER);
  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// 記録の形
// ---------------------------------------------------------------------------

/** 作った説明書（作るたびに足す。最後のものが今の説明書） */
export interface GuidanceRecord {
  readonly at: string;
  /** どの薬の説明書か（承認のあとは、販売記録の品目と同じでないと使わない） */
  readonly drugIds: readonly StockedDrugId[];
  readonly language: LanguageCode;
  readonly japanese: string;
  readonly translation: string;
  readonly backTranslation: string;
  readonly provider: AiClient["provider"];
}

/** 承認の後・会計の前の手順の ✓（足していくだけ。最後の付け外しが今の状態） */
export interface PostApprovalCheck {
  readonly at: string;
  readonly stepId: string;
  readonly checked: boolean;
}

export const UNDERSTANDING_ANSWERS = ["understood", "partly", "not_understood"] as const;
export type UnderstandingAnswer = (typeof UNDERSTANDING_ANSWERS)[number];
export const FEEDBACK_RATINGS = ["good", "fair", "poor"] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

// ---------------------------------------------------------------------------

/**
 * 販売記録と、今の承認の版（v1。承認を取り消してもう一度承認したときは、その版。sale-versions.ts）と、最後の版。
 * 承認を取り消している間は、承認の前と同じに扱って止める（ルール1）
 */
function saleOf(record: SessionRecord): { sale: SaleRecord; v1: SaleRecordVersion; latest: SaleRecordVersion } {
  const sale = record.saleRecord;
  const v1 = activeApproval(sale);
  const latest = sale?.versions.at(-1);
  if (!sale || !v1 || !latest) throw new DomainRuleError("NOT_APPROVED", "販売記録がありません（承認の前です）");
  return { sale, v1, latest };
}

/** 承認したときの販売手順の版と品目で、販売手順を作り直す（会計の前の手順を確かめるため） */
export function procedureAtApproval(record: SessionRecord): RequiredProcedure {
  const { v1 } = saleOf(record);
  const age = record.interview.answers.age;
  if (age === undefined) throw new DomainRuleError("ANSWER_MISSING", "年齢の答えがありません");
  return buildRequiredProcedure({
    selections: saleSelectionsFor(
      v1.items.map((i) => i.drugId),
      abusePreventionAnswers(record.interview),
      Object.fromEntries(v1.items.map((i) => [i.drugId, i.quantity])),
    ),
    patientAge: age,
    date: v1.procedureEffectiveFrom,
  });
}

/** いま説明書を作る対象の薬（承認の前は今の「販売する薬」、承認のあとは販売記録の品目） */
function guidanceDrugIds(record: SessionRecord): readonly StockedDrugId[] {
  const status = record.snapshot.status;
  if (status === "pharmacist_review") {
    const ids = currentSaleDrugIds(currentRound(record).round);
    if (ids.length === 0) throw new DomainRuleError("NO_DRUG_SELECTED", "販売する薬を選んでから説明書を作ります");
    return ids;
  }
  if (status === "approved" || status === "counseling") return saleOf(record).v1.items.map((i) => i.drugId);
  throw new DomainRuleError("INVALID_TRANSITION", `${status} の状態では説明書を作れません`);
}

function sameDrugs(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * 説明書が今の答え・判定と合っているか（作ったあとに答えが直されると、注意の文が変わるため）。
 * 説明書の日本語はデータから決まって組み立てるので、今の判定で組み立て直して同じかを比べる
 */
export function isGuidanceFresh(record: SessionRecord, guidance: GuidanceRecord): boolean {
  const age = record.interview.answers.age;
  if (age === undefined || guidance.language !== record.language) return false;
  return buildLeafletJapanese(guidance.drugIds, judgmentsOf(record), age, overriddenForLeaflet(record)) === guidance.japanese;
}

/** 説明書に書く「禁忌を解除した薬」：承認のあとは販売記録に残した解除、承認の前は今の確認の中の解除 */
function overriddenForLeaflet(record: SessionRecord): StockedDrugId[] {
  const v1 = activeApproval(record.saleRecord);
  if (v1) return [...new Set(v1.overrides.map((o) => o.drugId))];
  if (record.snapshot.status === "pharmacist_review") return overriddenDrugIdsOf(currentRound(record).round);
  return [];
}

/**
 * 今の説明書。承認のあとは販売記録の品目と同じもの、承認の前は今の「販売する薬」と同じもので、
 * どちらも今の答え・判定で組み立て直した日本語と同じもの（古い説明書を使わない）。なければ null
 */
export function currentGuidance(record: SessionRecord): GuidanceRecord | null {
  const latest = record.guidances?.at(-1);
  if (!latest) return null;
  let drugIds: readonly StockedDrugId[];
  const approval = activeApproval(record.saleRecord);
  if (approval) {
    drugIds = approval.items.map((i) => i.drugId);
  } else {
    if (record.snapshot.status !== "pharmacist_review") return null;
    drugIds = currentSaleDrugIds(currentRound(record).round);
  }
  if (drugIds.length === 0 || !sameDrugs(latest.drugIds, drugIds)) return null;
  return isGuidanceFresh(record, latest) ? latest : null;
}

function requireGuidance(record: SessionRecord): GuidanceRecord {
  const guidance = currentGuidance(record);
  if (!guidance) throw new DomainRuleError("GUIDANCE_NOT_READY", "販売する薬の説明書を作ってから進めます");
  return guidance;
}

/**
 * 説明書を作る（日本語を組み立て、患者さんの言語に訳し、訳し戻す）。薬剤師の確認中（販売する薬を選んだあと）・承認のあと・服薬指導中に作れる。
 * AI の待ちのあとに記録を読み直し、状態や薬が変わっていたら残さずに止める（古い説明書を残さない）。
 */
export async function createGuidance(deps: ServiceDeps, ai: AiClient, id: string): Promise<SessionRecord> {
  const before = load(deps, id);
  const drugIds = guidanceDrugIds(before);
  const age = before.interview.answers.age;
  if (age === undefined) throw new DomainRuleError("ANSWER_MISSING", "年齢の答えがありません");
  const japanese = buildLeafletJapanese(drugIds, judgmentsOf(before), age, overriddenForLeaflet(before));
  const translated = await translateLeaflet(ai, before.language, japanese);

  const record = load(deps, id);
  if (record.snapshot.status !== before.snapshot.status || !sameDrugs(guidanceDrugIds(record), drugIds)) {
    throw new DomainRuleError("INVALID_TRANSITION", "説明書を作っている間に状態が変わりました。もう一度作ってください");
  }
  const guidance: GuidanceRecord = {
    at: deps.now().toISOString(),
    drugIds: [...drugIds],
    language: record.language,
    japanese,
    translation: translated.translation,
    backTranslation: translated.backTranslation,
    provider: translated.provider,
  };
  const next: SessionRecord = {
    ...record,
    guidances: [...(record.guidances ?? []), guidance],
    events: [...record.events, event(deps, "guidance_created", [...drugIds])],
  };
  deps.store.set(next);
  return next;
}

/** 説明書を印刷する（承認のあとだけ。ルール1）。印刷したことを履歴に残し、画面が印刷する */
export function printGuidance(deps: ServiceDeps, id: string): SessionRecord {
  const record = load(deps, id);
  assertActionAllowed(record.snapshot.status, "print");
  requireGuidance(record);
  const next: SessionRecord = { ...record, events: [...record.events, event(deps, "guidance_printed")] };
  deps.store.set(next);
  return next;
}

/** 患者さんの画面で服薬指導を始める（approved → counseling。説明書が要る） */
export function startCounseling(deps: ServiceDeps, id: string): SessionRecord {
  const record = load(deps, id);
  assertActionAllowed(record.snapshot.status, "counsel");
  requireGuidance(record);
  if (record.snapshot.status === "counseling") return record;
  const next = moveTo(deps, record, "counseling");
  deps.store.set(next);
  return next;
}

/**
 * 患者さんの「説明はわかりましたか？」の答えを残す（服薬指導中だけ。ルール1）。
 * - わかった：販売記録に版を足し（理解の確認：済み）、同じ書き込みで状態の写しも済みにする（No.25・C-02）。2回目は受け付けない。
 * - それ以外：履歴に答えの種類だけを残す（版は足さない）。薬剤師がもう一度説明する。
 */
export function answerUnderstanding(deps: ServiceDeps, id: string, answer: string): SessionRecord {
  const record = load(deps, id);
  assertActionAllowed(record.snapshot.status, "counsel");
  if (record.snapshot.status !== "counseling") {
    throw new DomainRuleError("INVALID_TRANSITION", "服薬指導の間だけ、理解の確認を受け付けます");
  }
  if (!(UNDERSTANDING_ANSWERS as readonly string[]).includes(answer)) {
    throw new SessionServiceError("INVALID_REQUEST", "理解の確認の答えの形が違います");
  }
  const { sale, latest } = saleOf(record);
  if (latest.understanding === "confirmed") {
    throw new DomainRuleError("UNDERSTANDING_ALREADY_CONFIRMED", "理解の確認はもう記録してあります");
  }
  if (answer !== "understood") {
    const next: SessionRecord = { ...record, events: [...record.events, event(deps, "understanding_answered", [answer])] };
    deps.store.set(next);
    return next;
  }
  const at = deps.now().toISOString();
  const v2: SaleRecordVersion = { ...latest, version: latest.version + 1, at, reason: "understanding_confirmed", understanding: "confirmed" };
  const next: SessionRecord = {
    ...record,
    snapshot: { ...record.snapshot, understandingConfirmed: true },
    saleRecord: { ...sale, versions: [...sale.versions, v2] },
    events: [...record.events, event(deps, "understanding_answered", [answer]), event(deps, "sale_record_versioned", [sale.id, String(v2.version)])],
  };
  deps.store.set(next);
  return next;
}

/**
 * 承認の後・会計の前の手順に ✓ を付ける・外す（書面を渡す・法定項目の記録・薬剤師の前での服用の確認など）。
 * 理解の確認は ✓ では付けない（患者さんの答えで記録する）。承認の前の手順は承認のときのまま変えない。
 */
export function checkPostApprovalStep(deps: ServiceDeps, id: string, stepId: string, checked: boolean): SessionRecord {
  const record = load(deps, id);
  assertActionAllowed(record.snapshot.status, "counsel");
  const step = procedureAtApproval(record).steps.find((s) => s.id === stepId);
  if (!step || step.gate !== "before_checkout") {
    throw new SessionServiceError("INVALID_REQUEST", "承認の後の手順にない手順です");
  }
  if (step.id === "understanding_check") {
    throw new DomainRuleError("STEP_RECORDED_BY_PATIENT", "理解の確認は、患者さんの答えで記録します");
  }
  const check: PostApprovalCheck = { at: deps.now().toISOString(), stepId, checked };
  const next: SessionRecord = {
    ...record,
    postApprovalChecks: [...(record.postApprovalChecks ?? []), check],
    events: [...record.events, event(deps, "procedure_step_checked", [stepId, checked ? "checked" : "unchecked"])],
  };
  deps.store.set(next);
  return next;
}

/** 済んだ手順（承認の前に済んだもの＋承認の後の ✓ の最後の状態＋理解の確認の版） */
export function completedStepsAfterApproval(record: SessionRecord): string[] {
  const { v1, latest } = saleOf(record);
  const latestCheck = new Map<string, boolean>();
  // 今の承認のあとの ✓ だけを見る（承認を取り消す前の ✓ は使わない）
  for (const c of record.postApprovalChecks ?? []) if (c.at >= v1.at) latestCheck.set(c.stepId, c.checked);
  const done = [...v1.completedStepIds, ...[...latestCheck].filter(([, ok]) => ok).map(([stepId]) => stepId)];
  if (latest.understanding === "confirmed") done.push("understanding_check");
  return done;
}

/**
 * 理解の確認をやり直す（服薬指導中で、確認が済んだあと。11/7 依頼主の判断。PIN は求めない）。
 * 販売記録に「understanding_reset」の版を足し（理解の確認：未。ルール6）、状態の写しも未に戻す。会計案内には進めなくなる
 */
export function resetUnderstanding(deps: ServiceDeps, id: string): SessionRecord {
  const record = load(deps, id);
  assertActionAllowed(record.snapshot.status, "counsel");
  const snapshot = undoStep(record.snapshot, "reset_understanding");
  const { sale, latest } = saleOf(record);
  if (latest.understanding !== "confirmed") {
    throw new DomainRuleError("INVALID_TRANSITION", "理解の確認はまだ済んでいません");
  }
  const at = deps.now().toISOString();
  const reset: SaleRecordVersion = { ...latest, version: latest.version + 1, at, reason: "understanding_reset", understanding: "not_yet" };
  const next: SessionRecord = {
    ...record,
    snapshot,
    saleRecord: { ...sale, versions: [...sale.versions, reset] },
    events: [...record.events, event(deps, "understanding_reset"), event(deps, "sale_record_versioned", [sale.id, String(reset.version)])],
  };
  deps.store.set(next);
  return next;
}

/** 会計案内から服薬指導に戻る（checkout → counseling。11/7 依頼主の判断）。理解の確認・販売記録はそのまま */
export function backToCounseling(deps: ServiceDeps, id: string): SessionRecord {
  const record = load(deps, id);
  assertActionAllowed(record.snapshot.status, "checkout");
  const snapshot = undoStep(record.snapshot, "back_to_counseling");
  const next: SessionRecord = { ...record, snapshot, events: [...record.events, event(deps, "status_changed", [snapshot.status])] };
  deps.store.set(next);
  return next;
}

/** 会計案内に進む（counseling → checkout）。会計の前の手順と理解の確認がそろわないと止まる（S03・S05。C-01） */
export function proceedCheckout(deps: ServiceDeps, id: string): SessionRecord {
  const record = load(deps, id);
  // 承認のあとでなければ止める（ルール1。会計案内へ進む前の服薬指導の状態か）
  assertActionAllowed(record.snapshot.status, "counsel");
  if (record.snapshot.status !== "counseling") {
    throw new DomainRuleError("INVALID_TRANSITION", "服薬指導のあとに会計案内に進みます");
  }
  const snapshot = proceedToCheckout(record.snapshot, procedureAtApproval(record), completedStepsAfterApproval(record));
  const next: SessionRecord = {
    ...record,
    snapshot,
    events: [...record.events, event(deps, "status_changed", [snapshot.status])],
  };
  deps.store.set(next);
  return next;
}

/** 患者さんの評価を残し、接客を終える（checkout → completed）。評価は販売記録には入れない */
export function giveFeedback(deps: ServiceDeps, id: string, rating: string): SessionRecord {
  const record = load(deps, id);
  assertActionAllowed(record.snapshot.status, "checkout");
  if (!(FEEDBACK_RATINGS as readonly string[]).includes(rating)) {
    throw new SessionServiceError("INVALID_REQUEST", "評価の形が違います");
  }
  const snapshot = transition(record.snapshot, "completed");
  const next: SessionRecord = {
    ...record,
    snapshot,
    feedback: { at: deps.now().toISOString(), rating: rating as FeedbackRating },
    events: [...record.events, event(deps, "feedback_given", [rating]), event(deps, "status_changed", [snapshot.status])],
  };
  deps.store.set(next);
  return next;
}
