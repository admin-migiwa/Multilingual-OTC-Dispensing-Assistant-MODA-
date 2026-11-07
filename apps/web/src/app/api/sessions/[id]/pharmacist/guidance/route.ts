import { defaultAiClient } from "@/server/ai";
import { createGuidance } from "@/server/guidance";
import { handle } from "@/server/http";
import { pharmacistView } from "@/server/pharmacist-service";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 説明書を作る（日本語をデータから組み立て、AI で患者さんの言語に訳し、訳し戻す。T10）。AI が失敗したら止める */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const deps = defaultDeps();
    return pharmacistView(await createGuidance(deps, defaultAiClient(), id), deps.now());
  });
}
