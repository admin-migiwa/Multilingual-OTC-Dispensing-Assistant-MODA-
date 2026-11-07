import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ワークスペース内の TypeScript パッケージをそのまま取り込む
  transpilePackages: ["@moda/domain", "@moda/i18n"],
  poweredByHeader: false,
  // 開発サーバー（pnpm dev）を同じ Wi-Fi の iPad から開くときだけ、PC の住所を環境変数で足す
  // （例 MODA_DEV_ORIGINS=192.168.x.x。ふだんは空。住所はリポジトリに書かない）
  allowedDevOrigins: (process.env.MODA_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  // ビルドごとの番号。Service Worker の保存の名前に使い、古い保存がたまらないようにする（秘密の値ではない）
  env: { MODA_BUILD_ID: String(Date.now()) },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          // カメラとマイクは自分のサイトからだけ使える
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ],
      },
      {
        // Service Worker（緊急案内の保持）は、更新がすぐ届くように毎回確認させる
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

export default nextConfig;
