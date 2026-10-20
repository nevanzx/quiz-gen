# Quiz-Gen Spec UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local browser UI (driven by an OpenCode companion plugin) that collects the quiz-gen input spec and, on submit, types the spec into the running OpenCode TUI prompt to start the quiz pipeline.

**Architecture:** A companion OpenCode plugin registers a `quiz_ui` custom tool. The tool starts a zero-dependency Node `http` server (loopback, ephemeral port, per-run token) that serves a form page and two JSON endpoints. On submit the server validates the spec and calls the OpenCode SDK `client.tui.appendPrompt` + `submitPrompt` to type and send it. Pure logic (defaults, validation, prompt formatting, injection, browser launch) lives in small ESM modules that are unit-tested with `node --test`; the plugin entry wires them together.

**Tech Stack:** Node.js 24 (`node --test`, global `fetch`, ESM), `@opencode-ai/plugin` (provided by OpenCode at runtime), vanilla HTML/CSS/JS. No runtime npm dependencies.

## Global Constraints

- Node.js >= 24 (repo tests run via `node --test`); Python unchanged.
- Zero runtime npm dependencies for the plugin and UI. `@opencode-ai/plugin` is provided by OpenCode and only imported by `plugin/quiz-ui.js`.
- All modules are ESM (`package.json` sets `"type": "module"`).
- UI server binds `127.0.0.1` only, uses an ephemeral port (0), and requires a per-run random token.
- The plugin installs to `~/.config/opencode/plugins/`.
- Do NOT modify `scripts/docx_text.py`, `scripts/html_text.py`, `scripts/build_xlsx.py`, or `reference/*.md`.
- Question types (exact strings): `Multiple Choice`, `True/False`, `Identification`, `Problem Solving`, `Short Answer`.
- Exam periods: `PRELIM`, `MIDTERM`, `FINALS`. Difficulties: `easy`, `medium`, `hard`.
- Defaults mirror SKILL.md: MCQ 10 (others 0), difficulty `medium`, stem words 30, choice/answer words 3, append on.

---

## File Structure

```
package.json                 # private; "type":"module"; test script
plugin/spec.js               # defaults, normalizeSpec, validateSpec, buildPrompt, deriveFilename
plugin/server.js             # createSpecServer: HTTP server + endpoints + token auth + path confinement
plugin/inject.js             # injectSpec(client, spec): clearPrompt/appendPrompt/submitPrompt/showToast
plugin/browser.js            # browserCommand(platform,url) + openBrowser(url)
plugin/quiz-ui.js            # OpenCode plugin: registers `quiz_ui` tool, wires server + inject + browser
plugin/ui.html               # the form page (vanilla)
scripts/install-plugin.ps1   # copy plugin/ into ~/.config/opencode/plugins/
test/spec.test.js            # tests for spec.js
test/server.test.js          # tests for server.js
test/inject.test.js          # tests for inject.js
test/browser.test.js         # tests for browser.js
SKILL.md                     # add Step 0; note inputs come from the UI
README.md                    # install + usage for the plugin
```

---

### Task 1: Scaffolding + spec defaults and filename

**Files:**
- Create: `package.json`
- Create: `plugin/spec.js`
- Test: `test/spec.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `TYPES: string[]`, `EXAM_PERIODS: string[]`, `DIFFICULTIES: string[]`, `MODE_KEYS: string[]`, `DEFAULTS: object`, `deriveFilename(subjectCode: string, examPeriod: string): string`, `normalizeSpec(raw?: object): Spec`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "quiz-gen",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `test/spec.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TYPES, EXAM_PERIODS, DIFFICULTIES, DEFAULTS,
  deriveFilename, normalizeSpec,
} from "../plugin/spec.js";

test("constants have the expected values", () => {
  assert.deepEqual(TYPES, [
    "Multiple Choice", "True/False", "Identification",
    "Problem Solving", "Short Answer",
  ]);
  assert.deepEqual(EXAM_PERIODS, ["PRELIM", "MIDTERM", "FINALS"]);
  assert.deepEqual(DIFFICULTIES, ["easy", "medium", "hard"]);
  assert.equal(DEFAULTS.counts["Multiple Choice"], 10);
  assert.equal(DEFAULTS.difficulty, "medium");
  assert.equal(DEFAULTS.append, true);
});

test("deriveFilename joins code and period", () => {
  assert.equal(deriveFilename("FM100", "PRELIM"), "FM100_PRELIM.xlsx");
  assert.equal(deriveFilename("FM100", ""), "FM100.xlsx");
});

test("normalizeSpec fills all defaults", () => {
  const spec = normalizeSpec({ subjectCode: "FM100", description: "X" });
  assert.equal(spec.examPeriod, "PRELIM");
  assert.equal(spec.counts["Multiple Choice"], 10);
  assert.equal(spec.counts["True/False"], 0);
  assert.equal(spec.difficulty, "medium");
  assert.deepEqual(spec.modes, { situational: false, termOnly: false, calculation: false });
  assert.deepEqual(spec.wordCounts, { stem: 30, choices: 3 });
  assert.equal(spec.output, "FM100_PRELIM.xlsx");
  assert.equal(spec.append, true);
});

