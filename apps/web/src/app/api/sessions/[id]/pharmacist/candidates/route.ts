import type { StockedDrugId } from "@moda/domain";

import { BadRequestError, handle, readJson } from "@/server/http";
import { chooseCandidateDrugs, pharmacistView } from "@/server/pharmacist-service";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 候補・代わりの薬を選び、その薬の項目を聞く問診に戻す。body: { drugIds: ["G"] }（禁忌と分かっている薬も選べる。販売する薬に選ぶには確認画面で禁忌の解除が要る。ルール4。backlog C-03） */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    const drugIds = body.drugIds;
    if (!Array.isArray(drugIds) || !drugIds.every((d) => typeof d === "string")) {
      throw new BadRequestError("薬の形が違います");
    }
    const deps = defaultDeps();
    return pharmacistView(chooseCandidateDrugs(deps, id, drugIds as StockedDrugId[]), deps.now());
  });
}
