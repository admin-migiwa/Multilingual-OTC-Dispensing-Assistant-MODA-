import { handle, readJson } from "@/server/http";
import { confirmDrugChoice } from "@/server/patient-confirmation";
import { defaultDeps, patientView } from "@/server/session-service";

export const dynamic = "force-dynamic";

/**
 * 患者さんの薬の確認（11/8 依頼主の判断）。
 * body: { choice: "ok" | "consult" | "reselect", quantities?: { [薬の記号]: 個数 }, packageChoice?, multipleCount? }
 * 形・個数の確かめはサーバー（packages/domain の checkConfirmQuantities と R02 の確かめ）で行う
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    return patientView(
      confirmDrugChoice(defaultDeps(), id, {
        choice: body.choice,
        quantities: body.quantities,
        packageChoice: body.packageChoice,
        multipleCount: body.multipleCount,
      }),
    );
  });
}
