import { approveSale } from "@/server/approval";
import { BadRequestError, handle, readJson } from "@/server/http";
import { pharmacistView } from "@/server/pharmacist-service";
import { defaultPinVerifier } from "@/server/pin";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/**
 * 薬剤師の PIN で承認し、同じ書き込みで販売記録を作る（T9a。CLAUDE.md 絶対に守るルール1）。
 * body: { pharmacistId: "P1", pin: "1234" }。PIN・手順・禁忌・問診はサーバーで確かめる。PIN はログに出さない
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    if (typeof body.pharmacistId !== "string" || typeof body.pin !== "string" || body.pin.length > 16) {
      throw new BadRequestError("薬剤師か PIN の形が違います");
    }
    const deps = defaultDeps();
    return pharmacistView(approveSale(deps, defaultPinVerifier(), id, { pharmacistId: body.pharmacistId, pin: body.pin }), deps.now());
  });
}
