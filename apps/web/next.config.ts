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
    ];
  },
};

export default nextConfig;
