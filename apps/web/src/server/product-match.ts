/**
 * 読み取った（または入力された）商品名を、取扱薬・取扱外の薬（docs/demo-data/drugs.md の架空の薬）と照らし合わせて、
 * 候補を出す（spec.md タスク T12、決まったこと No.35）。
 *
 * - AI は「文字を読む」だけ。どの薬に当たるかは、ここで表の商品名と照らし合わせて決める（design.md 8節）。
 * - 出すのは「候補」。どれにするかは薬剤師が確かめて選ぶ（CLAUDE.md 絶対に守るルール10）。
 * - 照らし合わせ方：文字の形をそろえ（全角・半角、カタカナ・ひらがな、空白、「（架空）」）、
 *   同じ → 片方がもう片方を含む → 2文字ずつの重なりの多さ、の順に点数を付ける。
 */

import { STOCKED_DRUGS, UNSTOCKED_DRUGS } from "@moda/domain";

export interface ProductCandidate {
  /** 取扱薬は A〜J、取扱外の薬は X1〜X3 */
  readonly drugId: string;
  readonly name: string;
  /** 店で扱っているか（取扱外なら、同じ成分の薬を薬剤師が探す） */
  readonly stocked: boolean;
  /** 0〜1。1 は名前が同じ */
  readonly score: number;
  /** 当たった読み取りの文字 */
  readonly matchedText: string;
}

/** これより低い点数は候補に出さない */
export const MIN_SCORE = 0.5;
/** 候補の数の上限 */
export const MAX_CANDIDATES = 3;

const CATALOG: ReadonlyArray<{ drugId: string; name: string; stocked: boolean }> = [
  ...STOCKED_DRUGS.map((drug) => ({ drugId: drug.id, name: drug.name, stocked: true })),
  ...UNSTOCKED_DRUGS.map((drug) => ({ drugId: drug.id, name: drug.name, stocked: false })),
];

/** 照らし合わせ用に文字の形をそろえる */
export function normalizeName(text: string): string {
  return (
    text
      .normalize("NFKC")
      .replace(/[（(]架空[）)]/g, "")
      .toLowerCase()
      // カタカナをひらがなに（ァ〜ヶ）
      .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
      // 空白・記号を取り除く（長音「ー」は残す）
      .replace(/[\s\p{P}\p{S}]/gu, "")
  );
}

function bigrams(text: string): Map<string, number> {
  const result = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2);
    result.set(pair, (result.get(pair) ?? 0) + 1);
  }
  return result;
}

/** 2文字ずつの重なりの多さ（0〜1） */
function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let overlap = 0;
  for (const [pair, count] of left) overlap += Math.min(count, right.get(pair) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function scoreOf(read: string, name: string): number {
  if (!read || !name) return 0;
  if (read === name) return 1;
  // 「モダペインS」と「モダペインS錠」、「モダペインS錠 12錠入り」と「モダペインS錠」など
  if (read.includes(name) || name.includes(read)) {
    const shorter = Math.min(read.length, name.length);
    const longer = Math.max(read.length, name.length);
    // 短すぎる一致（「もだ」だけ等）では高くしない
    return shorter >= 4 ? 0.8 + 0.2 * (shorter / longer) : dice(read, name);
  }
  return dice(read, name);
}

/** 読み取った文字（複数）から、候補を点数の高い順に出す */
export function matchProducts(readTexts: readonly string[]): ProductCandidate[] {
  const best = new Map<string, ProductCandidate>();
  for (const raw of readTexts) {
    const read = normalizeName(raw);
    if (!read) continue;
    for (const item of CATALOG) {
      const score = scoreOf(read, normalizeName(item.name));
      const current = best.get(item.drugId);
      if (score >= MIN_SCORE && (!current || score > current.score)) {
        best.set(item.drugId, { ...item, score: Math.round(score * 100) / 100, matchedText: raw });
      }
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}
