import { BadRequestError, handle, readJson } from "@/server/http";
import { checkProcedureStep, pharmacistView } from "@/server/pharmacist-service";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 販売手順のチェック（✓）を付ける・外す。body: { stepId: "contraindication_check", checked: true }（記録に足す） */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    if (typeof body.stepId !== "string" || typeof body.checked !== "boolean") {
      throw new BadRequestError("チェックの形が違います");
    }
    const deps = defaultDeps();
    return pharmacistView(checkProcedureStep(deps, id, body.stepId, body.checked), deps.now());
  });
}
