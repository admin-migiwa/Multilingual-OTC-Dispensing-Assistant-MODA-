import { LanguageStart } from "./language-start";

/**
 * 最初の画面：言語選択。
 * T3 では、言語を切り替えると定型文が変わるところまで。続きの画面は T7 で作る。
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-6 py-12">
      <LanguageStart />
      <p className="text-center text-sm text-slate-400">開発中の画面です</p>
    </main>
  );
}
