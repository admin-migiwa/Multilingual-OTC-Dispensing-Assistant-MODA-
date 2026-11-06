import { handle } from "@/server/http";
import { pharmacistView, returnToDrugSelection } from "@/server/pharmacist-service";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 「戻る」：薬の選択に戻す（薬剤師の確認 → 薬の選択） */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => {
    const deps = defaultDeps();
    return pharmacistView(returnToDrugSelection(deps, id), deps.now());
  });
}
