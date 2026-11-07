import { answerUnderstanding } from "@/server/guidance";
import { BadRequestError, handle, readJson } from "@/server/http";
import { defaultDeps, patientView } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 患者さんの「説明はわかりましたか？」の答え（T10）。body: { answer }。わかったら販売記録に版を足す */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    if (typeof body.answer !== "string") throw new BadRequestError("答えの形が違います");
    return patientView(answerUnderstanding(defaultDeps(), id, body.answer));
  });
}
