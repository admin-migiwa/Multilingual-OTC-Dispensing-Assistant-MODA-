import { handle } from "@/server/http";
import { defaultDeps, getSession, patientView } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 接客の今の状態と、次に聞く項目（患者さんの画面用。答えの中身は返さない） */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => patientView(getSession(defaultDeps(), id)));
}
