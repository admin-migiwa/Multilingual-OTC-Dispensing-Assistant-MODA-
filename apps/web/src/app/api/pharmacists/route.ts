import { handle } from "@/server/http";
import { PHARMACISTS } from "@/server/pin";

export const dynamic = "force-dynamic";

/** 承認するときに選ぶ薬剤師の一覧（架空。ID と表示名だけ。PIN は返さない） */
export async function GET() {
  return handle(() => ({ pharmacists: PHARMACISTS }));
}
