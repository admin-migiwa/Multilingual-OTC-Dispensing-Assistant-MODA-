import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { emergencyEvidence } from "./emergency-evidence.ts";
import {
  cancelEmergency119,
  createSession,
  decideEmergency,
  getSession,
  openEmergency,
  patientView,
  recordEmergencyFollowUp,
  type ServiceDeps,
  type SessionRecord,
} from "./session-service.ts";

// 緊急症状の表は docs/demo-data/emergency.md の ☑ の行（EA12 胸の痛み、観察の EA06 顔色）にそろえる（backlog C-08）

function testDeps(): ServiceDeps {
  const map = new Map<string, SessionRecord>();
  let n = 0;
  return {
    store: { get: (id) => map.get(id), set: (r) => void map.set(r.id, r), all: () => map.values() },
    now: () => new Date("2026-11-06T10:00:00+09:00"),
    newId: () => `s${(n += 1)}`,
  };
}

describe("薬剤師が緊急の根拠を読む（C-08）", () => {
  it("入力された文・当てはまった項目（日本語の説明つき）・追加の答え・判断を、記録の順に返す", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    openEmergency(deps, id, { trigger: "keyword", matchedRuleIds: ["EA12"], inputText: "chest pain" });
    recordEmergencyFollowUp(deps, id, { answers: { EF01: "yes" }, scale: 8, observedRuleIds: ["EA06"] });
    decideEmergency(deps, id, "show_119");
    cancelEmergency119(deps, id);

    const evidence = emergencyEvidence(getSession(deps, id));
    assert.equal(evidence.emergencies.length, 2);
    const [first, reopened] = evidence.emergencies;
    assert.equal(first?.trigger, "keyword");
    assert.equal(first?.inputText, "chest pain");
    assert.equal(first?.matchedRules[0]?.id, "EA12");
    assert.match(first?.matchedRules[0]?.labelJa ?? "", /胸/);
    assert.deepEqual(first?.followUps.at(-1)?.observedRuleIds, ["EA06"]);
    assert.equal(first?.decision, "show_119");
    assert.notEqual(first?.cancelledAt, null);
    // 取り消したあとの、判断前の確認（同じ根拠）
    assert.equal(reopened?.decision, null);
    assert.equal(reopened?.inputText, "chest pain");
  });

  it("患者さんの画面に返す内容には、緊急の根拠（入力された文）を入れない", () => {
    const deps = testDeps();
    const { id } = createSession(deps, "en");
    const record = openEmergency(deps, id, { trigger: "keyword", matchedRuleIds: ["EA12"], inputText: "chest pain" });
    assert.equal(JSON.stringify(patientView(record)).includes("chest pain"), false);
  });
});
