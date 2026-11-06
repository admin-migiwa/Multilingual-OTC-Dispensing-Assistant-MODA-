import { handle } from "@/server/http";
import { pharmacistView } from "@/server/pharmacist-service";
import { defaultDeps, getSession } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 薬剤師の確認画面に出す内容（日本語のまとめ・禁忌の判定・販売手順）。患者さんの画面には使わない */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => {
    const deps = defaultDeps();
    return pharmacistView(getSession(deps, id), deps.now());
  });
}
