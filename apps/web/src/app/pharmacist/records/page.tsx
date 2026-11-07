import { SaleRecords } from "./sale-records";

/** 販売記録の一覧（T9a。薬剤師用・日本語）。/pharmacist/[id] より先に、この住所が使われる */
export default function SaleRecordsPage() {
  return (
    <main lang="ja" className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 px-6 py-10">
      <SaleRecords />
    </main>
  );
}
