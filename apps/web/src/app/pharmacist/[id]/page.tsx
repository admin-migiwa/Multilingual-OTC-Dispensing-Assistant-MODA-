import { PharmacistReview } from "../pharmacist-review";

/** 薬剤師の確認画面（T8a）。患者さんの画面とは別の住所にする */
export default async function PharmacistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    // 薬剤師だけが見る画面は、患者さんの画面（ティール）と色調を分ける（藍色と灰色）
    <div className="min-h-dvh bg-slate-200 bg-[radial-gradient(circle_at_10%_0%,#c7d2fe_0,transparent_45%),radial-gradient(circle_at_90%_100%,#cbd5e1_0,transparent_50%)] print:bg-white print:bg-none">
      <main lang="ja" className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 px-6 py-10">
        <PharmacistReview sessionId={id} />
      </main>
    </div>
  );
}
