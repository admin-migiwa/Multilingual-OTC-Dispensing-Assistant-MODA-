"use client";

import { EMERGENCY_RULES } from "@moda/domain";
import { getMessages, type LanguageCode, type Messages } from "@moda/i18n";

/**
 * 緊急の確認画面で使う、追加の質問・つらさの数字・薬剤師の観察項目
 * （docs/demo-data/emergency.md「緊急の確認画面で使う質問と観察項目」。11/5 薬剤師確認済み）。
 *
 * 答えと印は薬剤師が判断する材料として並べるだけで、アプリは緊急かどうかを判定しない。
 * 記録の保存はハッカソン版では保留のため、画面を離れると消える。
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

/** いま患者さんに見せている質問。ES01 はつらさの数字 */
export type ActivePrompt = QuestionId | "ES01" | null;

export interface FollowUpState {
  readonly answers: Readonly<Partial<Record<QuestionId, string>>>;
  readonly scale: number | null;
  readonly observed: ReadonlySet<string>;
  readonly active: ActivePrompt;
}

export const EMPTY_FOLLOW_UP: FollowUpState = { answers: {}, scale: null, observed: new Set(), active: null };

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

/** 患者さんに見せる質問と答えのボタン（患者さんの言語）。薬剤師が押した質問のすぐ下に出す */
function FollowUpPatientPrompt({
  language,
  state,
  onChange,
}: {
  language: LanguageCode;
  state: FollowUpState;
  onChange: (next: FollowUpState) => void;
}) {
  if (state.active === null) return null;
  const messages = getMessages(language);
  const f = messages.emergencyFollowUp;
  const buttonClass =
    "min-h-16 rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 text-lg font-semibold hover:border-teal-600 hover:bg-teal-50";

  if (state.active === "ES01") {
    return (
      <div className="space-y-4">
        <p className="text-base text-slate-600">{f.intro}</p>
        <p className="text-2xl font-bold">{f.scale.text}</p>
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-11">
          {SCALE_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ ...state, scale: value, active: null })}
              className={`${buttonClass} px-0 text-2xl`}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="flex justify-between gap-4 text-sm text-slate-600">
          <span>{f.scale.min}</span>
          <span className="text-right">{f.scale.max}</span>
        </div>
      </div>
    );
  }

  const question = state.active;
  return (
    <div className="space-y-4">
      <p className="text-base text-slate-600">{f.intro}</p>
      <p className="text-2xl font-bold">{f.questions[question].text}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {answerOptions(question, messages).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange({ ...state, answers: { ...state.answers, [question]: key }, active: null })}
            className={buttonClass}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 質問のすぐ下に出す枠。患者さんが答えるので、患者さんの言語で書く */
function PromptBox(props: { language: LanguageCode; state: FollowUpState; onChange: (next: FollowUpState) => void }) {
  return (
    <div lang={props.language} className="rounded-2xl border-4 border-teal-600 bg-white p-4">
      <FollowUpPatientPrompt {...props} />
    </div>
  );
}

/** 薬剤師が操作する部分（日本語）。押した質問の答えは、その質問のすぐ下で患者さんが選ぶ */
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

  function toggleObserved(id: string) {
    const observed = new Set(state.observed);
    if (observed.has(id)) observed.delete(id);
    else observed.add(id);
    onChange({ ...state, observed });
  }

  const questionButtonClass = (active: boolean) =>
    `flex w-full items-center justify-between gap-3 rounded-xl border-2 px-3 py-2 text-left text-sm ${
      active ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"
    }`;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-base font-bold">患者さんに聞く（押すと、すぐ下に患者さんの言語で質問と答えのボタンが出ます）</h3>
        <ul className="space-y-2">
          {QUESTION_IDS.map((id) => {
            const answer = state.answers[id];
            return (
              <li key={id} className="space-y-2">
                <button
                  type="button"
                  onClick={() => onChange({ ...state, active: state.active === id ? null : id })}
                  className={questionButtonClass(state.active === id)}
                >
                  <span>{ja.questions[id].text}</span>
                  <span className="shrink-0 font-semibold text-teal-800">
                    {answer === undefined ? "未回答" : answerLabelJa(id, answer)}
                  </span>
                </button>
                {state.active === id ? <PromptBox language={language} state={state} onChange={onChange} /> : null}
              </li>
            );
          })}
          <li className="space-y-2">
            <button
              type="button"
              onClick={() => onChange({ ...state, active: state.active === "ES01" ? null : "ES01" })}
              className={questionButtonClass(state.active === "ES01")}
            >
              <span>今のつらさ（0〜10）</span>
              <span className="shrink-0 font-semibold text-teal-800">
                {state.scale === null ? "未回答" : `${state.scale} / 10`}
              </span>
            </button>
            {state.active === "ES01" ? <PromptBox language={language} state={state} onChange={onChange} /> : null}
          </li>
        </ul>
        <p className="text-sm text-slate-500">
          ほかに聞きたいことは、自由記述のチャットで聞きます（チャットは T13 で作ります）。
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
                onChange={() => toggleObserved(rule.id)}
                className="mt-0.5 size-5 shrink-0"
              />
              <span>
                {rule.id}：{rule.labelJa}
                {rule.audience === "child" ? "（こどものとき）" : ""}
              </span>
            </label>
          ))}
        </div>
        <p className="text-sm text-slate-500">記録の保存はハッカソン版では保留のため、いまは画面に表示するだけです。</p>
      </fieldset>
    </div>
  );
}
