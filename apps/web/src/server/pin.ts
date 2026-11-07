/**
 * 薬剤師の本人確認（PIN）。ハッカソン版の最小の作り（docs/backlog.md S-09。design.md「薬剤師の本人確認」）。
 *
 * - 薬剤師は架空の一覧から選ぶ（実在の氏名は使わない）。
 * - PIN はコードにもリポジトリにも書かず、サーバーの環境変数 MODA_PHARMACIST_PINS（例 "P1:1234,P2:5678"）から読む
 *   （CLAUDE.md 絶対に守るルール9）。設定がなければ、仮の PIN で通さずに止める（ルール7）。
 * - 比べるときは、両方を SHA-256 にして長さをそろえ、timingSafeEqual で比べる。
 * - 同じ薬剤師の失敗が続いたら一時ロックする（回数と時間は下の定数。試験運用で決め直す）。
 * - PIN・失敗回数はログにも接客の記録にも出さない。
 * - すべて同期の処理にする（承認の処理の中で await をはさまないため。承認と販売記録の作成を、ほかの処理と重ならずに1回で書くため）。
 */

import { createHash, timingSafeEqual } from "node:crypto";

export interface Pharmacist {
  readonly id: string;
  /** 表示名（架空） */
  readonly name: string;
}

/** 架空の薬剤師の一覧（ハッカソン版。本番は店舗ごとのユーザー管理。design.md 5節） */
export const PHARMACISTS: readonly Pharmacist[] = [
  { id: "P1", name: "薬剤師A（架空）" },
  { id: "P2", name: "薬剤師B（架空）" },
];

/** 続けて失敗したらロックする回数と、ロックする時間 */
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MINUTES = 5;

export type PinErrorCode = "PIN_NOT_CONFIGURED" | "PIN_INVALID" | "PIN_LOCKED" | "UNKNOWN_PHARMACIST";

export class PinError extends Error {
  readonly code: PinErrorCode;
  constructor(code: PinErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "PinError";
  }
}

export interface PinVerifier {
  /** PIN が正しければ薬剤師を返す。違えば PinError（記録は変えない） */
  verify(pharmacistId: string, pin: string, now: Date): Pharmacist;
}

interface FailureState {
  count: number;
  lockedUntil: number | null;
}

const PIN_SHAPE = /^\d{4,8}$/;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** "P1:1234,P2:5678" を読む。形が違えば設定の誤りとして止める */
function parsePins(raw: string | undefined): Map<string, Buffer> {
  if (raw === undefined || raw.trim() === "") {
    throw new PinError("PIN_NOT_CONFIGURED", "薬剤師の PIN が設定されていません（MODA_PHARMACIST_PINS）");
  }
  const pins = new Map<string, Buffer>();
  for (const part of raw.split(",")) {
    const [id, pin] = part.split(":").map((s) => s.trim());
    if (!id || !pin || !PIN_SHAPE.test(pin) || !PHARMACISTS.some((p) => p.id === id)) {
      // 中身（PIN）はメッセージに入れない
      throw new PinError("PIN_NOT_CONFIGURED", "薬剤師の PIN の設定の形が違います（MODA_PHARMACIST_PINS）");
    }
    pins.set(id, digest(pin));
  }
  return pins;
}

/**
 * PIN の確かめ役を作る。env は環境変数（テストでは値を渡す）、failures は失敗の数を置く入れ物（薬剤師ごと）。
 * 設定の読み込みは確かめるときに行う（設定がなくても、PIN を使わない画面は動くように）。
 */
export function createPinVerifier(env: string | undefined, failures: Map<string, FailureState> = new Map()): PinVerifier {
  return {
    verify(pharmacistId, pin, now) {
      const pharmacist = PHARMACISTS.find((p) => p.id === pharmacistId);
      if (!pharmacist) throw new PinError("UNKNOWN_PHARMACIST", "薬剤師が一覧にありません");
      const pins = parsePins(env);
      const state = failures.get(pharmacistId) ?? { count: 0, lockedUntil: null };
      if (state.lockedUntil !== null) {
        if (now.getTime() < state.lockedUntil) throw new PinError("PIN_LOCKED", "PIN を続けて間違えたため、しばらく使えません");
        state.count = 0;
        state.lockedUntil = null;
      }
      const expected = pins.get(pharmacistId);
      // 一覧にいる薬剤師の PIN が設定にないのは設定の誤り。失敗の回数には数えずに止める（ルール7）
      if (expected === undefined) {
        throw new PinError("PIN_NOT_CONFIGURED", "この薬剤師の PIN が設定されていません（MODA_PHARMACIST_PINS）");
      }
      const ok = PIN_SHAPE.test(pin) && timingSafeEqual(digest(pin), expected);
      if (!ok) {
        state.count += 1;
        if (state.count >= PIN_MAX_FAILURES) state.lockedUntil = now.getTime() + PIN_LOCK_MINUTES * 60_000;
        failures.set(pharmacistId, state);
        throw new PinError(state.lockedUntil !== null ? "PIN_LOCKED" : "PIN_INVALID", "PIN が違います");
      }
      failures.delete(pharmacistId);
      return pharmacist;
    },
  };
}

/** サーバーで使う確かめ役（失敗の数は、開発サーバーの読み直しで消えないよう globalThis に置く） */
export function defaultPinVerifier(): PinVerifier {
  const holder = globalThis as unknown as { __modaPinFailures?: Map<string, FailureState> };
  holder.__modaPinFailures ??= new Map();
  return createPinVerifier(process.env.MODA_PHARMACIST_PINS, holder.__modaPinFailures);
}
