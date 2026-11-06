import { BadRequestError, handle, readJson } from "@/server/http";
import { defaultDeps, openEmergency, patientView } from "@/server/session-service";

export const dynamic = "force-dynamic";

/**
 * 緊急の確認を開く（問診を止める）。body: { trigger: "keyword" | "staff", matchedRuleIds?, inputText? }
 * 緊急案内の画面そのものは、この API が失敗しても端末の中だけで出せる（CLAUDE.md 絶対に守るルール2）。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    if (body.trigger !== "keyword" && body.trigger !== "staff") throw new BadRequestError("きっかけの形が違います");
    const matched = body.matchedRuleIds ?? [];
    if (!Array.isArray(matched) || !matched.every((m) => typeof m === "string")) {
      throw new BadRequestError("当てはまった項目の形が違います");
    }
    const inputText = body.inputText ?? null;
    if (inputText !== null && typeof inputText !== "string") throw new BadRequestError("入力の形が違います");
    return patientView(openEmergency(defaultDeps(), id, { trigger: body.trigger, matchedRuleIds: matched, inputText }));
  });
}
