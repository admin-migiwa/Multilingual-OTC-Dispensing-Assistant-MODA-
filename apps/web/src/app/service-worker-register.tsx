"use client";

import { useEffect } from "react";

/**
 * Service Worker（public/sw.js）を登録して、画面を端末に保持する（緊急案内をオフラインでも出すため）。
 *
 * 開発サーバー（pnpm dev）では、古い画面が残って確認しにくくなるため登録せず、以前に登録されたものも外す。
 * 本番用ビルド（pnpm build → pnpm start、または公開先）でだけ動く。
 * 登録のときにビルドごとの番号（next.config.ts の MODA_BUILD_ID）を渡し、古い保存がたまらないようにする。
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch((error: unknown) => {
          console.error("以前の Service Worker を外せませんでした", error);
        });
      return;
    }

    let cancelled = false;
    const buildId = process.env.MODA_BUILD_ID ?? "unknown";
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(buildId)}`)
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        if (cancelled) return;
        // Service Worker が動き出す前に読み込まれたファイルも、オフライン用に保存してもらう
        const urls = [
          window.location.pathname,
          ...performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((name) => name.startsWith(`${window.location.origin}/_next/static/`)),
        ];
        registration.active?.postMessage({ type: "cache-urls", urls });
      })
      .catch((error: unknown) => {
        // 登録に失敗しても画面そのものは使える。オフラインで出せないことだけを開発者に知らせる。
        console.error("Service Worker の登録に失敗しました", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
