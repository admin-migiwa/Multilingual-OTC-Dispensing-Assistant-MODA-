import { DomainRuleError } from "../errors.ts";
import { transition, type SessionSnapshot } from "../session/state.ts";
import { selectProcedureVersion, type SalesProcedureVersion, type StepGate } from "./data.ts";
import { assertValidAge, checkQuantitySelection, type DrugSelection } from "./quantity.ts";

export interface RequiredStep {
  readonly id: string;
  readonly label: string;
  readonly gate: StepGate;
  /** この手順を必要にした決まり（P01〜P07） */
  readonly ruleIds: readonly string[];
  /** この手順を必要にした薬の ID */
  readonly drugIds: readonly string[];
}

export interface RequiredProcedure {
  /** 使った版の施行日 */
  readonly effectiveFrom: string;
  readonly steps: readonly RequiredStep[];
}

type CompletedStepIds = ReadonlySet<string> | readonly string[];

/**
 * 選んだ薬の区分の組み合わせから、必要な手順をすべて合わせた一覧を作る。
 * 同じ手順が複数の区分で必要なときは1つにまとめる。
 *
 * - date は日本時間の YYYY-MM-DD（selectProcedureVersion の説明を参照）。その日に有効な版の手順を使う。
 * - 指定濫用防止医薬品の個数は、すべての選択を合計して判定する（決定 12）。
 * - 18歳未満の大容量・複数個のように、選べない組み合わせが渡されたらエラーで止める
 *   （画面で選べなくしていても、サーバー側でもう一度確かめる）。
 */
export function buildRequiredProcedure(
  input: {
    readonly selections: readonly DrugSelection[];
    readonly patientAge: number;
    readonly date: string;
  },
  version: SalesProcedureVersion = selectProcedureVersion(input.date),
): RequiredProcedure {
  if (input.selections.length === 0) {
    throw new DomainRuleError("NO_DRUG_SELECTED", "薬が選ばれていません");
  }
  assertValidAge(input.patientAge);

  for (const { drug } of input.selections) {
    if (drug.categories.length === 0) {
      throw new DomainRuleError("INVALID_DRUG_DATA", `薬 ${drug.id} の区分がありません`);
    }
  }

  // 個数は一覧全体で判定する（同じ薬を分けて渡しても、別の薬でも合計する）
  const quantityCheck = checkQuantitySelection(
    { selections: input.selections, patientAge: input.patientAge },
    version.quantityRules,
  );
  if (!quantityCheck.allowed) {
    throw new DomainRuleError("QUANTITY_NOT_ALLOWED", "この年齢・個数・包装の組み合わせでは販売できません");
  }
  const isMinor = input.patientAge < version.quantityRules.minorAgeBelow;

  const collected = new Map<string, { ruleIds: Set<string>; drugIds: Set<string> }>();

  for (const { drug } of input.selections) {
    for (const category of drug.categories) {
      const rule = version.categoryRules.find((r) => r.category === category);
      if (!rule) {
        throw new DomainRuleError("UNKNOWN_CATEGORY", `区分 ${category} の販売手順が版 ${version.effectiveFrom} にありません`);
      }
      for (const stepId of rule.stepIds) {
        const step = version.steps.find((s) => s.id === stepId);
        if (!step) {
          throw new DomainRuleError("UNKNOWN_STEP", `手順 ${stepId} が版 ${version.effectiveFrom} にありません`);
        }
        if (step.condition === "large_or_multiple" && !quantityCheck.requiresReason) continue;
        if (step.condition === "under_18" && !isMinor) continue;

        const entry = collected.get(stepId) ?? { ruleIds: new Set<string>(), drugIds: new Set<string>() };
        entry.ruleIds.add(rule.ruleId);
        entry.drugIds.add(drug.id);
        collected.set(stepId, entry);
      }
    }
  }

  // 並び順は版のデータの順にそろえる
  const steps: RequiredStep[] = [];
  for (const step of version.steps) {
    const entry = collected.get(step.id);
    if (!entry) continue;
    steps.push({ id: step.id, label: step.label, gate: step.gate, ruleIds: [...entry.ruleIds], drugIds: [...entry.drugIds] });
  }
  return { effectiveFrom: version.effectiveFrom, steps };
}

