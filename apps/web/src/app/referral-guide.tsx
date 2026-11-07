import { getMessages, type LanguageCode } from "@moda/i18n";

import { INFO_PAGES } from "./emergency-guide";

/** 外国語で相談できるところとして紹介するページ（emergency.md の EP02・EP03）。119番の EP01 は出さない */
const CONSULT_PAGES = INFO_PAGES.filter((page) => page.label !== "ambulanceGuidePage");

/**
 * 受診をすすめる案内（T11。docs/demo-data/referral.md の RF01〜RF05、11/7 依頼主＝薬剤師が選んだ）。
 *
 * 薬剤師が「販売しない」を選んだとき、または通信が止まった画面で「受診をすすめる案内を出す」を押したときに、
 * 患者さんの言語で出す。
 * - 決まった文（packages/i18n の referral と、緊急案内と同じ JNTO・CLAIR の紹介）だけを出す。AI も自由な文も使わない。
 * - 文は画面のプログラムに組み込んであり、表示にサーバーへの通信を使わない（通信が止まっていても出せる）。
 * - 119番の案内はここには出さない（119番は薬剤師が緊急の確認をしてから出す。CLAUDE.md 絶対に守るルール2）。
 * - 近くの病院や公的な医療機関検索ページの QR は、ハッカソン版では出さない（backlog S-20）。
 * - 電話番号や URL は、デモで電話がかかったり画面が切り替わったりしないように、ただの文字で出す。
 */
export function ReferralGuide({ language }: { language: LanguageCode }) {
  const messages = getMessages(language);
  const t = messages.referral;
  const contacts = messages.emergency;
  return (
    <section lang={language} className="space-y-6 rounded-3xl border-4 border-sky-700 bg-sky-50 p-6" aria-live="polite">
      <h1 className="text-3xl font-bold text-sky-900">{t.title}</h1>
      <p className="text-2xl leading-relaxed">{t.body}</p>
      <p className="rounded-2xl bg-white px-5 py-4 text-xl leading-relaxed">{t.tellDoctor}</p>

      <div className="space-y-2 text-base text-slate-700">
        <p className="font-semibold">{t.consultTitle}</p>
        <ul className="space-y-3">
          <li>{contacts.visitorHotline}</li>
          {CONSULT_PAGES.map((page) => (
            <li key={page.url}>
              {contacts[page.label]}
              {/* デモで画面が切り替わらないように、押して開くリンクにしない */}
              <span lang="en" className="block break-all text-sm">
                {page.url}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xl font-semibold">{t.askStaff}</p>
    </section>
  );
}
