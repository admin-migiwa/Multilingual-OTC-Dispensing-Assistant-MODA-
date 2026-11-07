import { listSaleRecords } from "@/server/approval";
import { handle } from "@/server/http";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 販売記録の一覧（新しい順。薬剤師用の記録の一覧の画面で使う。患者さんの氏名は持たない） */
export async function GET() {
  return handle(() => ({ records: listSaleRecords(defaultDeps().store.all()) }));
}
