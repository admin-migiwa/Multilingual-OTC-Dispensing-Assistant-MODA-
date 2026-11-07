import { BadRequestError, handle, readJson } from "@/server/http";
import { chooseRoute, defaultDeps, patientView } from "@/server/session-service";

export const dynamic = "force-dynamic";

/**
 * 問診の流れを選ぶ。body: { route: "product" | "symptom", symptomText? }
 * （ほしい薬がある／症状から探す。11/6 依頼主の判断）
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    if (body.route !== "product" && body.route !== "symptom") throw new BadRequestError("流れの形が違います");
    const symptomText = body.symptomText ?? null;
    if (symptomText !== null && typeof symptomText !== "string") throw new BadRequestError("症状の形が違います");
    return patientView(chooseRoute(defaultDeps(), id, body.route, symptomText));
  });
}
