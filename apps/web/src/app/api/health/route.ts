// 稼働確認用。個人情報や設定値は返さないこと。
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
