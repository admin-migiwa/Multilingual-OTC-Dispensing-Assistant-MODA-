import { proceedCheckout } from "@/server/guidance";
import { handle } from "@/server/http";
import { pharmacistView } from "@/server/pharmacist-service";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 会計案内に進む（会計の前の手順と理解の確認がそろわないと止まる。T10） */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => {
    const deps = defaultDeps();
    return pharmacistView(proceedCheckout(deps, id), deps.now());
  });
}
