/**
 * 画面の飾り（ロゴ・アイコン）。見た目だけで、動きには関係しない。
 * 外部のアイコンのライブラリは使わず、ここに SVG で描く。
 */

/** MODA のロゴマーク（吹き出しの中にカプセル：言葉と薬をつなぐ） */
export function ModaLogo({ className = "h-12 w-12" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="moda-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
      </defs>
      <path d="M8 6h32a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6H22l-9 7v-7H8a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6z" fill="url(#moda-logo-bg)" />
      <g transform="rotate(-35 24 22)">
        <rect x="13" y="17" width="22" height="10" rx="5" fill="#ffffff" />
        <path d="M24 17h6a5 5 0 0 1 0 10h-6z" fill="#99f6e4" />
      </g>
    </svg>
  );
}

/** ロゴと「MODA」の文字を並べた見出し */
export function ModaBrand({ size = "md" }: { size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <div className="flex items-center justify-center gap-2">
      <ModaLogo className={lg ? "h-14 w-14" : "h-9 w-9"} />
      <span className={`font-extrabold tracking-[0.2em] text-teal-800 ${lg ? "text-2xl" : "text-lg"}`}>MODA</span>
    </div>
  );
}

/** 言語ボタンの丸いしるし（国旗は使わない：言語と国は1対1ではないため） */
const LANGUAGE_BADGES: Record<string, { label: string; className: string }> = {
  ja: { label: "あ", className: "bg-rose-100 text-rose-700" },
  en: { label: "A", className: "bg-sky-100 text-sky-700" },
  "zh-Hans": { label: "简", className: "bg-orange-100 text-orange-700" },
  "zh-Hant": { label: "繁", className: "bg-amber-100 text-amber-800" },
  ko: { label: "가", className: "bg-violet-100 text-violet-700" },
  es: { label: "Ñ", className: "bg-lime-100 text-lime-800" },
  pt: { label: "Ç", className: "bg-emerald-100 text-emerald-700" },
  fr: { label: "É", className: "bg-indigo-100 text-indigo-700" },
  vi: { label: "Ơ", className: "bg-cyan-100 text-cyan-800" },
};

export function LanguageBadge({ code }: { code: string }) {
  const badge = LANGUAGE_BADGES[code] ?? { label: code.slice(0, 1).toUpperCase(), className: "bg-slate-100 text-slate-700" };
  return (
    <span
      aria-hidden="true"
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl font-bold ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}
