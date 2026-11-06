/**
 * 薬剤師の画面で、候補の薬・代わりの薬を選ぶときのルール（docs/backlog.md C-03・C-11）。
 *
 * - 「症状から探す」では基本の項目まで、「ほしい薬がある」では選んだ薬の項目までしか聞いていない。
 *   ほかの薬の判定に要る答えがまだないので、候補の一覧は「いまの答えでの仮の判定」を出す（rankCandidates は答えが足りないと止まるので使わない）。
 * - 仮の判定では、いまの答えで当てはまったと分かる理由だけを出し、「問題なし」は、その薬の項目をすべて答えているときだけ出す（推測しない。ルール7）。
 * - 選んだら、その薬の項目を聞く問診に戻す（サーバーの chooseCandidateDrugs）。最後の判定は、答えがそろってから薬剤師の確認でやり直す。
 * - いまの答えで禁忌と分かっている薬は、候補として選べない（ルール4。解除は T9）。
 *   選べるかは、実際に選ぶ組み合わせの答え（selectDrugs のあと）で確かめる（ほかの薬のために聞いた答えの使い方が組み合わせで変わるため。K47）。
 */

import { DomainRuleError } from "../errors.ts";
import type { StockedDrugId } from "../contraindication/data.ts";
import { judgeDrug, judgeDrugWithKnownFacts, type DrugJudgment, type JudgmentReason } from "../contraindication/judge.ts";
import { factsForJudgment, missingQuestions, selectDrugs, type InterviewState } from "../interview/flow.ts";
import type { QuestionId } from "../interview/items.ts";

export type CandidatePreview =
  | {
      readonly drugId: StockedDrugId;
      /** その薬の項目をすべて答えている（judgeDrug と同じ判定） */
      readonly status: "judged";
      readonly judgment: DrugJudgment;
    }
  | {
      readonly drugId: StockedDrugId;
      /** 選ぶと、まだ聞いていない項目を問診で聞く */
      readonly status: "needs_questions";
      /** 選んだら聞く項目（聞く順番） */
      readonly questionIds: readonly QuestionId[];
      /** いまの答えで当てはまったと分かる理由（禁忌・注意）。答えが増えても消えない */
      readonly knownReasons: readonly JudgmentReason[];
    };

/** いまの答えで禁忌と分かっているか */
export function isKnownContraindicated(preview: CandidatePreview): boolean {
  return preview.status === "judged"
    ? preview.judgment.verdict === "contraindicated"
    : preview.knownReasons.some((r) => r.verdict === "contraindicated");
}

/** その薬だけを選んだとしたときの、仮の判定 */
function previewOne(state: InterviewState, drugId: StockedDrugId): CandidatePreview {
  const next = selectDrugs(state, [drugId]);
  const missing = missingQuestions(next);
  const facts = factsForJudgment(next);
  if (missing.length === 0) return { drugId, status: "judged", judgment: judgeDrug(drugId, facts) };
  return { drugId, status: "needs_questions", questionIds: missing, knownReasons: judgeDrugWithKnownFacts(drugId, facts).knownReasons };
}

/**
 * 候補の薬の仮の判定を、禁忌にならない薬が先に来るように並べる（K28 と同じ考え方）。
 * 判定済みで禁忌でない → 追加の質問が要る（禁忌と分かっていない）→ 禁忌と分かっている、の順。同じ組の中は渡した順。
 * 禁忌の薬も消さずに後ろに残す（理由を見られるように）。
 */
export function previewCandidates(state: InterviewState, drugIds: readonly StockedDrugId[]): CandidatePreview[] {
  const previews = drugIds.map((id) => previewOne(state, id));
  const group = (p: CandidatePreview): number => (isKnownContraindicated(p) ? 2 : p.status === "judged" ? 0 : 1);
  return [0, 1, 2].flatMap((g) => previews.filter((p) => group(p) === g));
}

/**
 * 薬剤師が候補・代わりの薬として選んでよいかを確かめ、選んだあとの問診の状態を返す。
 * - 1つも選んでいなければ止める。
 * - 実際に選ぶ組み合わせの答えで、いまの答えで禁忌と分かっている薬があれば止める（ルール4）。
 */
export function selectCandidateDrugs(state: InterviewState, drugIds: readonly StockedDrugId[]): InterviewState {
  if (drugIds.length === 0) {
    throw new DomainRuleError("NO_DRUG_SELECTED", "候補の薬が選ばれていません");
  }
  const next = selectDrugs(state, drugIds);
  const facts = factsForJudgment(next);
  for (const drugId of next.selectedDrugs) {
    if (judgeDrugWithKnownFacts(drugId, facts).knownReasons.some((r) => r.verdict === "contraindicated")) {
      throw new DomainRuleError("CONTRAINDICATED_NOT_SELECTABLE", `薬 ${drugId} は禁忌のため選べません`);
    }
  }
  return next;
}
