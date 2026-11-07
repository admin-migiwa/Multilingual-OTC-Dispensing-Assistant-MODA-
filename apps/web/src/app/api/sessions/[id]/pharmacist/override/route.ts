import { BadRequestError, handle, readJson } from "@/server/http";
import { overrideContraindication, pharmacistView } from "@/server/pharmacist-service";
import { defaultPinVerifier } from "@/server/pin";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/**
 * 禁忌を解除する（T9b。CLAUDE.md 絶対に守るルール4）。薬剤師の PIN で再認証し、理由を記録する。
 * body: { drugId: "C", pharmacistId: "P1", pin: "…", reasonCode: "switching_not_combined", reasonText: null }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    const { drugId, pharmacistId, pin, reasonCode, reasonText } = body;
    if (
      typeof drugId !== "string" ||
      typeof pharmacistId !== "string" ||
      typeof pin !== "string" ||
      pin.length > 16 ||
      typeof reasonCode !== "string" ||
      (reasonText !== null && reasonText !== undefined && typeof reasonText !== "string")
    ) {
      throw new BadRequestError("禁忌の解除の形が違います");
    }
    const deps = defaultDeps();
    const record = overrideContraindication(deps, defaultPinVerifier(), id, {
      drugId,
      pharmacistId,
      pin,
      reasonCode,
      reasonText: typeof reasonText === "string" ? reasonText : null,
    });
    return pharmacistView(record, deps.now());
  });
}
