"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { INTEGER_ANSWER_RANGES, type InterviewAnswers, type QuestionId } from "@moda/domain";
import { getMessages, type LanguageCode } from "@moda/i18n";

/**
 * 問診の1問分の入力欄（患者さんの言語）。
 *
 * - どの項目を聞くかはサーバーが決める（CLAUDE.md 絶対に守るルール3）。ここは渡された1問を出すだけ。
 * - 画面の選択肢の名前（packages/i18n）と、ルールの側の値（packages/domain）は別の名前なので、ここで対応させる。
 * - 自由に入力する欄（薬の名前・理由・目的）は、送る前に緊急キーワードを確かめる（onFreeText）。
 */

type Choice = { readonly label: string; readonly answers: InterviewAnswers };

export function QuestionInput({
  language,
  questionId,
  onSubmit,
  onFreeText,
  busy,
}: {
  language: LanguageCode;
  questionId: QuestionId;
  /** 答えを送る */
  onSubmit: (answers: InterviewAnswers) => void;
  /** 自由に入力された文。緊急キーワードに当てはまれば true を返し、そのときは答えを送らない */
  onFreeText: (text: string) => boolean;
  busy: boolean;
}) {
  const t = getMessages(language);
  const q = t.interview.questions;
  const c = t.common;
  const yesNo = (key: keyof InterviewAnswers): Choice[] => [
    { label: c.yes, answers: { [key]: true } },
    { label: c.no, answers: { [key]: false } },
  ];
  const yesNoUnknown = (key: keyof InterviewAnswers): Choice[] => [
    { label: c.yes, answers: { [key]: "yes" } },
    { label: c.no, answers: { [key]: "no" } },
    { label: c.unknown, answers: { [key]: "unknown" } },
  ];

  switch (questionId) {
    case "Q01":
      return <NumberQuestion text={q.Q01.text} unit={q.Q01.unit} busy={busy} onSubmit={(n) => onSubmit({ age: n })} next={c.next} integer range={INTEGER_ANSWER_RANGES.age} />;
    case "Q05":
      return <NumberQuestion text={q.Q05.text} unit={q.Q05.unit} busy={busy} onSubmit={(n) => onSubmit({ weightKg: n })} next={c.next} />;
    case "Q12":
      return <NumberQuestion text={q.Q12.text} unit={q.Q12.unit} busy={busy} onSubmit={(n) => onSubmit({ plannedDays: n })} next={c.next} integer range={INTEGER_ANSWER_RANGES.plannedDays} />;
    case "Q02":
      return (
        <ChoiceQuestion
          text={q.Q02.text}
          busy={busy}
          onSubmit={onSubmit}
          choices={[
            { label: q.Q02.options.male, answers: { sex: "male" } },
            { label: q.Q02.options.female, answers: { sex: "female" } },
            { label: q.Q02.options.other, answers: { sex: "other" } },
            { label: q.Q02.options.noAnswer, answers: { sex: "no_answer" } },
          ]}
        />
      );
    case "Q03":
      return (
        <ChoiceQuestion
          text={q.Q03.text}
          busy={busy}
          onSubmit={onSubmit}
          choices={[
            { label: q.Q03.options.pregnant, answers: { pregnancy: "pregnant" } },
            { label: q.Q03.options.maybe, answers: { pregnancy: "maybe" } },
            { label: q.Q03.options.notPregnant, answers: { pregnancy: "no" } },
            { label: q.Q03.options.notApplicable, answers: { pregnancy: "not_applicable" } },
          ]}
        />
      );
    case "Q03a":
      return <ChoiceQuestion text={q.Q03a.text} busy={busy} onSubmit={onSubmit} choices={yesNoUnknown("dueWithin12Weeks")} />;
    case "Q04":
      return (
        <ChoiceQuestion
          text={q.Q04.text}
          busy={busy}
          onSubmit={onSubmit}
          choices={[
            { label: c.yes, answers: { breastfeeding: "yes" } },
            { label: c.no, answers: { breastfeeding: "no" } },
            { label: c.notApplicable, answers: { breastfeeding: "not_applicable" } },
          ]}
        />
      );
    case "Q06":
      return <ChoiceQuestion text={q.Q06.text} busy={busy} onSubmit={onSubmit} choices={yesNoUnknown("asthmaHistory")} />;
    case "Q07":
      return (
        <MultiQuestion
          text={q.Q07.text}
          busy={busy}
          noneLabel={c.none}
          nextLabel={c.next}
          options={[
            ["gastric_ulcer", q.Q07.options.stomachUlcer],
            ["liver", q.Q07.options.liver],
            ["kidney", q.Q07.options.kidney],
            ["heart", q.Q07.options.heart],
            ["hypertension", q.Q07.options.hypertension],
            ["glaucoma", q.Q07.options.glaucoma],
            ["dialysis", q.Q07.options.dialysis],
            ["other", c.other],
          ]}
          textLabel={c.other}
          textWhen={["other"]}
          // 「その他」を選んだら、内容を入れるまで進めない（空のままだと「なし」と区別できないため）
          requireText
          onFreeText={onFreeText}
          onSubmit={(values, text) =>
            onSubmit({
              // 「その他」は治療中の病気の選択肢ではないので、内容は自由入力として薬剤師の画面に出す
              conditions: values.filter((v) => v !== "other") as NonNullable<InterviewAnswers["conditions"]>,
              ...(values.includes("other") && text ? { otherConditionText: text } : {}),
            })
          }
        />
      );
    case "Q08":
      return (
        <AllergyQuestion
          language={language}
          busy={busy}
          onSubmit={onSubmit}
          onFreeText={onFreeText}
        />
      );
    case "Q09":
      return (
        <MultiQuestion
          text={q.Q09.text}
          busy={busy}
          noneLabel={c.none}
          nextLabel={c.next}
          options={[
            ["cold", q.Q09.options.coldMedicine],
            ["analgesic", q.Q09.options.painReliever],
            ["antihistamine", q.Q09.options.antihistamine],
            ["kampo", q.Q09.options.kampo],
            ["prescription", q.Q09.options.prescription],
            ["other", c.other],
          ]}
          textLabel={q.Q09.drugNameLabel}
          textWhen={["prescription", "other"]}
          onFreeText={onFreeText}
          onSubmit={(values, text) =>
            onSubmit({
              currentMedications: values as NonNullable<InterviewAnswers["currentMedications"]>,
              ...(text ? { prescriptionDrugNames: [text] } : {}),
            })
          }
        />
      );
    case "Q10":
      return <ChoiceQuestion text={q.Q10.text} busy={busy} onSubmit={onSubmit} choices={yesNo("drivingAfter")} />;
    case "Q11":
      return <ChoiceQuestion text={q.Q11.text} busy={busy} onSubmit={onSubmit} choices={yesNo("alcohol")} />;
    case "Q13":
      return <ChoiceQuestion text={q.Q13.text} busy={busy} onSubmit={onSubmit} choices={yesNo("softContactLens")} />;
    case "Q14":
      return (
        <ChoiceQuestion
          text={q.Q14.text}
          busy={busy}
          onSubmit={onSubmit}
          choices={[
            { label: q.Q14.options.body, answers: { applicationSite: "normal" } },
            { label: q.Q14.options.nearEyes, answers: { applicationSite: "eye_or_mucosa" } },
            { label: q.Q14.options.skinProblem, answers: { applicationSite: "eczema_or_wound" } },
          ]}
        />
      );
    case "R01":
      return (
        <ChoiceQuestion
          text={q.R01.text}
          busy={busy}
          onSubmit={onSubmit}
          choices={[
            { label: c.yes, answers: { otherStorePurchase: "yes" } },
            { label: c.no, answers: { otherStorePurchase: "no" } },
          ]}
        />
      );
    case "R02":
      return <PackageQuestion language={language} busy={busy} onSubmit={onSubmit} />;
    case "R03":
      return <TextQuestion text={q.R03.text} busy={busy} next={c.next} onFreeText={onFreeText} onSubmit={(s) => onSubmit({ reasonText: s })} />;
    case "R04":
      return <TextQuestion text={q.R04.text} busy={busy} next={c.next} onFreeText={onFreeText} onSubmit={(s) => onSubmit({ purposeText: s })} />;
  }
}

