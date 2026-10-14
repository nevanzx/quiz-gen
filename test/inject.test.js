import { test } from "node:test";
import assert from "node:assert/strict";
import { injectSpec } from "../plugin/inject.js";
import { normalizeSpec } from "../plugin/spec.js";

function mockClient() {
  const calls = [];
  const record = (name) => async (arg) => { calls.push({ name, arg }); return true; };
  return {
    calls,
    tui: {
      clearPrompt: record("clearPrompt"),
      appendPrompt: record("appendPrompt"),
      submitPrompt: record("submitPrompt"),
      showToast: record("showToast"),
    },
  };
}

test("injectSpec clears, appends, submits, and toasts in order", async () => {
  const client = mockClient();
  const spec = normalizeSpec({ sources: ["a.docx"], subjectCode: "FM100", description: "X" });
  const text = await injectSpec(client, spec);
  assert.deepEqual(client.calls.map((c) => c.name), [
    "clearPrompt", "appendPrompt", "submitPrompt", "showToast",
  ]);
  assert.match(text, /Generate a quiz using the quiz-gen skill/);
  assert.equal(client.calls[1].arg.body.text, text);
  assert.equal(client.calls[3].arg.body.variant, "success");
});
