/**
 * API で受け取った本文を読む（http.ts から使う）。テストから読めるよう、フォルダの import を持たないファイルに分けている。
 */

export class BadRequestError extends Error {
  readonly code = "INVALID_REQUEST";
}

/**
 * ふつうの API で受け取る大きさの上限（64KB）。問診の答え・チャットの文・説明書などはこれに収まる。
 * 公開した URL に大きすぎる送信が来ても、サーバーのメモリを使い切って記録が消えないようにする（公開前の点検 11/8）
 */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/** 本文を上限まで読む。上限を超えたら、その場で読むのをやめて止める（content-length を偽った送信や、長さを書かない送信でも止まる） */
async function readTextWithin(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BadRequestError("送られた内容が大きすぎます");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BadRequestError("送られた内容が大きすぎます");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

export async function readJson(
  request: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const text = await readTextWithin(request, maxBytes);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BadRequestError("送られた内容を読み取れません");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("送られた内容の形が違います");
  }
  return body as Record<string, unknown>;
}
