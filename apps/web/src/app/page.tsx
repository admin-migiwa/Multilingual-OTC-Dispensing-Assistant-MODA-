import { LANGUAGES } from "@moda/i18n";

/**
 * 言語選択画面（仮）。
 * 初期構成の動作確認用で、まだボタンを押しても何も起きない。
 * 実際の画面は段階4「縦に一本通す」で作る。
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-6 py-12">
      <header className="space-y-2 text-center">
        <p className="text-sm font-semibold tracking-widest text-teal-700">MODA</p>
        <h1 className="text-3xl font-bold">言語を選んでください</h1>
        <p className="text-lg text-slate-600">Please select your language</p>
      </header>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {LANGUAGES.map((lang) => (
          <li key={lang.code}>
            <button
              type="button"
              lang={lang.code}
              className="flex min-h-20 w-full items-center justify-center rounded-2xl border-2 border-slate-200 px-4 text-xl font-semibold transition hover:border-teal-600 hover:bg-teal-50 focus-visible:outline-4 focus-visible:outline-teal-600"
            >
              {lang.nativeName}
            </button>
          </li>
        ))}
      </ul>

      <p className="text-center text-sm text-slate-400">開発中の画面です</p>
    </main>
  );
}
