import type { StockedDrugId } from "@moda/domain";

import { BadRequestError, handle, readJson } from "@/server/http";
import { chooseDrugs, defaultDeps, patientView } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 薬を選ぶ。body: { drugIds: ["C"] }（取扱薬にない記号は packages/domain のルールで止まる） */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    const drugIds = body.drugIds;
    if (!Array.isArray(drugIds) || !drugIds.every((d) => typeof d === "string")) {
      throw new BadRequestError("薬の形が違います");
    }
    return patientView(chooseDrugs(defaultDeps(), id, drugIds as StockedDrugId[]));
  });
}
