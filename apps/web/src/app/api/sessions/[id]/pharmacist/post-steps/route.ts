import { checkPostApprovalStep } from "@/server/guidance";
import { BadRequestError, handle, readJson } from "@/server/http";
import { pharmacistView } from "@/server/pharmacist-service";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 承認の後・会計の前の手順に ✓ を付ける・外す（T10）。body: { stepId, checked }。理解の確認は ✓ では付けない */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    if (typeof body.stepId !== "string" || typeof body.checked !== "boolean") throw new BadRequestError("手順の形が違います");
    const deps = defaultDeps();
    return pharmacistView(checkPostApprovalStep(deps, id, body.stepId, body.checked), deps.now());
  });
}
