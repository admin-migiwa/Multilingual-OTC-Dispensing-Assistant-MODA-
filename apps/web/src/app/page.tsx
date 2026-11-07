import { LanguageStart } from "./language-start";

/**
 * 最初の画面：言語選択。
 * T3 では、言語を切り替えると定型文が変わるところまで。続きの画面は T7 で作る。
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-4 py-12 sm:px-6 [@media(max-height:820px)]:py-6">
      <div className="flex flex-col gap-10 rounded-[2rem] bg-white px-5 py-8 shadow-xl ring-1 shadow-teal-900/10 ring-teal-900/5 sm:px-10 sm:py-10 print:rounded-none print:p-0 print:shadow-none print:ring-0">
        <LanguageStart />
      </div>
    </main>
  );
}
