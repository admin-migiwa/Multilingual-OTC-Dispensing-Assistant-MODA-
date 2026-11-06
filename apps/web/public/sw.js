/* global self, caches, fetch, URL, Response */
/**
 * Service Worker：画面を端末に保持して、通信やサーバーが止まっていても緊急案内を出せるようにする
 * （CLAUDE.md 絶対に守るルール2、docs/design.md 10節「Service Worker（緊急案内の保持）」）。
 *
 * - 画面（HTML）と、画面のプログラム・見た目のファイル（/_next/static/）だけを保存する。
 * - API（/api/）は保存しない。患者さんの入力や健康情報はここを通らない（GET の画面だけを扱う）。
 * - 画面は「まず通信、だめなら保存したもの」。/_next/static/ は中身が変わらないので「保存したものを優先」。
 * - 保存の名前にビルドごとの番号を入れる（登録のときに /sw.js?v=番号 で渡す）。新しいビルドが入ると
 *   古い保存は消すので、たまらない。
 */
const BUILD_ID = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_NAME = `moda-shell-${BUILD_ID}`;
const START_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(START_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** 最初に開いたとき、Service Worker が動き出す前に読み込まれたファイルを、画面から教えてもらって保存する */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "cache-urls" || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((url) => typeof url === "string" && isCacheable(new URL(url, self.location.origin)));
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(urls.map((url) => cache.add(url).catch(() => undefined)))));
});

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return url.pathname === START_URL || url.pathname.startsWith("/_next/static/") || url.pathname === "/favicon.ico";
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate" || isCacheable(url)) {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok && isCacheable(new URL(request.url))) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    if (!response.ok && request.mode === "navigate") {
      // サーバーが止まりかけてエラー（502・503 など）を返したときも、保存した画面を出す
      const cached = (await caches.match(request)) ?? (await caches.match(START_URL));
      if (cached) return cached;
    }
    return response;
  } catch {
    const cached = (await caches.match(request)) ?? (request.mode === "navigate" ? await caches.match(START_URL) : undefined);
    if (cached) return cached;
    // 保存したものもないときは、推測で何かを返さずに失敗として返す（絶対に守るルール7）
    return Response.error();
  }
}