/**
 * まだ終わっていない手順を返す。
 * - "before_approval"：承認の前に終わっている必要がある手順だけを見る
 * - "before_checkout"：会計案内の前なので、すべての手順を見る
 */
export function getMissingSteps(
  procedure: RequiredProcedure,
  completedStepIds: CompletedStepIds,
  until: StepGate,
): readonly RequiredStep[] {
  const done = new Set(completedStepIds);
  return procedure.steps.filter((step) => {
    if (until === "before_approval" && step.gate !== "before_approval") return false;
    return !done.has(step.id);
  });
}

/** 承認してよいか（承認の前に必要な手順がすべて終わっているか） */
export function canApprove(procedure: RequiredProcedure, completedStepIds: CompletedStepIds): boolean {
  return getMissingSteps(procedure, completedStepIds, "before_approval").length === 0;
}

/** 会計案内に進んでよいか（すべての手順が終わっているか） */
export function canProceedToCheckout(procedure: RequiredProcedure, completedStepIds: CompletedStepIds): boolean {
  return getMissingSteps(procedure, completedStepIds, "before_checkout").length === 0;
}

/**
 * 承認の API は、PIN の確認とあわせて必ずこれを呼ぶ。
 * 未完了の手順が1つでもあれば DomainRuleError を投げる。
 */
export function assertApprovalAllowed(procedure: RequiredProcedure, completedStepIds: CompletedStepIds): void {
  const missing = getMissingSteps(procedure, completedStepIds, "before_approval");
  if (missing.length > 0) {
    throw new DomainRuleError(
      "PROCEDURE_INCOMPLETE_FOR_APPROVAL",
      `承認の前に必要な手順が終わっていません：${missing.map((s) => s.label).join("、")}`,
    );
  }
}

/**
 * 理解の確認・法定項目の記録・書面を渡す・薬剤師の前での服用の確認なども含め、
 * 未完了の手順があれば DomainRuleError を投げる。
 * ふつうは直接呼ばず、proceedToCheckout を使う。
 */
export function assertCheckoutAllowed(procedure: RequiredProcedure, completedStepIds: CompletedStepIds): void {
  const missing = getMissingSteps(procedure, completedStepIds, "before_checkout");
  if (missing.length > 0) {
    throw new DomainRuleError(
      "PROCEDURE_INCOMPLETE_FOR_CHECKOUT",
      `会計案内の前に必要な手順が終わっていません：${missing.map((s) => s.label).join("、")}`,
    );
  }
}

/**
 * 服薬指導（counseling）から会計案内（checkout）へ進める。会計案内へ進む API は、必ずこれを使う。
 *
 * 1. 必要な手順がすべて済んでいるかを assertCheckoutAllowed で確かめる
 * 2. そのうえで state.ts の transition で状態を進める（順番の確認と understandingConfirmed の確認）
 *
 * 理解の確認の記録について：いまは「済んだ手順の understanding_check」と
 * 「SessionSnapshot の understandingConfirmed」の2か所に分かれている。
 * **正とするのは、販売記録に版を足して残す「済んだ手順」（completedStepIds）の側**。
 * understandingConfirmed はそこから作る写しとして扱い、ここでは両方がそろわないと進めない。
 * 1か所にまとめる作り替えは T9 で行う。
 */
export function proceedToCheckout(
  session: SessionSnapshot,
  procedure: RequiredProcedure,
  completedStepIds: CompletedStepIds,
): SessionSnapshot {
  assertCheckoutAllowed(procedure, completedStepIds);
  return transition(session, "checkout");
}
