"use client";

/**
 * 患者さんの薬の確認（11/8 依頼主＝薬剤師の判断）。
 * 薬が決まったら（患者さんが選ぶ／薬剤師が候補を選ぶ）、名前・効能・飲み方を患者さんの言語で出し、
 * 「この薬でOK（個数）」「相談したい」「薬を選びなおす」のどれかを選んでもらう。
 * - 個数：ふつうの薬は 1〜上限（サーバーの版のデータの値）、E は問診 R02 と同じ包装の選択、A・B は1個
 * - 個数・包装の確かめと、承認の前の関所はサーバーで行う（画面の表示だけに頼らない）
 */

import { useState } from "react";

import type { InterviewAnswers, PackageChoice, StockedDrugId } from "@moda/domain";
import { getMessages, type LanguageCode } from "@moda/i18n";

import { PackageQuestion, type PackageOptions } from "./question-input";
import type { PatientView } from "./session-api";

type Confirmation = NonNullable<PatientView["drugConfirmation"]>;

export type DrugConfirmAction =
  | { choice: "ok"; quantities: Partial<Record<StockedDrugId, number>>; packageChoice?: PackageChoice; multipleCount?: number }
  | { choice: "consult" | "reselect" };

export function DrugConfirm({
  language,
  confirmation,
  packageOptions,
  busy,
  consulted,
  onAction,
}: {
  language: LanguageCode;
  confirmation: Confirmation;
  packageOptions: PackageOptions;
  busy: boolean;
  consulted: boolean;
  onAction: (action: DrugConfirmAction) => void;
}) {
  const t = getMessages(language);
  const c = t.drugConfirm;
  const [counts, setCounts] = useState<Partial<Record<StockedDrugId, number>>>({});
  const [pack, setPack] = useState<InterviewAnswers | null>(null);
  const needsPackage = confirmation.drugs.some((d) => d.mode === "package");
  const ready =
    confirmation.drugs.every((d) => d.mode !== "count" || counts[d.drugId] !== undefined) && (!needsPackage || pack !== null);
  const r02 = t.interview.questions.R02.options;
  const packLabel = (a: InterviewAnswers): string =>
    a.packageChoice === "small_one"
      ? r02.smallOne
      : a.packageChoice === "large_one"
        ? r02.largeOne
        : `${r02.multiple}（${a.multipleCount ?? ""}）`;

  function ok() {
    const quantities: Partial<Record<StockedDrugId, number>> = {};
    for (const d of confirmation.drugs) {
      const n = counts[d.drugId];
      if (d.mode === "count" && n !== undefined) quantities[d.drugId] = n;
    }
    onAction({
      choice: "ok",
      quantities,
      ...(pack?.packageChoice !== undefined ? { packageChoice: pack.packageChoice } : {}),
      ...(pack?.multipleCount !== undefined ? { multipleCount: pack.multipleCount } : {}),
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">{c.title}</h1>
        <p className="text-lg font-semibold text-teal-800">
          <span aria-hidden="true">👀 </span>
          {c.guide}
        </p>
      </div>
      {confirmation.drugs.map((drug) => {
        const info = c.drugs[drug.drugId];
        return (
          <section key={drug.drugId} className="space-y-4 rounded-2xl border-2 border-teal-200 bg-white p-5 shadow-sm">
            <div>
              <p lang="ja" className="text-2xl font-bold">
                {drug.name}
              </p>
              <p className="text-sm text-slate-500">{c.nameNote}</p>
            </div>
            <dl className="grid gap-3 text-lg">
              <div>
                <dt className="text-sm font-semibold text-slate-500">{c.efficacy}</dt>
                <dd>{info.efficacy}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-slate-500">{c.usage}</dt>
                <dd>{info.usage}</dd>
              </div>
            </dl>
            {drug.contraindicated ? (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-lg text-amber-900 ring-1 ring-amber-200">⚠ {c.contraindicated}</p>
            ) : null}
            {drug.mode === "count" ? (
              <div className="space-y-2">
                <p className="text-lg font-semibold">{c.quantity}</p>
                <div className="flex flex-wrap gap-3">
                  {Array.from({ length: confirmation.maxQuantity }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={busy}
                      aria-pressed={counts[drug.drugId] === n}
                      onClick={() => setCounts({ ...counts, [drug.drugId]: n })}
                      className={`min-h-14 min-w-16 rounded-2xl border-2 px-5 text-2xl font-bold disabled:opacity-50 ${
                        counts[drug.drugId] === n ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white hover:bg-teal-50"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ) : drug.mode === "fixed" ? (
              <p className="text-lg font-semibold">{c.fixedOne}</p>
            ) : pack !== null ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-lg font-semibold">
                  {c.chosen}
                  {packLabel(pack)}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPack(null)}
                  className="min-h-11 rounded-xl border-2 border-slate-300 px-4 text-lg"
                >
                  {c.change}
                </button>
              </div>
            ) : (
              <PackageQuestion language={language} busy={busy} options={packageOptions} onSubmit={(answers) => setPack(answers)} />
            )}
          </section>
        );
      })}
      <div className="grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={ok}
          className="min-h-16 rounded-2xl bg-teal-700 px-5 py-4 text-xl font-bold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          ✓ {c.ok}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction({ choice: "consult" })}
          className="min-h-16 rounded-2xl border-2 border-teal-700 bg-white px-5 py-4 text-xl font-semibold text-teal-900 hover:bg-teal-50 disabled:opacity-50"
        >
          💬 {c.consult}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction({ choice: "reselect" })}
          className="min-h-16 rounded-2xl border-2 border-slate-300 bg-white px-5 py-4 text-xl font-semibold hover:bg-slate-50 disabled:opacity-50"
        >
          ↺ {c.reselect}
        </button>
      </div>
      {consulted ? <p className="rounded-xl bg-teal-50 px-4 py-3 text-lg text-teal-900">{c.consultOpened}</p> : null}
    </div>
  );
}
