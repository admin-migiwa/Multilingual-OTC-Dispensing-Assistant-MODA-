import { BadRequestError, handle, readJson } from "@/server/http";
import { defaultDeps, patientView, recordEmergencyFollowUp } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 緊急の確認画面の追加の質問・つらさの数字・観察の印を残す。body: { answers, scale, observedRuleIds } */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    const answers = body.answers ?? {};
    if (
      answers === null ||
      typeof answers !== "object" ||
      Array.isArray(answers) ||
      !Object.values(answers).every((v) => typeof v === "string")
    ) {
      throw new BadRequestError("追加の質問の答えの形が違います");
    }
    const scale = body.scale ?? null;
    if (scale !== null && typeof scale !== "number") throw new BadRequestError("つらさの数字の形が違います");
    const observed = body.observedRuleIds ?? [];
    if (!Array.isArray(observed) || !observed.every((o) => typeof o === "string")) {
      throw new BadRequestError("観察の印の形が違います");
    }
    return patientView(
      recordEmergencyFollowUp(defaultDeps(), id, {
        answers: answers as Record<string, string>,
        scale,
        observedRuleIds: observed,
      }),
    );
  });
}
