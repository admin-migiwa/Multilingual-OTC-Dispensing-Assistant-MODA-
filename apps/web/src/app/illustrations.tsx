import type { ReactNode } from "react";

/**
 * 患者さんの画面のイラストと、画面の補足（「この画面ですること」・いまどの段階か）。
 * 見た目だけで、動きには関係しない。外部のライブラリは使わず、SVG で描く。
 * 色はティールと空色を基調にする（緊急の赤・注意の琥珀は、意味がまぎれるので使わない）。
 */

type IllustProps = { className?: string };
const SKIN = "#f5c9a6";
const HAIR = "#334155";

/** 患者さんと薬剤師が、ちがう言葉で話している絵（言語選択） */
export function IllustWelcome({ className = "h-28 w-40" }: IllustProps) {
  return (
    <svg viewBox="0 0 160 112" aria-hidden="true" className={className}>
      <ellipse cx="80" cy="104" rx="70" ry="6" fill="#ccfbf1" />
      {/* 患者さん */}
      <path d="M22 104c0-20 8-32 22-32s22 12 22 32z" fill="#38bdf8" />
      <circle cx="44" cy="56" r="13" fill={SKIN} />
      <path d="M31 54a13 13 0 0 1 26-2c-6-1-14-4-18-8-2 4-5 8-8 10z" fill={HAIR} />
      {/* 薬剤師（白衣） */}
      <path d="M94 104c0-20 8-32 22-32s22 12 22 32z" fill="#ffffff" stroke="#5eead4" strokeWidth="2" />
      <path d="M116 72v32" stroke="#5eead4" strokeWidth="2" />
      <circle cx="116" cy="56" r="13" fill={SKIN} />
      <path d="M103 54a13 13 0 0 1 26 0c-8 0-18-2-26 0z" fill="#475569" />
      <rect x="120" y="82" width="9" height="6" rx="1.5" fill="#14b8a6" />
      {/* 吹き出し */}
      <path d="M8 6h40a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6H34l-6 7v-7H8a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6z" fill="#e0f2fe" />
      <text x="28" y="24.5" textAnchor="middle" fontSize="14" fontWeight="700" fill="#0369a1">
        Hi!
      </text>
      <path d="M106 6h46a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6h-20l-6 7v-7h-20a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6z" fill="#ccfbf1" />
      <text x="129" y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0f766e">
        こんにちは
      </text>
      <path
        d="M64 22h30M86 16l8 6-8 6M72 16l-8 6 8 6"
        stroke="#2dd4bf"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 薬の箱とカプセル（ほしい薬がある） */
export function IllustMedicine({ className = "h-16 w-16" }: IllustProps) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <circle cx="32" cy="32" r="30" fill="#ccfbf1" />
      <rect x="14" y="20" width="26" height="30" rx="3" fill="#ffffff" stroke="#0f766e" strokeWidth="2.5" />
      <rect x="14" y="20" width="26" height="8" rx="3" fill="#14b8a6" />
      <path d="M27 34v10M22 39h10" stroke="#0f766e" strokeWidth="3" strokeLinecap="round" />
      <g transform="rotate(-40 46 40)">
        <rect x="37" y="35" width="20" height="10" rx="5" fill="#ffffff" stroke="#0f766e" strokeWidth="2" />
        <path d="M47 35h5a5 5 0 0 1 0 10h-5z" fill="#2dd4bf" />
      </g>
    </svg>
  );
}

/** 体温計と人（症状から探す） */
export function IllustSymptom({ className = "h-16 w-16" }: IllustProps) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <circle cx="32" cy="32" r="30" fill="#e0f2fe" />
      <path d="M12 56c0-12 6-19 16-19s16 7 16 19z" fill="#38bdf8" />
      <circle cx="28" cy="25" r="10" fill={SKIN} />
      <path d="M18 23a10 10 0 0 1 20-1c-6 0-12-2-20 1z" fill={HAIR} />
      <rect x="44" y="10" width="7" height="30" rx="3.5" fill="#ffffff" stroke="#0369a1" strokeWidth="2" />
      <circle cx="47.5" cy="42" r="6" fill="#0ea5e9" stroke="#0369a1" strokeWidth="2" />
      <rect x="46" y="22" width="3" height="18" rx="1.5" fill="#0ea5e9" />
    </svg>
  );
}

/** 問診票とチェック（1問ずつの問診） */
export function IllustQuestion({ className = "h-16 w-16" }: IllustProps) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <circle cx="32" cy="32" r="30" fill="#ccfbf1" />
      <rect x="16" y="12" width="32" height="42" rx="4" fill="#ffffff" stroke="#0f766e" strokeWidth="2.5" />
      <rect x="25" y="8" width="14" height="8" rx="2" fill="#14b8a6" />
      <path
        d="M21 26l3 3 5-6M21 38l3 3 5-6"
        stroke="#14b8a6"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M33 27h10M33 39h10" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="47" cy="48" r="9" fill="#0f766e" />
      <text x="47" y="52.5" textAnchor="middle" fontSize="13" fontWeight="800" fill="#ffffff">
        ?
      </text>
    </svg>
  );
}

