import { giveFeedback } from "@/server/guidance";
import { BadRequestError, handle, readJson } from "@/server/http";
import { defaultDeps, patientView } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 患者さんの評価を残して接客を終える（T10）。body: { rating } */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    if (typeof body.rating !== "string") throw new BadRequestError("答えの形が違います");
    return patientView(giveFeedback(defaultDeps(), id, body.rating));
  });
}
