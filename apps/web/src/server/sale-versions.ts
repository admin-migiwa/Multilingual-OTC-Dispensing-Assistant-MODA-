/**
 * 販売記録の版の読み方（11/7 依頼主の判断：承認を取り消して、もう一度承認できるようにする）。
 *
 * 販売記録は上書きしない（ルール6）。承認を取り消すと「approval_cancelled」の版を足し、もう一度承認すると
 * 「reapproved」の版を足す（同じ販売記録の中に、前の承認と取り消しが残る）。
 * - 今の承認の版（base）：最後の approved・reapproved の版。品目・手順・禁忌の解除はここから読む
 * - 取り消し中：最後の版が approval_cancelled のとき。この間は承認のあとの処理に使わない
 */

import type { SaleRecord, SaleRecordVersion } from "./approval.ts";

/** 承認の版の理由（ここから品目などを読む） */
const APPROVAL_REASONS: readonly SaleRecordVersion["reason"][] = ["approved", "reapproved"];

/** 今の承認の版。取り消し中・販売記録がないときは null */
export function activeApproval(sale: SaleRecord | undefined): SaleRecordVersion | null {
  const latest = sale?.versions.at(-1);
  if (!sale || !latest || latest.reason === "approval_cancelled") return null;
  for (let i = sale.versions.length - 1; i >= 0; i--) {
    const v = sale.versions[i];
    if (v && APPROVAL_REASONS.includes(v.reason)) return v;
  }
  return null;
}

/** 今の承認の版より後で、最後に理解の確認をやり直した時刻（なければ承認の時刻）。この時刻より後の答え・✓ だけを見る */
export function sinceOfUnderstanding(sale: SaleRecord, base: SaleRecordVersion): string {
  const reset = sale.versions.filter((v) => v.version > base.version && v.reason === "understanding_reset").at(-1);
  return reset?.at ?? base.at;
}
