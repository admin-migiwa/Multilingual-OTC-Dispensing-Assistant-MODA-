import { printGuidance } from "@/server/guidance";
import { handle } from "@/server/http";
import { pharmacistView } from "@/server/pharmacist-service";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 説明書を印刷する（承認のあとだけ。CLAUDE.md ルール1。T10） */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => {
    const deps = defaultDeps();
    return pharmacistView(printGuidance(deps, id), deps.now());
  });
}
