import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ワークスペース内の TypeScript パッケージをそのまま取り込む
  transpilePackages: ["@moda/domain", "@moda/i18n"],
  poweredByHeader: false,
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
