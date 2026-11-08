"use client";

import { EMERGENCY_RULES } from "@moda/domain";
import { getMessages, type LanguageCode, type Messages } from "@moda/i18n";

/**
 * 緊急の確認画面で使う、追加の質問・つらさの数字・薬剤師の観察項目
 * （docs/demo-data/emergency.md「緊急の確認画面で使う質問と観察項目」。11/5 薬剤師確認済み）。
 *
 * 答えと印は薬剤師が判断する材料として並べるだけで、アプリは緊急かどうかを判定しない。
 * 答えは問診の内容として残す（元の画面に戻っても消さない）。いまは画面の中だけに持ち、
 * 問診の記録としてサーバーに保存するのは T7（問診）・T8（薬剤師の画面）で行う。
 */

type QuestionId = keyof Messages["emergencyFollowUp"]["questions"];
type SinceKey = keyof Messages["emergencyFollowUp"]["questions"]["EF02"]["options"];
type YesNoKey = "yes" | "no" | "unknown";

const YES_NO_KEYS: readonly YesNoKey[] = ["yes", "no", "unknown"];
const SINCE_KEYS: readonly SinceKey[] = ["minutes", "withinHour", "today", "yesterdayOrEarlier"];
const QUESTION_IDS: readonly QuestionId[] = ["EF01", "EF02", "EF03", "EF04", "EF05", "EF06", "EF07", "EF08", "EF09"];
const SCALE_VALUES = Array.from({ length: 11 }, (_, i) => i);

/** 薬剤師が見て判断する項目（emergency.md の ☑ の行から選んだもの） */
const OBSERVATION_IDS = ["EA02", "EA03", "EA06", "EA09", "EA11", "EA18", "EA19", "EA21", "EA22", "EC01", "EC02", "EC03"];
const OBSERVATIONS = OBSERVATION_IDS.map((id) => {
  const rule = EMERGENCY_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`緊急症状の表に ${id} がありません`);
  return rule;
});

/** 質問の ID。ES01 はつらさの数字 */
export type PromptId = QuestionId | "ES01";

export interface FollowUpState {
  readonly answers: Readonly<Partial<Record<QuestionId, string>>>;
  readonly scale: number | null;
  readonly observed: ReadonlySet<string>;
  /** 開いている質問（答えても閉じない。薬剤師がもう一度押すと閉じる） */
  readonly open: ReadonlySet<PromptId>;
}

export const EMPTY_FOLLOW_UP: FollowUpState = { answers: {}, scale: null, observed: new Set(), open: new Set() };

/** 答え・数字・印のどれか1つでもあるか（記録があるか） */
export function hasFollowUpRecord(state: FollowUpState): boolean {
  return Object.keys(state.answers).length > 0 || state.scale !== null || state.observed.size > 0;
}

function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function answerOptions(question: QuestionId, messages: Messages): Array<[key: string, label: string]> {
  if (question === "EF02") {
    const options = messages.emergencyFollowUp.questions.EF02.options;
    return SINCE_KEYS.map((key) => [key, options[key]]);
  }
  return YES_NO_KEYS.map((key) => [key, messages.common[key]]);
}

function answerLabelJa(question: QuestionId, key: string): string {
  const found = answerOptions(question, getMessages("ja")).find(([k]) => k === key);
  return found ? found[1] : key;
}

function answerButtonClass(selected: boolean): string {
  return `min-h-16 rounded-2xl border-2 px-4 py-3 text-lg font-semibold ${
    selected ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white hover:border-teal-600 hover:bg-teal-50"
  }`;
}

/** 質問のすぐ下に出す枠。患者さんが答えるので、患者さんの言語で書く。選んだ答えは色が変わる */
function PromptBox({
  prompt,
  language,
  state,
  onChange,
}: {
  prompt: PromptId;
  language: LanguageCode;
  state: FollowUpState;
  onChange: (next: FollowUpState) => void;
}) {
  const messages = getMessages(language);
  const f = messages.emergencyFollowUp;

  return (
    <div lang={language} className="space-y-4 rounded-2xl border-4 border-teal-600 bg-white p-4">
      <p className="text-base text-slate-600">{f.intro}</p>
      {prompt === "ES01" ? (
        <>
          <p className="text-2xl font-bold">{f.scale.text}</p>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-11">
            {SCALE_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={state.scale === value}
                onClick={() => onChange({ ...state, scale: value })}
                className={`${answerButtonClass(state.scale === value)} px-0 text-2xl`}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="flex justify-between gap-4 text-sm text-slate-600">
            <span>{f.scale.min}</span>
            <span className="text-right">{f.scale.max}</span>
          </div>
        </>
      ) : (
        <>
          <p className="text-2xl font-bold">{f.questions[prompt].text}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {answerOptions(prompt, messages).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={state.answers[prompt] === key}
                onClick={() => onChange({ ...state, answers: { ...state.answers, [prompt]: key } })}
                className={answerButtonClass(state.answers[prompt] === key)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 薬剤師が操作する部分（日本語）。押した質問は開いたままになり、そのすぐ下で患者さんが答えを選ぶ */
export function FollowUpPharmacistPanel({
  language,
  state,
  onChange,
}: {
  language: LanguageCode;
  state: FollowUpState;
  onChange: (next: FollowUpState) => void;
}) {
  const ja = getMessages("ja").emergencyFollowUp;
  const prompts: ReadonlyArray<{ id: PromptId; label: string; answer: string | null }> = [
    ...QUESTION_IDS.map((id) => {
      const answer = state.answers[id];
      return { id, label: ja.questions[id].text, answer: answer === undefined ? null : answerLabelJa(id, answer) };
    }),
    { id: "ES01", label: "今のつらさ（0〜10）", answer: state.scale === null ? null : `${state.scale} / 10` },
  ];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-base font-bold">
          患者さんに聞く（押すと、すぐ下に患者さんの言語で質問と答えのボタンが出ます。もう一度押すと閉じます）
        </h3>
        <ul className="space-y-2">
          {prompts.map(({ id, label, answer }) => {
            const isOpen = state.open.has(id);
            return (
              <li key={id} className="space-y-2">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => onChange({ ...state, open: toggled(state.open, id) })}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border-2 px-3 py-2 text-left text-sm ${
                    isOpen ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span>
                    <span aria-hidden="true" className="mr-2 inline-block w-3 text-slate-500">
                      {isOpen ? "▾" : "▸"}
                    </span>
                    {label}
                  </span>
                  <span className="shrink-0 font-semibold text-teal-800">{answer ?? "未回答"}</span>
                </button>
                {isOpen ? <PromptBox prompt={id} language={language} state={state} onChange={onChange} /> : null}
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-slate-500">
          ほかに聞きたいことは、自由記述のチャットで聞きます。
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-base font-bold">薬剤師が見て当てはまるもの（印を付ける）</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {OBSERVATIONS.map((rule) => (
            <label key={rule.id} className="flex items-start gap-2 rounded-xl border-2 border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={state.observed.has(rule.id)}
                onChange={() => onChange({ ...state, observed: toggled(state.observed, rule.id) })}
                className="mt-0.5 size-5 shrink-0"
              />
              <span>
                {rule.id}：{rule.labelJa}
                {rule.audience === "child" ? "（こどものとき）" : ""}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-sm text-slate-500">
        答えと印は問診の内容として残ります。「元の画面に戻る」を押しても消えません。
      </p>
    </div>
  );
}