// ---------------------------------------------------------------------------

function QuestionFrame({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold leading-relaxed">{text}</h2>
      {children}
    </div>
  );
}

const choiceClass =
  "min-h-16 w-full rounded-2xl border-2 border-slate-200 px-5 py-3 text-left text-xl font-semibold transition hover:border-teal-600 hover:bg-teal-50 disabled:opacity-50";
const primaryClass =
  "rounded-2xl bg-teal-700 px-6 py-4 text-xl font-bold text-white transition hover:bg-teal-800 disabled:opacity-50";
const inputClass = "w-40 rounded-xl border-2 border-slate-300 px-4 py-3 text-2xl";

function ChoiceQuestion({
  text,
  choices,
  onSubmit,
  busy,
}: {
  text: string;
  choices: Choice[];
  onSubmit: (answers: InterviewAnswers) => void;
  busy: boolean;
}) {
  return (
    <QuestionFrame text={text}>
      <ul className="grid gap-3">
        {choices.map((choice) => (
          <li key={choice.label}>
            <button type="button" disabled={busy} onClick={() => onSubmit(choice.answers)} className={choiceClass}>
              {choice.label}
            </button>
          </li>
        ))}
      </ul>
    </QuestionFrame>
  );
}

function NumberQuestion({
  text,
  unit,
  next,
  onSubmit,
  busy,
  integer = false,
  range,
}: {
  text: string;
  unit: string;
  next: string;
  onSubmit: (value: number) => void;
  busy: boolean;
  integer?: boolean;
  /** 受け取る範囲（年齢・日数。backlog C-13）。範囲外は押せない。サーバーでも同じ範囲で確かめる */
  range?: { readonly min: number; readonly max: number };
}) {
  const [value, setValue] = useState("");
  const parsed = Number(value);
  const min = range?.min ?? 0;
  const valid =
    value.trim() !== "" &&
    Number.isFinite(parsed) &&
    parsed >= min &&
    (range === undefined || parsed <= range.max) &&
    (!integer || Number.isInteger(parsed));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (valid) onSubmit(parsed);
  }
  return (
    <QuestionFrame text={text}>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-4">
        <input
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          min={min}
          max={range?.max}
          step={integer ? 1 : "any"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={inputClass}
          autoFocus
        />
        <span className="text-xl">{unit}</span>
        <button type="submit" disabled={!valid || busy} className={primaryClass}>
          {next}
        </button>
      </form>
    </QuestionFrame>
  );
}

