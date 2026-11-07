import { cancelApproval } from "@/server/approval";
import { backToCounseling, resetUnderstanding } from "@/server/guidance";
import { BadRequestError, handle, readJson } from "@/server/http";
import { cancelDecline, pharmacistView } from "@/server/pharmacist-service";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/**
 * 工程を1つ戻す（11/7 依頼主の判断。PIN は求めない）。body: { step: "cancel_approval" | "reset_understanding" | "back_to_counseling" | "cancel_decline" }
 * どの状態から戻せるかは packages/domain の undoStep が決める。販売記録は消さずに版を足す（ルール6）
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    const deps = defaultDeps();
    switch (body.step) {
      case "cancel_approval":
        return pharmacistView(cancelApproval(deps, id), deps.now());
      case "reset_understanding":
        return pharmacistView(resetUnderstanding(deps, id), deps.now());
      case "back_to_counseling":
        return pharmacistView(backToCounseling(deps, id), deps.now());
      case "cancel_decline":
        return pharmacistView(cancelDecline(deps, id), deps.now());
      default:
        throw new BadRequestError("戻す工程の形が違います");
    }
  });
}
