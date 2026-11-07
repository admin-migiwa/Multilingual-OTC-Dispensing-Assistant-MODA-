/** 店頭の日付（日本時間の YYYY-MM-DD）。UTC の日付を使うと朝9時前が前日になるため（docs/backlog.md C-07） */
export function japanDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