test("normalizeSpec coerces counts to integers and appends xlsx", () => {
  const spec = normalizeSpec({
    subjectCode: "FM100", description: "X", examPeriod: "FINALS",
    counts: { "Multiple Choice": "5", "True/False": "3" },
    output: "my-quiz",
  });
  assert.equal(spec.counts["Multiple Choice"], 5);
  assert.equal(spec.counts["True/False"], 3);
  assert.equal(spec.output, "my-quiz.xlsx");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/spec.test.js`
Expected: FAIL — cannot find module `../plugin/spec.js`.

- [ ] **Step 4: Write minimal implementation**

Create `plugin/spec.js`:

```js
export const TYPES = [
  "Multiple Choice",
  "True/False",
  "Identification",
  "Problem Solving",
  "Short Answer",
];

export const EXAM_PERIODS = ["PRELIM", "MIDTERM", "FINALS"];
export const DIFFICULTIES = ["easy", "medium", "hard"];
export const MODE_KEYS = ["situational", "termOnly", "calculation"];

export const DEFAULTS = {
  sources: [],
  subjectCode: "",
  description: "",
  examPeriod: "PRELIM",
  counts: {
    "Multiple Choice": 10,
    "True/False": 0,
    "Identification": 0,
    "Problem Solving": 0,
    "Short Answer": 0,
  },
  difficulty: "medium",
  modes: { situational: false, termOnly: false, calculation: false },
  wordCounts: { stem: 30, choices: 3 },
  output: "",
  append: true,
};

export function deriveFilename(subjectCode, examPeriod) {
  const code = String(subjectCode ?? "").trim();
  const period = String(examPeriod ?? "").trim();
  return [code, period].filter(Boolean).join("_") + ".xlsx";
}

export function normalizeSpec(raw = {}) {
  const counts = { ...DEFAULTS.counts, ...(raw.counts || {}) };
  const modes = { ...DEFAULTS.modes, ...(raw.modes || {}) };
  const wordCounts = { ...DEFAULTS.wordCounts, ...(raw.wordCounts || {}) };
  const subjectCode = String(raw.subjectCode ?? "").trim();
  const examPeriod = EXAM_PERIODS.includes(raw.examPeriod)
    ? raw.examPeriod
    : DEFAULTS.examPeriod;
  let output = String(raw.output ?? "").trim();
  if (output && !output.toLowerCase().endsWith(".xlsx")) output += ".xlsx";
  if (!output) output = deriveFilename(subjectCode, examPeriod);
  return {
    sources: (raw.sources || []).map((s) => String(s).trim()).filter(Boolean),
    subjectCode,
    description: String(raw.description ?? "").trim(),
    examPeriod,
    counts: Object.fromEntries(TYPES.map((t) => [t, Number(counts[t]) || 0])),
    difficulty: DIFFICULTIES.includes(raw.difficulty)
      ? raw.difficulty
      : DEFAULTS.difficulty,
    modes: Object.fromEntries(MODE_KEYS.map((k) => [k, Boolean(modes[k])])),
    wordCounts: {
      stem: Number(wordCounts.stem) || 0,
      choices: Number(wordCounts.choices) || 0,
    },
    output,
    append: raw.append === undefined ? DEFAULTS.append : Boolean(raw.append),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/spec.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json plugin/spec.js test/spec.test.js
git commit -m "feat: spec defaults, normalizeSpec, and filename derivation"
```

---

### Task 2: Spec validation

**Files:**
- Modify: `plugin/spec.js`
- Test: `test/spec.test.js`

**Interfaces:**
- Consumes: `normalizeSpec` (Task 1).
- Produces: `validateSpec(spec: Spec, opts?: { checkFiles?: boolean }): { valid: boolean, errors: Record<string,string> }`.

- [ ] **Step 1: Write the failing test**

Append to `test/spec.test.js`:

```js
import { validateSpec } from "../plugin/spec.js";

const baseSpec = () => normalizeSpec({
  sources: ["/tmp/lesson.docx"],
  subjectCode: "FM100",
  description: "Annuities",
});

test("validateSpec passes a well-formed spec (files skipped)", () => {
  const { valid, errors } = validateSpec(baseSpec(), { checkFiles: false });
  assert.equal(valid, true);
  assert.deepEqual(errors, {});
});

test("validateSpec requires a source", () => {
  const spec = baseSpec();
  spec.sources = [];
  const { valid, errors } = validateSpec(spec, { checkFiles: false });
  assert.equal(valid, false);
  assert.match(errors.sources, /source file/i);
});

test("validateSpec requires subject code and description", () => {
  const spec = baseSpec();
  spec.subjectCode = "";
  spec.description = "";
  const { errors } = validateSpec(spec, { checkFiles: false });
  assert.ok(errors.subjectCode);
  assert.ok(errors.description);
});

test("validateSpec rejects zero total and negative counts", () => {
  const zero = baseSpec();
  zero.counts = { ...zero.counts, "Multiple Choice": 0 };
  assert.match(validateSpec(zero, { checkFiles: false }).errors.counts, /at least 1/i);

  const neg = baseSpec();
  neg.counts = { ...neg.counts, "Multiple Choice": -1 };
  assert.match(validateSpec(neg, { checkFiles: false }).errors.counts, /non-negative/i);
});

test("validateSpec checks word-count targets", () => {
  const spec = baseSpec();
  spec.wordCounts = { stem: -1, choices: 3 };
  assert.match(validateSpec(spec, { checkFiles: false }).errors.wordCounts, /non-negative/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/spec.test.js`
Expected: FAIL — `validateSpec` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `plugin/spec.js` (add `existsSync` import at the top):

```js
import { existsSync } from "node:fs";
```

```js
export function validateSpec(spec, { checkFiles = true } = {}) {
  const errors = {};

  if (spec.sources.length === 0) {
    errors.sources = "Add at least one source file.";
  } else if (checkFiles) {
    const missing = spec.sources.filter((p) => !existsSync(p));
    if (missing.length) {
      errors.sources = `Not found: ${missing.join(", ")}`;
    } else {
      const wrongExt = spec.sources.filter((p) => !/\.(docx|html?)$/i.test(p));
      if (wrongExt.length) {
        errors.sources = `Must be .docx or .html: ${wrongExt.join(", ")}`;
      }
    }
  }

  if (!spec.subjectCode) errors.subjectCode = "Subject code is required.";
  if (!spec.description) errors.description = "Description is required.";

  for (const [type, n] of Object.entries(spec.counts)) {
    if (!Number.isInteger(n) || n < 0) {
      errors.counts = `Count for ${type} must be a non-negative integer.`;
      break;
    }
  }
  if (!errors.counts) {
    const total = Object.values(spec.counts).reduce((a, b) => a + b, 0);
    if (total <= 0) errors.counts = "Total questions must be at least 1.";
  }

  const { stem, choices } = spec.wordCounts;
  if (!Number.isInteger(stem) || stem < 0) {
    errors.wordCounts = "Stem words must be a non-negative integer.";
  } else if (!Number.isInteger(choices) || choices < 0) {
    errors.wordCounts = "Choice/answer words must be a non-negative integer.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/spec.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/spec.js test/spec.test.js
git commit -m "feat: validateSpec for quiz spec"
```

---

### Task 3: Prompt formatting

**Files:**
- Modify: `plugin/spec.js`
- Test: `test/spec.test.js`

**Interfaces:**
- Consumes: `TYPES`, `MODE_KEYS` (Task 1), `Spec` shape.
- Produces: `buildPrompt(spec: Spec): string`.

- [ ] **Step 1: Write the failing test**

Append to `test/spec.test.js`:

```js
import { buildPrompt } from "../plugin/spec.js";

test("buildPrompt formats every field", () => {
  const spec = normalizeSpec({
    sources: ["FM100/Week7.html", "FM100/Week8.html"],
    subjectCode: "FM100",
    description: "Annuities & Perpetuities",
    examPeriod: "MIDTERM",
    counts: { "Multiple Choice": 10, "True/False": 5 },
    difficulty: "hard",
    modes: { termOnly: true },
    wordCounts: { stem: 40, choices: 3 },
    output: "FM100_MIDTERM.xlsx",
    append: false,
  });
  const text = buildPrompt(spec);
  assert.match(text, /^Generate a quiz using the quiz-gen skill/);
  assert.match(text, /- Sources: FM100\/Week7\.html, FM100\/Week8\.html/);
  assert.match(text, /- Subject code: FM100/);
  assert.match(text, /- Exam period: MIDTERM/);
  assert.match(text, /Multiple Choice 10, True\/False 5, Identification 0, Problem Solving 0, Short Answer 0/);
  assert.match(text, /- Difficulty: hard/);
  assert.match(text, /Modes: situational off, term-only on, calculation off/);
  assert.match(text, /Word-count targets: stem ~40, choices\/answer ~3/);
  assert.match(text, /- Output: FM100_MIDTERM\.xlsx \(overwrite\)/);
  assert.match(text, /extract the source, generate \(Pass 1\), verify \(Pass 2\), export\.$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/spec.test.js`
Expected: FAIL — `buildPrompt` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `plugin/spec.js`:

```js
export function buildPrompt(spec) {
  const counts = TYPES.map((t) => `${t} ${spec.counts[t]}`).join(", ");
  const modes = MODE_KEYS
    .map((k) => `${k === "termOnly" ? "term-only" : k} ${spec.modes[k] ? "on" : "off"}`)
    .join(", ");
  return [
    "Generate a quiz using the quiz-gen skill with these settings:",
    `- Sources: ${spec.sources.join(", ")}`,
    `- Subject code: ${spec.subjectCode}`,
    `- Description: ${spec.description}`,
    `- Exam period: ${spec.examPeriod}`,
    `- Counts: ${counts}`,
    `- Difficulty: ${spec.difficulty}`,
    `- Modes: ${modes}`,
    `- Word-count targets: stem ~${spec.wordCounts.stem}, choices/answer ~${spec.wordCounts.choices}`,
    `- Output: ${spec.output}${spec.append ? " (append if the workbook already has questions)" : " (overwrite)"}`,
    "Run the full pipeline: extract the source, generate (Pass 1), verify (Pass 2), export.",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/spec.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/spec.js test/spec.test.js
git commit -m "feat: buildPrompt renders the spec into a plain-text prompt"
```

---

### Task 4: HTTP server — token auth, config, submit

**Files:**
- Create: `plugin/server.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: `normalizeSpec`, `validateSpec` (spec.js).
- Produces: `createSpecServer({ root: string, formHtml: string, inject: (spec) => Promise<void>, checkFiles?: boolean }): Promise<{ url: string, port: number, token: string, close: () => void }>`. The server also serves `POST /api/preview` → `200 { prompt: string }` (the formatted prompt for the given spec) with the same token rule.

- [ ] **Step 1: Write the failing test**

Create `test/server.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSpecServer } from "../plugin/server.js";

async function makeRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "quizui-"));
  await writeFile(path.join(root, "lesson.docx"), "x");
  await writeFile(path.join(root, "notes.txt"), "x");
  await mkdir(path.join(root, "Week 7"));
  return root;
}

test("config requires the token", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "<h1>hi</h1>", inject: async () => {} });
  const res = await fetch(`${server.url}/api/config`);
  assert.equal(res.status, 403);
  server.close();
});

test("config returns the root when authed", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "<h1>hi</h1>", inject: async () => {} });
  const res = await fetch(`${server.url}/api/config?token=${server.token}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { root });
  server.close();
});

test("preview returns the formatted prompt", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/preview?token=${server.token}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sources: ["a.docx"], subjectCode: "FM100", description: "X" }),
  });
  assert.equal(res.status, 200);
  const { prompt } = await res.json();
  assert.match(prompt, /^Generate a quiz using the quiz-gen skill/);
  assert.match(prompt, /- Output: FM100_PRELIM\.xlsx/);
  server.close();
});

test("index serves the form and sets a cookie", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "<h1>form</h1>", inject: async () => {} });
  const res = await fetch(`${server.url}/?token=${server.token}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /form/);
  assert.match(res.headers.get("set-cookie") || "", /quizui_token=/);
  server.close();
});

test("submit rejects without token", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/submit`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 403);
  server.close();
});

test("submit injects a normalized spec on success", async () => {
  const root = await makeRoot();
  const calls = [];
  const source = path.join(root, "lesson.docx");
  const server = await createSpecServer({
    root, formHtml: "", inject: async (spec) => { calls.push(spec); },
  });
  const res = await fetch(`${server.url}/api/submit?token=${server.token}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sources: [source], subjectCode: "FM100", description: "X" }),
  });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].subjectCode, "FM100");
  assert.equal(calls[0].examPeriod, "PRELIM");
  assert.equal(calls[0].output, "FM100_PRELIM.xlsx");
  server.close();
});

test("submit returns 400 with field errors on invalid spec", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/submit?token=${server.token}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sources: [], subjectCode: "", description: "" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.errors.sources);
  assert.ok(body.errors.subjectCode);
  server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/server.test.js`
Expected: FAIL — cannot find module `../plugin/server.js`.

- [ ] **Step 3: Write minimal implementation**

Create `plugin/server.js`:

```js
import http from "node:http";
import { randomBytes } from "node:crypto";
import { normalizeSpec, validateSpec, buildPrompt } from "./spec.js";

const MAX_BODY = 1_000_000;

function send(res, status, body, headers = {}) {
  const isHtml = typeof body === "string";
  res.writeHead(status, {
    "content-type": isHtml ? "text/html; charset=utf-8" : "application/json",
    ...headers,
  });
  res.end(isHtml ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function createSpecServer({ root, formHtml, inject, checkFiles = true }) {
  const token = randomBytes(16).toString("hex");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const cookieAuthed = (req.headers.cookie || "")
      .split(";")
      .some((c) => c.trim() === `quizui_token=${token}`);
    const authed = url.searchParams.get("token") === token || cookieAuthed;

    try {
      if (req.method === "GET" && url.pathname === "/") {
        if (url.searchParams.get("token") !== token) return send(res, 403, { error: "forbidden" });
        return send(res, 200, formHtml, {
          "set-cookie": `quizui_token=${token}; HttpOnly; SameSite=Strict; Path=/`,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/config") {
        if (!authed) return send(res, 403, { error: "forbidden" });
        return send(res, 200, { root });
      }

      if (req.method === "POST" && url.pathname === "/api/preview") {
        if (!authed) return send(res, 403, { error: "forbidden" });
        let raw;
        try {
          raw = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { errors: { _: "Malformed request body." } });
        }
        return send(res, 200, { prompt: buildPrompt(normalizeSpec(raw)) });
      }

      if (req.method === "POST" && url.pathname === "/api/submit") {
        if (!authed) return send(res, 403, { error: "forbidden" });
        let raw;
        try {
          raw = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { errors: { _: "Malformed request body." } });
        }
        const spec = normalizeSpec(raw);
        const { valid, errors } = validateSpec(spec, { checkFiles });
        if (!valid) return send(res, 400, { errors });
        try {
          await inject(spec);
        } catch (err) {
          return send(res, 500, { errors: { _: `Injection failed: ${err.message}` } });
        }
        return send(res, 200, { ok: true });
      }

      return send(res, 404, { error: "not found" });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    close: () => server.close(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/server.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/server.js test/server.test.js
git commit -m "feat: spec UI HTTP server with token auth and submit endpoint"
```

---

### Task 5: HTTP server — file listing with path confinement

**Files:**
- Modify: `plugin/server.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: `createSpecServer` (Task 4).
- Produces: `GET /api/list?dir=<abs>` → `200 { entries: { name: string, kind: "dir"|"file", path: string }[] }`, `403` outside root (including a symlink that resolves outside root), `400` on a bad/unreadable dir.

- [ ] **Step 1: Write the failing test**

Append to `test/server.test.js`:

```js
test("list returns folders and docx/html files but not other files", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/list?dir=${encodeURIComponent(root)}&token=${server.token}`);
  assert.equal(res.status, 200);
  const { entries } = await res.json();
  const names = entries.map((e) => e.name);
  assert.ok(names.includes("lesson.docx"));
  assert.ok(names.includes("Week 7"));
  assert.ok(!names.includes("notes.txt"));
  server.close();
});

test("list rejects directories outside the root", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const outside = path.dirname(root);
  const res = await fetch(`${server.url}/api/list?dir=${encodeURIComponent(outside)}&token=${server.token}`);
  assert.equal(res.status, 403);
  server.close();
});

test("list requires the token", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/list?dir=${encodeURIComponent(root)}`);
  assert.equal(res.status, 403);
  server.close();
});

test("list rejects a symlink that escapes the root", async (t) => {
  const root = await makeRoot();
  const outside = await mkdtemp(path.join(tmpdir(), "quizui-outside-"));
  await writeFile(path.join(outside, "secret.docx"), "x");
  const link = path.join(root, "escape");
  try {
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch {
    t.skip("symlinks unavailable on this filesystem");
    return;
  }
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/list?dir=${encodeURIComponent(link)}&token=${server.token}`);
  assert.equal(res.status, 403);
  server.close();
});

test("list allows a child whose name begins with dots", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, "..foo"));
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(
    `${server.url}/api/list?dir=${encodeURIComponent(path.join(root, "..foo"))}&token=${server.token}`
  );
  assert.equal(res.status, 200);
  server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/server.test.js`
Expected: FAIL — `/api/list` returns 404.

- [ ] **Step 3: Write minimal implementation**

Add `readdir` and `path` imports to the top of `plugin/server.js`:

```js
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
```

Add a helper above `createSpecServer`:

```js
async function resolveWithinRoot(root, dir) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(dir || resolvedRoot);
  const rel = path.relative(resolvedRoot, target);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return null;
  try {
    const realRoot = await realpath(resolvedRoot);
    const realTarget = await realpath(target);
    const realRel = path.relative(realRoot, realTarget);
    if (realRel === ".." || realRel.startsWith(".." + path.sep) || path.isAbsolute(realRel)) {
      return null;
    }
  } catch {
    // target does not exist; allow it so readdir produces the 400 response
  }
  return target;
}
```

Add this branch inside the request handler, immediately after the `/api/config` branch:

```js
      if (req.method === "GET" && url.pathname === "/api/list") {
        if (!authed) return send(res, 403, { error: "forbidden" });
        const target = await resolveWithinRoot(root, url.searchParams.get("dir"));
        if (!target) return send(res, 403, { error: "forbidden" });
        let dirents;
        try {
          dirents = await readdir(target, { withFileTypes: true });
        } catch {
          return send(res, 400, { errors: { _: "Cannot read that directory." } });
        }
        const entries = dirents
          .filter((e) => e.isDirectory() || (e.isFile() && /\.(docx|html?)$/i.test(e.name)))
          .map((e) => ({
            name: e.name,
            kind: e.isDirectory() ? "dir" : "file",
            path: path.join(target, e.name),
          }))
          .sort((a, b) =>
            a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1
          );
        return send(res, 200, { entries });
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/server.test.js`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/server.js test/server.test.js
git commit -m "feat: confined file listing endpoint for the spec UI"
```

---

### Task 6: Injection into the TUI

**Files:**
- Create: `plugin/inject.js`
- Test: `test/inject.test.js`

**Interfaces:**
- Consumes: `buildPrompt`, `normalizeSpec` (spec.js).
- Produces: `injectSpec(client, spec): Promise<string>` (returns the injected prompt text).

- [ ] **Step 1: Write the failing test**

Create `test/inject.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/inject.test.js`
Expected: FAIL — cannot find module `../plugin/inject.js`.

- [ ] **Step 3: Write minimal implementation**

Create `plugin/inject.js`:

```js
import { buildPrompt } from "./spec.js";

export async function injectSpec(client, spec) {
  const text = buildPrompt(spec);
  await client.tui.clearPrompt({});
  await client.tui.appendPrompt({ body: { text } });
  await client.tui.submitPrompt({});
  await client.tui.showToast({
    body: { message: "Quiz spec sent to OpenCode", variant: "success" },
  });
  return text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/inject.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add plugin/inject.js test/inject.test.js
git commit -m "feat: injectSpec types the spec into the OpenCode TUI"
```

---

### Task 7: Browser launcher

**Files:**
- Create: `plugin/browser.js`
- Test: `test/browser.test.js`

**Interfaces:**
- Produces: `browserCommand(platform: string, url: string): { command: string, args: string[] }`, `openBrowser(url: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `test/browser.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserCommand } from "../plugin/browser.js";

test("browserCommand per platform", () => {
  assert.deepEqual(browserCommand("win32", "http://x"), {
    command: "cmd", args: ["/c", "start", "", "http://x"],
  });
  assert.deepEqual(browserCommand("darwin", "http://x"), {
    command: "open", args: ["http://x"],
  });
  assert.deepEqual(browserCommand("linux", "http://x"), {
    command: "xdg-open", args: ["http://x"],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/browser.test.js`
Expected: FAIL — cannot find module `../plugin/browser.js`.

- [ ] **Step 3: Write minimal implementation**

Create `plugin/browser.js`:

```js
import { spawn } from "node:child_process";

export function browserCommand(platform, url) {
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  if (platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

export function openBrowser(url) {
  try {
    const { command, args } = browserCommand(process.platform, url);
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/browser.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: PASS (all tests from Tasks 1–7).

- [ ] **Step 6: Commit**

```bash
git add plugin/browser.js test/browser.test.js
git commit -m "feat: cross-platform browser launcher"
```

---

### Task 8: Plugin entry point + install script

**Files:**
- Create: `plugin/quiz-ui.js`
- Create: `scripts/install-plugin.ps1`

**Interfaces:**
- Consumes: `createSpecServer` (server.js), `injectSpec` (inject.js), `openBrowser` (browser.js).
- Produces: `QuizUiPlugin` (OpenCode plugin export); the `quiz_ui` custom tool (no args). The tool opens and reports `${server.url}/?token=${server.token}` (the token is required by `GET /`), and is idempotent (reuses the running server); a `dispose` hook closes it.

This file imports `@opencode-ai/plugin`, which is only resolvable inside OpenCode, so it is verified with a manual smoke test rather than `node --test`.

- [ ] **Step 1: Write the plugin entry**

Create `plugin/quiz-ui.js`:

```js
import { tool } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
import { createSpecServer } from "./server.js";
import { injectSpec } from "./inject.js";
import { openBrowser } from "./browser.js";

export const QuizUiPlugin = async ({ client, directory, worktree }) => {
  const root = worktree || directory || process.cwd();
  let server = null;

  return {
    dispose: async () => {
      if (server) {
        server.close();
        server = null;
      }
    },
    tool: {
      quiz_ui: tool({
        description:
          "Open the Quiz-Gen spec UI in the browser. Call this first whenever the " +
          "quiz-gen skill is used. The user fills in the quiz spec and clicks Generate; " +
          "the spec is then typed into the OpenCode prompt and the quiz pipeline starts.",
        args: {},
        async execute() {
          if (!server) {
            const formHtml = await readFile(new URL("./ui.html", import.meta.url), "utf8");
            server = await createSpecServer({
              root,
              formHtml,
              inject: (spec) => injectSpec(client, spec),
            });
          }
          const pageUrl = `${server.url}/?token=${server.token}`;
          const opened = openBrowser(pageUrl);
          return (
            `Quiz-Gen spec UI ${opened ? "opened" : "available"} in the browser at ${pageUrl}\n` +
            "Fill in the quiz settings and click Generate — the spec will be typed into " +
            "the OpenCode prompt and the quiz pipeline will start."
          );
        },
      }),
    },
  };
};
```

- [ ] **Step 2: Write the install script**

Create `scripts/install-plugin.ps1`:

```powershell
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$src = Join-Path $repo "plugin"
$dest = Join-Path $HOME ".config\opencode\plugins"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path (Join-Path $src "*") -Destination $dest -Recurse -Force
Write-Host "Installed quiz-gen plugin files to $dest"
Write-Host "Restart OpenCode for the plugin to load."
```

- [ ] **Step 3: Commit**

```bash
git add plugin/quiz-ui.js scripts/install-plugin.ps1
git commit -m "feat: quiz_ui plugin tool and install script"
```

---

### Task 9: The form page

**Files:**
- Create: `plugin/ui.html`

**Interfaces:**
- Consumes: `GET /api/config`, `GET /api/list`, `POST /api/submit` (server.js). The auth cookie is set by `GET /`.
- Produces: a self-contained page that builds the same `Spec` object `normalizeSpec` expects.

- [ ] **Step 1: Write the page**

Create `plugin/ui.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Quiz-Gen Spec</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; }
  fieldset { border: 1px solid #8884; border-radius: 8px; margin: 1rem 0; padding: .75rem 1rem; }
  legend { font-weight: 600; padding: 0 .4rem; }
  label { display: inline-block; }
  .row { display: flex; gap: .75rem; flex-wrap: wrap; align-items: end; margin: .4rem 0; }
  .field { display: flex; flex-direction: column; }
  .field > span { font-size: .8rem; opacity: .75; }
  input[type=text], input[type=number] { padding: .35rem .5rem; }
  input[type=text] { min-width: 22ch; }
  input[type=number] { width: 5.5ch; }
  .src { display: flex; gap: .5rem; align-items: center; margin: .25rem 0; }
  .src input { flex: 1; }
  .err { color: #c0392b; font-size: .85rem; }
  #preview { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: .8rem;
             background: #8881; border-radius: 8px; padding: .75rem; max-height: 16rem; overflow: auto; }
  button { padding: .5rem .9rem; border-radius: 8px; cursor: pointer; }
  #generate { font-weight: 600; }
  #status { margin-left: .75rem; }
  dialog { border: 1px solid #8884; border-radius: 8px; max-width: 90vw; }
  dialog ul { list-style: none; padding: 0; max-height: 50vh; overflow: auto; }
  dialog li { padding: .25rem .1rem; }
  dialog button.link { background: none; border: none; color: inherit; text-decoration: underline; cursor: pointer; padding: 0; }
</style>
</head>
<body>
  <h1>Quiz-Gen Spec</h1>
  <p id="status"></p>

  <fieldset>
    <legend>Sources</legend>
    <div id="sources"></div>
    <button type="button" id="addSource">+ Add source</button>
    <div class="err" data-err="sources"></div>
  </fieldset>

  <fieldset>
    <legend>Course</legend>
    <div class="row">
      <label class="field"><span>Subject code</span><input type="text" id="subjectCode" placeholder="FM100" /></label>
      <label class="field"><span>Description</span><input type="text" id="description" placeholder="Annuities &amp; Perpetuities" /></label>
    </div>
    <div class="err" data-err="subjectCode"></div>
    <div class="err" data-err="description"></div>
    <div class="row">
      <span>Exam period:</span>
      <label><input type="radio" name="period" value="PRELIM" checked /> PRELIM</label>
      <label><input type="radio" name="period" value="MIDTERM" /> MIDTERM</label>
      <label><input type="radio" name="period" value="FINALS" /> FINALS</label>
    </div>
  </fieldset>

  <fieldset>
    <legend>Questions by type</legend>
    <div class="row">
      <label class="field"><span>Multiple Choice</span><input type="number" id="c-MultipleChoice" value="10" min="0" /></label>
      <label class="field"><span>True/False</span><input type="number" id="c-TrueFalse" value="0" min="0" /></label>
      <label class="field"><span>Identification</span><input type="number" id="c-Identification" value="0" min="0" /></label>
      <label class="field"><span>Problem Solving</span><input type="number" id="c-ProblemSolving" value="0" min="0" /></label>
      <label class="field"><span>Short Answer</span><input type="number" id="c-ShortAnswer" value="0" min="0" /></label>
    </div>
    <div class="err" data-err="counts"></div>
    <div class="row">
      <span>Difficulty:</span>
      <label><input type="radio" name="difficulty" value="easy" /> easy</label>
      <label><input type="radio" name="difficulty" value="medium" checked /> medium</label>
      <label><input type="radio" name="difficulty" value="hard" /> hard</label>
    </div>
    <div class="row">
      <span>Modes:</span>
      <label><input type="checkbox" id="m-situational" /> situational</label>
      <label><input type="checkbox" id="m-termOnly" /> term-only</label>
      <label><input type="checkbox" id="m-calculation" /> calculation</label>
    </div>
  </fieldset>

  <fieldset>
    <legend>Advanced</legend>
    <div class="row">
      <label class="field"><span>Stem words</span><input type="number" id="w-stem" value="30" min="0" /></label>
      <label class="field"><span>Choice/answer words</span><input type="number" id="w-choices" value="3" min="0" /></label>
    </div>
    <div class="row">
      <label class="field"><span>Output file</span><input type="text" id="output" placeholder="auto" /></label>
      <label><input type="checkbox" id="append" checked /> append if workbook exists</label>
    </div>
    <div class="err" data-err="wordCounts"></div>
  </fieldset>

  <fieldset>
    <legend>Preview</legend>
    <div id="preview"></div>
  </fieldset>

  <button id="generate">Generate</button>
  <span id="status2"></span>

  <dialog id="picker">
    <div class="row"><button type="button" id="up">..</button><span id="pickerPath"></span></div>
    <ul id="pickerList"></ul>
    <form method="dialog"><button>Close</button></form>
  </dialog>

<script>
const $ = (sel) => document.querySelector(sel);
const TYPES = [
  ["Multiple Choice", "c-MultipleChoice"],
  ["True/False", "c-TrueFalse"],
  ["Identification", "c-Identification"],
  ["Problem Solving", "c-ProblemSolving"],
  ["Short Answer", "c-ShortAnswer"],
];
let root = "";

function addSource(value = "") {
  const wrap = document.createElement("div");
  wrap.className = "src";
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = "path to .docx or .html";
  input.addEventListener("input", render);
  const browse = document.createElement("button");
  browse.type = "button";
  browse.textContent = "Browse…";
  browse.addEventListener("click", () => openPicker(input));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "×";
  remove.addEventListener("click", () => { wrap.remove(); render(); });
  wrap.append(input, browse, remove);
  $("#sources").append(wrap);
}

function spec() {
  return {
    sources: [...document.querySelectorAll("#sources input")].map((i) => i.value.trim()).filter(Boolean),
    subjectCode: $("#subjectCode").value.trim(),
    description: $("#description").value.trim(),
    examPeriod: document.querySelector('input[name=period]:checked').value,
    counts: Object.fromEntries(TYPES.map(([name, id]) => [name, Number($("#" + id).value) || 0])),
    difficulty: document.querySelector('input[name=difficulty]:checked').value,
    modes: {
      situational: $("#m-situational").checked,
      termOnly: $("#m-termOnly").checked,
      calculation: $("#m-calculation").checked,
    },
    wordCounts: { stem: Number($("#w-stem").value) || 0, choices: Number($("#w-choices").value) || 0 },
    output: $("#output").value.trim(),
    append: $("#append").checked,
  };
}

let previewTimer = null;
function render() {
  document.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 150);
}

async function updatePreview() {
  try {
    const res = await fetch("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(spec()),
    });
    const body = await res.json();
    $("#preview").textContent = body.prompt || "";
  } catch { /* ignore transient preview errors */ }
}

let pickerTarget = null;
let pickerDir = "";
function openPicker(input) {
  pickerTarget = input;
  pickerDir = input.value.trim() || root;
  loadDir(pickerDir);
  $("#picker").showModal();
}
async function loadDir(dir) {
  const res = await fetch(`/api/list?dir=${encodeURIComponent(dir)}`);
  if (!res.ok) { $("#pickerList").innerHTML = "<li>Cannot read directory.</li>"; return; }
  const { entries } = await res.json();
  pickerDir = dir;
  $("#pickerPath").textContent = dir;
  const list = $("#pickerList");
  list.innerHTML = "";
  for (const e of entries) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "link";
    btn.textContent = e.kind === "dir" ? `📁 ${e.name}` : `📄 ${e.name}`;
    btn.addEventListener("click", () => {
      if (e.kind === "dir") { loadDir(e.path); }
      else { pickerTarget.value = e.path; $("#picker").close(); render(); }
    });
    li.append(btn);
    list.append(li);
  }
}
$("#up").addEventListener("click", () => {
  const parent = pickerDir.replace(/[\\/][^\\/]*$/, "");
  if (parent) loadDir(parent);
});

async function submit() {
  $("#status").textContent = "Sending…";
  $("#status2").textContent = "";
  const res = await fetch("/api/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec()),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    $("#status").textContent = "Sent to OpenCode — check the TUI.";
    $("#generate").disabled = true;
    return;
  }
  document.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
  const errs = body.errors || {};
  for (const [k, v] of Object.entries(errs)) {
    const el = document.querySelector(`[data-err="${k}"]`);
    if (el) el.textContent = v;
  }
  $("#status").textContent = errs._ || "Please fix the highlighted fields.";
}

$("#addSource").addEventListener("click", () => { addSource(); render(); });
document.body.addEventListener("input", render);
document.body.addEventListener("change", render);
$("#generate").addEventListener("click", submit);

(async () => {
  try {
    const cfg = await (await fetch("/api/config")).json();
    root = cfg.root || "";
  } catch { /* root stays empty */ }
  addSource();
  render();
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Manual verification**

1. Run the server directly with a scratch root and open the page in a browser:
   `node -e "import('./plugin/server.js').then(async ({createSpecServer})=>{const s=await createSpecServer({root:process.cwd(),formHtml:(await import('node:fs')).readFileSync('plugin/ui.html','utf8'),inject:async(x)=>console.log('INJECT',x)});console.log(s.url+'/?token='+s.token)})"`
2. In the page: click Browse, navigate folders, pick `plugin` (no docx/html shown is fine), type a source path, fill fields.
3. Expected: the Preview updates live with every change.
4. Click Generate with an empty source: expected inline error under Sources; with a valid `.docx` path (create one), expected "Sent to OpenCode" and `INJECT …` in the terminal.

- [ ] **Step 3: End-to-end smoke test in OpenCode**

1. Install the plugin: `powershell -File scripts/install-plugin.ps1`.
2. Restart OpenCode.
3. In a session with a `.docx`/`.html` lesson in the project, ask: "make a quiz for FM100".
4. Expected: the agent calls `quiz_ui`; the browser opens the form; the tool result shows the URL.
5. Fill in a source (via Browse), subject code, exam period; click Generate.
6. Expected: the spec text appears in the OpenCode input box, is submitted, a new turn starts with the spec prompt, and a success toast shows.
7. Close OpenCode; expected: the server closes via `dispose`.

- [ ] **Step 4: Commit**

```bash
git add plugin/ui.html
git commit -m "feat: quiz spec form page"
```

---

### Task 10: Wire the UI into the skill and docs

**Files:**
- Modify: `SKILL.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the `quiz_ui` tool (Task 8).
- Produces: documentation instructing the agent to call `quiz_ui` first and telling users how to install the plugin.

- [ ] **Step 1: Add Step 0 to `SKILL.md`**

Insert a new section immediately after the `## When to Use` section (before `## Inputs — ask first (question tool)`):

```markdown
## Step 0 — Launch the spec UI (default)

If the `quiz_ui` tool is available, call it **first**, before anything else. It opens a
browser form that collects every input below (source, subject, exam period, counts,
difficulty, modes, word-count targets, output). The user fills it in and clicks Generate;
the spec is then typed into the OpenCode prompt and arrives as the next message — treat
that message as the confirmed spec and proceed with the workflow below.

Do not also ask the same questions in chat. If (and only if) the `quiz_ui` tool is not
available, fall back to collecting the inputs with the question tool as described in
`## Inputs`.
```

Then retitle the existing `## Inputs — ask first (question tool)` section to
`## Inputs (fallback when the UI is unavailable)` and keep its content.

- [ ] **Step 2: Add an install/usage section to `README.md`**

Insert after the `## Install` section:

```markdown
### Optional: spec UI plugin

The quiz-gen companion plugin adds a browser form for collecting quiz specs. It opens
automatically whenever the skill runs.

```powershell
powershell -File scripts/install-plugin.ps1
# macOS/Linux: cp plugin/* ~/.config/opencode/plugins/
```

Restart OpenCode after installing. The plugin registers a `quiz_ui` tool; when the skill
is used, the agent calls it, the form opens at `http://127.0.0.1:<random-port>`, and on
submit the spec is typed into the OpenCode prompt to start the pipeline. The server is
loopback-only and token-guarded.
```

- [ ] **Step 3: Verify the docs render and links are correct**

Run: `git diff --stat`
Expected: `SKILL.md` and `README.md` changed.

- [ ] **Step 4: Commit**

```bash
git add SKILL.md README.md
git commit -m "docs: launch the spec UI from the skill; document plugin install"
```

---

## Self-Review

**Spec coverage:**
- Companion plugin `plugin/quiz-ui.js` + `quiz_ui` tool → Task 8.
- Loopback server, ephemeral port, per-run token → Task 4.
- `/`, `/api/config`, `/api/list`, `/api/submit` → Tasks 4–5.
- File picker rooted at project/worktree, `.docx`/`.html` only, confined → Task 5.
- UI fields, defaults, advanced section, live preview → Task 9.
- Prompt format (single + multiple sources, append/overwrite) → Task 3.
- Validation (source exists + extension, subject, description, non-negative integer counts, total > 0, word counts) → Task 2.
- Injection: clearPrompt → appendPrompt → submitPrompt + toast → Task 6.
- Browser launch, cross-platform, fallback URL → Task 7 (+ Task 8 returns the URL).
- Install to `~/.config/opencode/plugins/` → Tasks 8 (script) and 10 (docs).
- Skill Step 0 + fallback; README → Task 10.
- Tests with `node --test` → Tasks 1–7.
- Python scripts untouched → no task modifies them (Global Constraints).

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — every step shows full code.

**Type consistency:** `normalizeSpec`/`validateSpec`/`buildPrompt`/`deriveFilename` are defined in Task 1–3 and used unchanged in Tasks 4, 6, 9. `createSpecServer` returns `{ url, port, token, close }` (Task 4) and is consumed with those exact names in Tasks 8. `injectSpec(client, spec)` (Task 6) matches its use in Task 8. `browserCommand(platform, url)` (Task 7) matches Task 8's `openBrowser`. UI field ids map to the `Spec` keys used by `normalizeSpec`.
