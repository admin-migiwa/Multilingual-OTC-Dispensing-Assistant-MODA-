import { handle } from "@/server/http";
import { openPharmacistReview, pharmacistView } from "@/server/pharmacist-service";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 薬剤師の確認を始める（薬の選択 → 薬剤師の確認）。すでに確認中ならそのまま */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => {
    const deps = defaultDeps();
    return pharmacistView(openPharmacistReview(deps, id), deps.now());
  });
}
