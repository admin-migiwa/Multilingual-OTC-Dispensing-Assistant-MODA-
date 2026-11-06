import { PharmacistReview } from "../pharmacist-review";

/** 薬剤師の確認画面（T8a）。患者さんの画面とは別の住所にする */
export default async function PharmacistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main lang="ja" className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 px-6 py-10">
      <PharmacistReview sessionId={id} />
    </main>
  );
}
