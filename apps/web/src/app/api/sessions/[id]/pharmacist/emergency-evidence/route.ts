import { emergencyEvidence } from "@/server/emergency-evidence";
import { handle } from "@/server/http";
import { defaultDeps, getSession } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 緊急の根拠（入力された文・当てはまった項目・追加の答え・判断）。薬剤師の画面だけが使う（backlog C-08） */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => emergencyEvidence(getSession(defaultDeps(), id)));
}
