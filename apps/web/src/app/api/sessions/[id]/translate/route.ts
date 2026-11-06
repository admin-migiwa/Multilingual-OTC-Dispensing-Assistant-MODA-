import { defaultAiClient } from "@/server/ai";
import { BadRequestError, handle, readJson } from "@/server/http";
import { defaultDeps } from "@/server/session-service";
import { translate, type TranslationDeps } from "@/server/translation";

export const dynamic = "force-dynamic";

/**
 * 自由入力の翻訳と訳し戻し（T13）。body: { direction: "to_ja" | "to_patient", text }
 * - to_ja：患者さんの文 → 日本語。AI の緊急フラグとキーワード照合で、緊急なら問診を止める（spec.md 決まったこと No.38）
 * - to_patient：薬剤師の日本語 → 患者さんの言語
 * 答えは「参考訳（AI の訳）」として出す。AI が失敗したらエラーで止める（CLAUDE.md 絶対に守るルール7）。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    if (body.direction !== "to_ja" && body.direction !== "to_patient") throw new BadRequestError("訳す向きの形が違います");
    if (typeof body.text !== "string") throw new BadRequestError("訳す文の形が違います");
    // AI は読んだときに作る（AI の設定がなくても、先にキーワード照合で問診を止められるように）
    const deps: TranslationDeps = {
      ...defaultDeps(),
      get ai() {
        return defaultAiClient();
      },
    };
    return translate(deps, id, { direction: body.direction, text: body.text });
  });
}
