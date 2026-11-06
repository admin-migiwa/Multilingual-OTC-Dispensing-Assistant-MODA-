import { BadRequestError, handle, readJson } from "@/server/http";
import { decideEmergency, defaultDeps, patientView } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 薬剤師の判断を残す。body: { decision: "show_119" | "not_emergency" } */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    if (body.decision !== "show_119" && body.decision !== "not_emergency") {
      throw new BadRequestError("判断の形が違います");
    }
    return patientView(decideEmergency(defaultDeps(), id, body.decision));
  });
}
