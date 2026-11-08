import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AiError, type AiClient, type AiRequest } from "./ai/index.ts";
import { aiRateLimitsFromEnv, DEFAULT_AI_RATE_LIMITS, rateLimitedAiClient } from "./ai/rate-limit.ts";
import { BadRequestError, DEFAULT_MAX_BODY_BYTES, readJson } from "./read-body.ts";
import { boundedMapStore, type SessionRecord } from "./session-service.ts";

// 公開した URL で、誰でも API を呼べることへの備え（公開前の点検 11/8）

const request: AiRequest = { task: "translate", system: "", content: [], schema: {} };

function countingClient(): AiClient & { calls: number } {
  const client = {
    provider: "mock" as const,
    calls: 0,
    generateJson: async () => {
      client.calls += 1;
      return {};
    },
  };
  return client;
}

describe("AI を呼ぶ回数の上限", () => {
  it("1分の上限を超えた呼び出しは AI を呼ばずに AI_UNAVAILABLE で止める", async () => {
    const inner = countingClient();
    let t = 0;
    const client = rateLimitedAiClient(inner, { perMinute: 2, perHour: 100 }, () => t);
    await client.generateJson(request);
    await client.generateJson(request);
    await assert.rejects(client.generateJson(request), (e) => e instanceof AiError && e.code === "AI_UNAVAILABLE");
    assert.equal(inner.calls, 2);
    t = 60_001;
    await client.generateJson(request);
    assert.equal(inner.calls, 3);
  });

  it("1時間の上限を超えた呼び出しも止め、1時間たてば呼べる", async () => {
    const inner = countingClient();
    let t = 0;
    const client = rateLimitedAiClient(inner, { perMinute: 100, perHour: 3 }, () => t);
    for (let i = 0; i < 3; i++) {
      t = i * 120_000;
      await client.generateJson(request);
    }
    t = 30 * 60_000;
    await assert.rejects(client.generateJson(request), (e) => e instanceof AiError && e.code === "AI_UNAVAILABLE");
    t = 60 * 60_000 + 1;
    await client.generateJson(request);
    assert.equal(inner.calls, 4);
  });

  it("環境変数が正の整数でなければ決まった上限を使う", () => {
    assert.deepEqual(aiRateLimitsFromEnv({}), DEFAULT_AI_RATE_LIMITS);
    assert.deepEqual(aiRateLimitsFromEnv({ AI_MAX_CALLS_PER_MINUTE: "0", AI_MAX_CALLS_PER_HOUR: "abc" }), DEFAULT_AI_RATE_LIMITS);
    assert.deepEqual(aiRateLimitsFromEnv({ AI_MAX_CALLS_PER_MINUTE: "5", AI_MAX_CALLS_PER_HOUR: "50" }), { perMinute: 5, perHour: 50 });
  });
});

describe("受け取る本文の大きさの上限", () => {
  it("上限より大きい本文は読まずに止める（長さを書かない送信でも止まる）", async () => {
    const big = JSON.stringify({ text: "a".repeat(DEFAULT_MAX_BODY_BYTES) });
    const chunked = new Request("http://localhost/api", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(big));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    await assert.rejects(readJson(chunked), (e) => e instanceof BadRequestError);
    const declared = new Request("http://localhost/api", { method: "POST", body: big });
    await assert.rejects(readJson(declared), (e) => e instanceof BadRequestError);
  });

  it("上限以内の本文はふつうに読める。写真の API は大きい上限を渡せる", async () => {
    const small = new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ text: "こんにちは" }) });
    assert.deepEqual(await readJson(small), { text: "こんにちは" });
    const photo = JSON.stringify({ base64: "a".repeat(DEFAULT_MAX_BODY_BYTES * 2) });
    assert.equal(
      (await readJson(new Request("http://localhost/api", { method: "POST", body: photo }), 6 * 1024 * 1024)).base64,
      "a".repeat(DEFAULT_MAX_BODY_BYTES * 2),
    );
  });
});

describe("メモリに置く接客の数の上限", () => {
  const rec = (id: string, sold = false) => ({ id, ...(sold ? { saleRecord: { id: `s-${id}` } } : {}) }) as unknown as SessionRecord;

  it("上限を超えたら、いちばん長く更新されていない接客から消す", () => {
    const store = boundedMapStore(new Map(), 2);
    store.set(rec("a"));
    store.set(rec("b"));
    store.set(rec("a")); // a を更新したので、いちばん古いのは b
    store.set(rec("c"));
    assert.equal(store.get("b"), undefined);
    assert.ok(store.get("a"));
    assert.ok(store.get("c"));
  });

  it("読んだだけの接客も、いま使っているものとして消しにくくする", () => {
    const store = boundedMapStore(new Map(), 2);
    store.set(rec("a"));
    store.set(rec("b"));
    store.get("a"); // 薬剤師が画面で見ている
    store.set(rec("c"));
    assert.equal(store.get("b"), undefined);
    assert.ok(store.get("a"));
  });

  it("販売記録のある接客は、上限を超えても消さない", () => {
    const store = boundedMapStore(new Map(), 2);
    store.set(rec("sold1", true));
    store.set(rec("sold2", true));
    store.set(rec("new"));
    assert.ok(store.get("sold1"));
    assert.ok(store.get("sold2"));
    assert.ok(store.get("new"));
  });
});
