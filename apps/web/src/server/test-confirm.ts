/**
 * テスト用：患者さんの薬の確認で「この薬でOK」を押す（ふつうの薬は1個、E は答えの R02〈なければ小箱1個〉）。
 * テストのファイルからだけ使う。
 */
import { quantityModeOf, type InterviewAnswers, type StockedDrugId } from "@moda/domain";

import { confirmDrugChoice } from "./patient-confirmation.ts";
import { getSession, type ServiceDeps, type SessionRecord } from "./session-service.ts";

export function confirmOk(
  deps: ServiceDeps,
  id: string,
  answers: InterviewAnswers = {},
  quantities: Partial<Record<StockedDrugId, number>> = {},
): SessionRecord {
  const drugs = getSession(deps, id).interview.selectedDrugs;
  const q: Partial<Record<StockedDrugId, number>> = {};
  for (const d of drugs) if (quantityModeOf(d) === "count") q[d] = quantities[d] ?? 1;
  const hasPackage = drugs.some((d) => quantityModeOf(d) === "package");
  return confirmDrugChoice(deps, id, {
    choice: "ok",
    quantities: q,
    ...(hasPackage
      ? {
          packageChoice: answers.packageChoice ?? "small_one",
          ...(answers.multipleCount !== undefined ? { multipleCount: answers.multipleCount } : {}),
        }
      : {}),
  });
}