/** iPad を持った薬剤師（薬剤師の確認待ち） */
export function IllustPharmacist({ className = "h-24 w-24" }: IllustProps) {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" className={className}>
      <circle cx="48" cy="48" r="46" fill="#ccfbf1" />
      <path d="M20 92c0-24 12-36 28-36s28 12 28 36z" fill="#ffffff" stroke="#5eead4" strokeWidth="2" />
      <path d="M48 56v36" stroke="#5eead4" strokeWidth="2" />
      <circle cx="48" cy="36" r="15" fill={SKIN} />
      <path d="M33 34a15 15 0 0 1 30 0c-10 0-20-3-30 0z" fill="#475569" />
      <rect x="52" y="62" width="24" height="18" rx="3" fill="#0f766e" />
      <rect x="55" y="65" width="18" height="12" rx="1.5" fill="#99f6e4" />
      <path d="M58 71l3 3 6-6" stroke="#0f766e" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 説明書とカプセル（お薬の説明） */
export function IllustLeaflet({ className = "h-16 w-16" }: IllustProps) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <circle cx="32" cy="32" r="30" fill="#ccfbf1" />
      <path
        d="M16 10h22l10 10v34a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3z"
        fill="#ffffff"
        stroke="#0f766e"
        strokeWidth="2.5"
      />
      <path d="M38 10v10h10" fill="#99f6e4" stroke="#0f766e" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M19 28h22M19 35h22M19 42h14" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
      <g transform="rotate(-35 46 48)">
        <rect x="36" y="43" width="20" height="10" rx="5" fill="#ffffff" stroke="#0f766e" strokeWidth="2" />
        <path d="M46 43h5a5 5 0 0 1 0 10h-5z" fill="#2dd4bf" />
      </g>
    </svg>
  );
}

/** 紙袋とハート（お会計・お礼） */
export function IllustThanks({ className = "h-16 w-16" }: IllustProps) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <circle cx="32" cy="32" r="30" fill="#ccfbf1" />
      <path d="M24 22v-4a8 8 0 0 1 16 0v4" stroke="#0f766e" strokeWidth="2.5" fill="none" />
      <path d="M15 22h34l-3 32H18z" fill="#14b8a6" stroke="#0f766e" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M32 46c-6-4-9-7-9-10.5a4.5 4.5 0 0 1 9-1.5 4.5 4.5 0 0 1 9 1.5c0 3.5-3 6.5-9 10.5z" fill="#ffffff" />
    </svg>
  );
}

/** 救急車（119番の案内の赤い帯の中。白と赤だけで描く） */
export function IllustAmbulance({ className = "h-12 w-16" }: IllustProps) {
  return (
    <svg viewBox="0 0 64 44" aria-hidden="true" className={className}>
      <path d="M4 10h34v26H4z" fill="#ffffff" />
      <path d="M38 16h12l10 10v10H38z" fill="#ffffff" />
      <path d="M42 19h7l6 7H42z" fill="#fecaca" />
      <path d="M17 15h6v5h5v6h-5v5h-6v-5h-5v-6h5z" fill="#b91c1c" />
      <rect x="14" y="5" width="8" height="5" rx="1.5" fill="#fecaca" />
      <circle cx="15" cy="37" r="5" fill="#7f1d1d" stroke="#ffffff" strokeWidth="2" />
      <circle cx="49" cy="37" r="5" fill="#7f1d1d" stroke="#ffffff" strokeWidth="2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------

/** 画面の上の「この画面ですること」（絵と短い説明） */
export function ScreenGuide({ illustration, text }: { illustration: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-teal-50 px-4 py-3 ring-1 ring-teal-100">
      <div className="shrink-0">{illustration}</div>
      <p className="min-w-0 text-lg font-semibold leading-snug break-words text-teal-900">{text}</p>
    </div>
  );
}

export type Step = 1 | 2 | 3 | 4;

/** いまどの段階か（1 質問に答える → 2 薬剤師が確認 → 3 お薬の説明 → 4 お会計） */
export function StepBar({ current, labels }: { current: Step; labels: readonly [string, string, string, string] }) {
  return (
    <ol className="grid grid-cols-4 gap-1">
      {labels.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const now = n === current;
        return (
          <li
            key={n}
            className="relative flex flex-col items-center gap-1.5 text-center"
            aria-current={now ? "step" : undefined}
          >
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={`absolute top-4 right-1/2 h-1 w-full -translate-y-1/2 rounded-full ${n <= current ? "bg-teal-500" : "bg-slate-200"}`}
              />
            ) : null}
            <span
              className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                now
                  ? "bg-teal-600 text-white ring-4 ring-teal-100"
                  : done
                    ? "bg-teal-500 text-white"
                    : "bg-slate-200 text-slate-500"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span className={`text-xs leading-tight break-words sm:text-sm ${now ? "font-bold text-teal-800" : "text-slate-500"}`}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
