import { defaultAiClient } from "@/server/ai";
import { BadRequestError, handle, readJson } from "@/server/http";
import { identifyFromPhoto, identifyFromText } from "@/server/product-identify";

export const dynamic = "force-dynamic";

/** 受け取る大きさの上限（写真 5MB の base64 ＋ 余白）。読み込む前に止めて、大きすぎる送信でメモリを使い切らないようにする */
const MAX_BODY_BYTES = 6 * 1024 * 1024;

/**
 * 写真や入力した名前から、取扱薬の候補を出す（T12）。
 * body：{ text } または { consent: true, image: { mediaType, base64 } }
 * - 写真は撮影前の同意があるときだけ受け取り、AI に文字を読ませたら捨てる。保存もログ出しもしない（spec.md 決まったこと No.27）
 * - 返すのは「候補」。薬剤師が確かめて選ぶ（CLAUDE.md 絶対に守るルール10）
 */
export async function POST(request: Request) {
  return handle(async () => {
    const length = Number(request.headers.get("content-length") ?? "");
    if (!Number.isFinite(length) || length <= 0 || length > MAX_BODY_BYTES) {
      throw new BadRequestError("送られた内容が大きすぎるか、大きさがわかりません");
    }
    const body = await readJson(request, MAX_BODY_BYTES);
    if (typeof body.text === "string") return identifyFromText(body.text);
    const image = body.image as Record<string, unknown> | null | undefined;
    if (!image || typeof image !== "object" || typeof image.mediaType !== "string" || typeof image.base64 !== "string") {
      throw new BadRequestError("写真の形が違います");
    }
    return identifyFromPhoto(defaultAiClient(), {
      consent: body.consent === true,
      mediaType: image.mediaType,
      base64: image.base64,
    });
  });
}
