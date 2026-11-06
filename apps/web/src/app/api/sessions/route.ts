import { readJson, handle } from "@/server/http";
import { createSession, defaultDeps, patientView } from "@/server/session-service";

export const dynamic = "force-dynamic";

/** 言語を選んで接客を始める。body: { language } */
export function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    return patientView(createSession(defaultDeps(), String(body.language ?? "")));
  });
}