function TextQuestion({
  text,
  next,
  onSubmit,
  onFreeText,
  busy,
}: {
  text: string;
  next: string;
  onSubmit: (value: string) => void;
  onFreeText: (text: string) => boolean;
  busy: boolean;
}) {
  const [value, setValue] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === "") return;
    if (onFreeText(trimmed)) return; // 緊急キーワードに当てはまったら、緊急の確認に切り替わる
    onSubmit(trimmed);
  }
  return (
    <QuestionFrame text={text}>
      <form onSubmit={submit} className="space-y-4">
        <textarea
          value={value}
          maxLength={500}
          onChange={(event) => setValue(event.target.value)}
          className="h-32 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-xl"
          autoFocus
        />
        <button type="submit" disabled={value.trim() === "" || busy} className={primaryClass}>
          {next}
        </button>
      </form>
    </QuestionFrame>
  );
}

function MultiQuestion({
  text,
  options,
  noneLabel,
  nextLabel,
  onSubmit,
  busy,
  textLabel,
  textWhen,
  requireText = false,
  onFreeText,
}: {
  text: string;
  options: [string, string][];
  noneLabel: string;
  nextLabel: string;
  onSubmit: (values: string[], text?: string) => void;
  busy: boolean;
  textLabel?: string;
  /** これらのどれかを選んだら、自由入力の欄を出す */
  textWhen?: readonly string[];
  /** 自由入力の欄を出したら、文を入れるまで「次へ」を押せないようにする */
  requireText?: boolean;
  onFreeText?: (text: string) => boolean;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const toggle = (value: string) =>
    setPicked((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  const showText = textWhen !== undefined && textWhen.some((value) => picked.includes(value));
  function submit() {
    const trimmed = freeText.trim();
    if (showText && trimmed !== "" && onFreeText?.(trimmed)) return;
    onSubmit(picked, showText && trimmed !== "" ? trimmed : undefined);
  }
  return (
    <QuestionFrame text={text}>
      <ul className="grid gap-3">
        {options.map(([value, label]) => (
          <li key={value}>
            <button
              type="button"
              aria-pressed={picked.includes(value)}
              onClick={() => toggle(value)}
              className={`${choiceClass} ${picked.includes(value) ? "border-teal-600 bg-teal-50" : ""}`}
            >
              {picked.includes(value) ? "✓ " : ""}
              {label}
            </button>
          </li>
        ))}
      </ul>
      {showText && textLabel ? (
        <label className="block space-y-2">
          <span className="text-lg">{textLabel}</span>
          <input
            type="text"
            maxLength={500}
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            className="w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-xl"
          />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || picked.length === 0 || (requireText && showText && freeText.trim() === "")}
          onClick={submit}
          className={primaryClass}
        >
          {nextLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit([])}
          className="rounded-2xl border-2 border-slate-300 px-6 py-4 text-xl font-semibold hover:bg-slate-50 disabled:opacity-50"
        >
          {noneLabel}
        </button>
      </div>
    </QuestionFrame>
  );
}

function AllergyQuestion({
  language,
  onSubmit,
  onFreeText,
  busy,
}: {
  language: LanguageCode;
  onSubmit: (answers: InterviewAnswers) => void;
  onFreeText: (text: string) => boolean;
  busy: boolean;
}) {
  const t = getMessages(language);
  const [yes, setYes] = useState(false);
  const [name, setName] = useState("");
  if (!yes) {
    return (
      <ChoiceQuestion
        text={t.interview.questions.Q08.text}
        busy={busy}
        onSubmit={(answers) => (answers.drugAllergy === "yes" ? setYes(true) : onSubmit(answers))}
        choices={[
          { label: t.common.yes, answers: { drugAllergy: "yes" } },
          { label: t.common.no, answers: { drugAllergy: "no" } },
          { label: t.common.unknown, answers: { drugAllergy: "unknown" } },
        ]}
      />
    );
  }
  return (
    <QuestionFrame text={t.interview.questions.Q08.text}>
      <label className="block space-y-2">
        <span className="text-lg">{t.interview.questions.Q08.drugNameLabel}</span>
        <input
          type="text"
          maxLength={500}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-xl"
          autoFocus
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const trimmed = name.trim();
          if (trimmed !== "" && onFreeText(trimmed)) return;
          // 薬の名前は記録に残し、薬剤師の画面に原文で出す（判定には使わない。docs/backlog.md S-11）
          onSubmit({ drugAllergy: "yes", ...(trimmed !== "" ? { allergyDrugNames: [trimmed] } : {}) });
        }}
        className={primaryClass}
      >
        {t.common.next}
      </button>
    </QuestionFrame>
  );
}

function PackageQuestion({
  language,
  onSubmit,
  busy,
}: {
  language: LanguageCode;
  onSubmit: (answers: InterviewAnswers) => void;
  busy: boolean;
}) {
  const t = getMessages(language);
  const o = t.interview.questions.R02.options;
  const [multiple, setMultiple] = useState(false);
  const [count, setCount] = useState("2");
  const parsed = Number(count);
  if (!multiple) {
    return (
      <ChoiceQuestion
        text={t.interview.questions.R02.text}
        busy={busy}
        onSubmit={(answers) => (answers.packageChoice === "multiple" ? setMultiple(true) : onSubmit(answers))}
        choices={[
          { label: o.smallOne, answers: { packageChoice: "small_one" } },
          { label: o.largeOne, answers: { packageChoice: "large_one" } },
          { label: o.multiple, answers: { packageChoice: "multiple" } },
        ]}
      />
    );
  }
  return (
    <QuestionFrame text={t.interview.questions.R02.text}>
      <div className="flex flex-wrap items-center gap-4">
        <input
          type="number"
          inputMode="numeric"
          min={2}
          max={INTEGER_ANSWER_RANGES.packageCount.max}
          step={1}
          value={count}
          onChange={(event) => setCount(event.target.value)}
          className={inputClass}
        />
        <button
          type="button"
          disabled={busy || !Number.isInteger(parsed) || parsed < 2 || parsed > INTEGER_ANSWER_RANGES.packageCount.max}
          onClick={() => onSubmit({ packageChoice: "multiple", multipleCount: parsed })}
          className={primaryClass}
        >
          {t.common.next}
        </button>
      </div>
    </QuestionFrame>
  );
}
