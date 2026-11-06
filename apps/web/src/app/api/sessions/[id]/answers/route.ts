import type { InterviewAnswers } from "@moda/domain";

import { BadRequestError, handle, readJson } from "@/server/http";
import { answer, defaultDeps, patientView } from "@/server/session-service";

export const dynamic = "force-dynamic";

/**
 * 問診の答えを受け取る。body: { answers: { age: 30 } など }
 * 中身の確かめは packages/domain のルールで行う（決められた形でなければ 400 と code を返す）。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    const answers = body.answers;
    if (answers === null || typeof answers !== "object" || Array.isArray(answers)) {
      throw new BadRequestError("答えの形が違います");
    }
    return patientView(answer(defaultDeps(), id, answers as InterviewAnswers));
  });
}
