import { startCounseling } from "@/server/guidance";
import { handle } from "@/server/http";
import { pharmacistView } from "@/server/pharmacist-service";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 患者さんの画面で服薬指導を始める（approved → counseling。T10） */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => {
    const deps = defaultDeps();
    return pharmacistView(startCounseling(deps, id), deps.now());
  });
}
