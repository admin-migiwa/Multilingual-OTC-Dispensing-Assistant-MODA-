import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { ServiceWorkerRegister } from "./service-worker-register";

export const metadata: Metadata = {
  title: "MODA",
  description: "Multilingual OTC Dispensing Assistant",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      {/* 背景は淡いティールの重ね合わせ（ぼかしは iPad で重くなるので使わない）。印刷のときは白 */}
      <body className="min-h-dvh bg-teal-50 bg-[radial-gradient(circle_at_10%_0%,#ccfbf1_0,transparent_45%),radial-gradient(circle_at_90%_100%,#e0f2fe_0,transparent_50%)] text-slate-900 antialiased print:bg-white print:bg-none">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
