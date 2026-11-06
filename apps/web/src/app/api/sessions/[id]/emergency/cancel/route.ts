import { handle } from "@/server/http";
import { cancelEmergency119, defaultDeps, patientView } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 「119番の案内を出す」を、薬剤師が押し間違いとして取り消す（11/6 依頼主の判断）。もとの判断は記録に残す */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => patientView(cancelEmergency119(defaultDeps(), id)));
}
