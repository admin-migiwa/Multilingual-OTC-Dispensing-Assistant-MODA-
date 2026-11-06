import type { StockedDrugId } from "@moda/domain";

import { BadRequestError, handle, readJson } from "@/server/http";
import { chooseSaleDrugs, pharmacistView } from "@/server/pharmacist-service";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 販売する薬を選ぶ。body: { drugIds: ["G"] }（禁忌の薬はサーバーで止まる。CLAUDE.md 絶対に守るルール4） */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    const drugIds = body.drugIds;
    if (!Array.isArray(drugIds) || !drugIds.every((d) => typeof d === "string")) {
      throw new BadRequestError("薬の形が違います");
    }
    const deps = defaultDeps();
    return pharmacistView(chooseSaleDrugs(deps, id, drugIds as StockedDrugId[]), deps.now());
  });
}
