import { listSaleRecords } from "@/server/approval";
import { handle } from "@/server/http";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/**
 * 販売記録の一覧（新しい順。薬剤師用の記録の一覧の画面で使う。患者さんの氏名は持たない）。
 * 接客の記号（sessionId）は返さない。ログインがなく誰でもこの一覧を開けるので、記号から他人の問診の答えを読んだり
 * 承認を取り消したりできないようにする（公開前の点検 11/8。一覧の画面は記号を使っていない）
 */
export async function GET() {
  return handle(() => ({
    records: listSaleRecords(defaultDeps().store.all()).map((sale) => ({
      id: sale.id,
      createdAt: sale.createdAt,
      versions: sale.versions,
    })),
  }));
}
