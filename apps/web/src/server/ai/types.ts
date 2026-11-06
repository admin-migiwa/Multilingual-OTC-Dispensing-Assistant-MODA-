/**
 * AI の呼び出し口の決まり（CLAUDE.md「技術構成」・design.md 3節）。
 *
 * - 呼び出し口はこのフォルダの1か所だけ。接続先（仮の AI・Claude API・あとで Bedrock）は index.ts の差し替えで切り替え、
 *   ほかの処理に接続先ごとの分岐を書かない。
 * - AI の答えは「決められた JSON の形」で受け取り、使う側で必ず形を確かめる（CLAUDE.md 絶対に守るルール8）。
 *   ここで返すのは「まだ確かめていない JSON」（unknown）。
 * - 失敗したときは AiError で止める。仮のデータや推測で続けない（ルール7）。
 * - 送った文や AI の答えをログに出さない（ルール9）。
 */

/** どの仕事か。仮の AI はこれを見て決まった答えを返す */
export type AiTask = "translate" | "back_translate" | "read_product";

export type AiImageType = "image/jpeg" | "image/png" | "image/webp";

export type AiContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly mediaType: AiImageType; readonly base64: string };

export interface AiRequest {
  readonly task: AiTask;
  /** AI への指示（患者さんの文はここに入れず、content に「データ」として入れる） */
  readonly system: string;
  readonly content: readonly AiContent[];
  /** 答えの JSON の形（JSON Schema）。Claude API にはこの形でしか答えられないように渡す */
  readonly schema: Record<string, unknown>;
}

export interface AiClient {
  /** どの接続先か（画面に「仮の AI」と出すため） */
  readonly provider: "mock" | "anthropic";
  generateJson(request: AiRequest): Promise<unknown>;
}

export type AiErrorCode =
  /** 接続先の設定がない（AI_PROVIDER=anthropic なのに ANTHROPIC_API_KEY がない、など） */
  | "AI_NOT_CONFIGURED"
  /** 通信の失敗・時間切れ・AI 側のエラー */
  | "AI_UNAVAILABLE"
  /** 答えが決められた形でない・途中で切れた */
  | "AI_INVALID_OUTPUT"
  /** AI が安全上の理由で答えなかった */
  | "AI_REFUSED";

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "AiError";
  }
}
