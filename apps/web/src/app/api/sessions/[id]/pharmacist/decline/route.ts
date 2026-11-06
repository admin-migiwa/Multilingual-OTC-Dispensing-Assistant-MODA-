import { BadRequestError, handle, readJson } from "@/server/http";
import { declineSale, pharmacistView } from "@/server/pharmacist-service";
import { defaultDeps } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 「販売しない」：理由を記録して終える。body: { reason: "..." }（受診案内の画面は T11） */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = await readJson(request);
    if (typeof body.reason !== "string") throw new BadRequestError("理由の形が違います");
    const deps = defaultDeps();
    return pharmacistView(declineSale(deps, id, body.reason), deps.now());
  });
}
