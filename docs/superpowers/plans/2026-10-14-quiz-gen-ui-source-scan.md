# Quiz-Gen UI Auto-Scan Sources & Existing Workbook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Quiz-Gen spec UI auto-detect lesson sources as a checklist and notice an existing quiz workbook, replacing the manual file browser.

**Architecture:** Add a recursive `GET /api/scan` endpoint to the loopback spec server that returns `.docx`/`.html` sources and `.xlsx` workbooks found under the project root. The single-page form renders sources as a grouped checklist and shows a read-only "will append" notice when the effective output workbook already exists. The manual picker (`/api/list`, `Browse…`, add-source rows) is removed.

**Tech Stack:** Node.js stdlib (`node:http`, `node:fs/promises`, `node:path`), vanilla HTML/CSS/JS, `node --test`.

## Global Constraints

- Zero new runtime dependencies — Node stdlib and existing imports only.
- No changes to `scripts/docx_text.py`, `scripts/html_text.py`, `scripts/build_xlsx.py`, the prompt format, or the `questions.json` schema.
- The server stays loopback-only (`127.0.0.1`) and token-gated; `/api/scan` requires the token.
- Scan matches sources with `/\.(docx|html)$/i` and workbooks with `/\.xlsx$/i`. **PDFs are ignored entirely.**
- Always append: the UI never exposes an append/overwrite choice; `spec.append` is always `true`.
- Run tests from the repo root with `node --test`.

---

### Task 1: Recursive `/api/scan` endpoint (replace `/api/list`)

**Files:**
- Modify: `plugin/server.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: existing `resolveWithinRoot(root, dir)` and `send(res, status, body)` helpers in `plugin/server.js`.
- Produces: `GET /api/scan?token=…` → `200 { sources: {name,rel,path}[], workbooks: {name,rel,path}[] }`, `403` without a token, `400` when the root is unreadable. Removes `GET /api/list`.

- [ ] **Step 1: Replace the `/api/list` tests with `/api/scan` tests**

In `test/server.test.js`, delete these four tests in full: `"list returns folders and docx/html files but not other files"`, `"list rejects directories outside the root"`, `"list requires the token"`, and `"list rejects a symlink that escapes the root"`. Replace them with:

```js
test("scan finds nested sources and workbooks recursively", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, "Week 7"));
  await writeFile(path.join(root, "Week 7", "lesson7.html"), "x");
  await writeFile(path.join(root, "FM100_PRELIM.xlsx"), "x");
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/scan?token=${server.token}`);
  assert.equal(res.status, 200);
  const { sources, workbooks } = await res.json();
  const rels = sources.map((s) => s.rel);
  assert.ok(rels.includes("lesson.docx"));
  assert.ok(rels.includes("Week 7/lesson7.html"));
  assert.ok(!rels.some((r) => r.endsWith(".txt")));
  assert.ok(sources.every((s) => typeof s.name === "string" && typeof s.path === "string"));
  assert.ok(workbooks.some((w) => w.name === "FM100_PRELIM.xlsx"));
  server.close();
});

test("scan skips node_modules, .git and dot-directories", async () => {
  const root = await makeRoot();
  for (const dir of ["node_modules", ".git", ".cache"]) {
    await mkdir(path.join(root, dir));
    await writeFile(path.join(root, dir, "hidden.html"), "x");
  }
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const { sources } = await (await fetch(`${server.url}/api/scan?token=${server.token}`)).json();
  const rels = sources.map((s) => s.rel);
  assert.ok(!rels.some((r) => r.startsWith("node_modules/")));
  assert.ok(!rels.some((r) => r.startsWith(".git/")));
  assert.ok(!rels.some((r) => r.startsWith(".cache/")));
  server.close();
});

test("scan requires the token", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/scan`);
  assert.equal(res.status, 403);
  server.close();
});

test("scan does not follow a symlink that escapes the root", async (t) => {
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
  const { sources } = await (await fetch(`${server.url}/api/scan?token=${server.token}`)).json();
  assert.ok(!sources.some((s) => s.name === "secret.docx"));
  server.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/server.test.js`
Expected: FAIL — `/api/scan` returns 404 (only `/api/list` exists).

- [ ] **Step 3: Add the `stat` import**

In `plugin/server.js`, change the fs import (line 3) to:

```js
import { readdir, realpath, stat } from "node:fs/promises";
```

- [ ] **Step 4: Add the scan helper**

In `plugin/server.js`, add these constants and the `scanSources` function immediately after the `resolveWithinRoot` function (after its closing `}`):

```js
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const SOURCE_RE = /\.(docx|html)$/i;
const XLSX_RE = /\.xlsx$/i;

async function scanSources(root) {
  const rootAbs = path.resolve(root);
  const sources = [];
  const workbooks = [];
  const seen = new Set();

  function addEntry(dir, name) {
    const abs = path.resolve(dir, name);
    const rel = path.relative(rootAbs, abs).split(path.sep).join("/");
    if (SOURCE_RE.test(name)) sources.push({ name, rel, path: abs });
    else if (XLSX_RE.test(name)) workbooks.push({ name, rel, path: abs });
  }

  async function walk(dir) {
    let real;
    try {
      real = await realpath(dir);
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of dirents) {
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try {
          const st = await stat(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        if (!(await resolveWithinRoot(root, full))) continue;
        await walk(full);
      } else if (isFile) {
        if (!(await resolveWithinRoot(root, full))) continue;
        addEntry(dir, e.name);
      }
    }
  }

  await walk(root);
  sources.sort((a, b) => a.rel.localeCompare(b.rel));
  workbooks.sort((a, b) => a.rel.localeCompare(b.rel));
  return { sources, workbooks };
}
```

- [ ] **Step 5: Replace the `/api/list` route with `/api/scan`**

In `plugin/server.js`, delete the entire `GET /api/list` block (from `if (req.method === "GET" && url.pathname === "/api/list") {` through its closing `}` before the `/api/preview` block) and insert this in its place:

```js
      if (req.method === "GET" && url.pathname === "/api/scan") {
        if (!authed) return send(res, 403, { error: "forbidden" });
        try {
          await readdir(root);
        } catch {
          return send(res, 400, { errors: { _: "Cannot read the working directory." } });
        }
        return send(res, 200, await scanSources(root));
      }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/server.test.js`
Expected: PASS — all tests green, including the four new `scan` tests.

- [ ] **Step 7: Commit**

```bash
git add plugin/server.js test/server.test.js
git commit -m "feat: add recursive /api/scan for sources and workbooks, drop /api/list"
```

---

### Task 2: Sources checklist and workbook notice in the UI

**Files:**
- Modify: `plugin/ui.html`

**Interfaces:**
- Consumes: `GET /api/scan` (Task 1) and the existing `POST /api/preview`, `POST /api/submit`, `GET /api/config` endpoints.
- Produces: the form's `spec()` object whose `sources` are absolute paths and whose `append` is always `true`. No new endpoints.

- [ ] **Step 1: Add styles for the checklist and notice**

In `plugin/ui.html`, inside the `<style>` block, add these rules immediately after the `.src input { flex: 1; }` rule:

```css
  .chk { display: flex; align-items: center; gap: .35rem; padding: .1rem 0; }
  .group { font-weight: 600; margin-top: .5rem; opacity: .8; }
  .hint { font-size: .85rem; opacity: .7; }
  .notice { color: #0a7; font-size: .9rem; margin: .4rem 0 0; }
```

- [ ] **Step 2: Replace the Sources fieldset markup**

In `plugin/ui.html`, replace the whole Sources fieldset (from `<fieldset>` containing `<legend>Sources</legend>` through its closing `</fieldset>`) with:

```html
  <fieldset>
    <legend>Sources <button type="button" id="refreshSources">Refresh</button></legend>
    <div id="sources"></div>
    <div class="hint" id="sourcesHint"></div>
    <div class="err" data-err="sources"></div>
  </fieldset>
```

- [ ] **Step 3: Add the workbook notice to the Course fieldset**

In `plugin/ui.html`, in the Course fieldset, add `<p class="notice" id="workbookNotice"></p>` immediately after the closing `</div>` of the exam-period `.row` (after the FINALS radio label).

- [ ] **Step 4: Remove the append checkbox**

In `plugin/ui.html`, in the Advanced fieldset, replace the output/append row:

```html
    <div class="row">
      <label class="field"><span>Output file</span><input type="text" id="output" placeholder="auto" /></label>
      <label><input type="checkbox" id="append" checked /> append if workbook exists</label>
    </div>
```

with:

```html
    <div class="row">
      <label class="field"><span>Output file</span><input type="text" id="output" placeholder="auto" /></label>
    </div>
```

- [ ] **Step 5: Remove the picker dialog**

In `plugin/ui.html`, delete the entire `<dialog id="picker"> … </dialog>` block.

- [ ] **Step 6: Replace the `<script>` contents**

In `plugin/ui.html`, replace everything between `<script>` and `</script>` with:

```html
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
let scan = { sources: [], workbooks: [] };

function selectedSources() {
  return [...document.querySelectorAll("#sources input:checked")].map((i) => i.value);
}

function renderSources() {
  const prev = new Set(selectedSources());
  const list = $("#sources");
  list.innerHTML = "";
  if (!scan.sources.length) {
    $("#sourcesHint").textContent = root
      ? `No .docx/.html sources found in ${root}.`
      : "No sources found.";
    return;
  }
  $("#sourcesHint").textContent = "";
  const groups = new Map();
  for (const s of scan.sources) {
    const i = s.rel.lastIndexOf("/");
    const dir = i === -1 ? "" : s.rel.slice(0, i);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(s);
  }
  for (const [dir, items] of groups) {
    if (dir) {
      const h = document.createElement("div");
      h.className = "group";
      h.textContent = dir;
      list.append(h);
    }
    for (const s of items) {
      const label = document.createElement("label");
      label.className = "chk";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = s.path;
      cb.checked = prev.has(s.path);
      const span = document.createElement("span");
      span.textContent = s.name;
      label.append(cb, span);
      list.append(label);
    }
  }
}

async function loadSources() {
  $("#sourcesHint").textContent = "Scanning…";
  let data;
  try {
    const res = await fetch("/api/scan");
    if (!res.ok) throw new Error("scan failed");
    data = await res.json();
  } catch {
    $("#sources").innerHTML = "";
    $("#sourcesHint").textContent = "Could not scan the working directory.";
    return;
  }
  scan = { sources: data.sources || [], workbooks: data.workbooks || [] };
  renderSources();
  renderWorkbookNotice();
}

function effectiveOutput() {
  const o = $("#output").value.trim();
  if (o) return o.toLowerCase().endsWith(".xlsx") ? o : o + ".xlsx";
  const code = $("#subjectCode").value.trim();
  const period = document.querySelector("input[name=period]:checked").value;
  const name = [code, period].filter(Boolean).join("_");
  return name ? name + ".xlsx" : "";
}

function renderWorkbookNotice() {
  const el = $("#workbookNotice");
  const out = effectiveOutput();
  const base = out.replace(/\\/g, "/").split("/").pop().toLowerCase();
  const hit = base && (scan.workbooks || []).find((w) => w.name.toLowerCase() === base);
  el.textContent = hit ? `Found ${hit.name} — new questions will be appended.` : "";
}

function spec() {
  return {
    sources: selectedSources(),
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
    append: true,
  };
}

let previewTimer = null;
function render() {
  document.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
  renderWorkbookNotice();
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

async function submit() {
  $("#generate").disabled = true;
  $("#status").textContent = "Sending…";
  $("#status2").textContent = "";
  let res;
  try {
    res = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(spec()),
    });
  } catch {
    $("#generate").disabled = false;
    $("#status").textContent = "Could not reach the spec server.";
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    $("#status").textContent = "Sent to OpenCode — check the TUI.";
    $("#generate").disabled = true;
    return;
  }
  $("#generate").disabled = false;
  document.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
  const errs = body.errors || {};
  for (const [k, v] of Object.entries(errs)) {
    const el = document.querySelector(`[data-err="${k}"]`);
    if (el) el.textContent = v;
  }
  $("#status").textContent = errs._ || "Please fix the highlighted fields.";
}

$("#refreshSources").addEventListener("click", loadSources);
document.body.addEventListener("input", render);
document.body.addEventListener("change", render);
$("#generate").addEventListener("click", submit);

(async () => {
  try {
    const cfg = await (await fetch("/api/config")).json();
    root = cfg.root || "";
  } catch { /* root stays empty */ }
  await loadSources();
  render();
})();
</script>
```

- [ ] **Step 7: Run the full test suite**

Run: `node --test`
Expected: PASS — all suites green (UI markup changes do not affect the Node tests).

- [ ] **Step 8: Manual verification**

Run: `node --test` from the repo root; then, with the plugin installed, invoke the `quiz_ui` tool or open the form URL. Confirm:
- The Sources fieldset lists the repo's `.docx`/`.html` files as checkboxes grouped by folder, and shows a `Refresh` button.
- There is no `+ Add source` button and no `Browse…` picker dialog.
- Ticking a source updates the Preview prompt's `Sources:` line.
- Typing `FM100` with period `PRELIM` and a real `FM100_PRELIM.xlsx` present shows "Found FM100_PRELIM.xlsx — new questions will be appended."
- There is no "append if workbook exists" checkbox.

- [ ] **Step 9: Commit**

```bash
git add plugin/ui.html
git commit -m "feat: scan sources into a checklist and notice an existing workbook in the spec UI"
```

---

### Task 3: Document the auto-detection

**Files:**
- Modify: `SKILL.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing (documentation only).

- [ ] **Step 1: Update `SKILL.md` Step 0**

In `SKILL.md`, immediately after the sentence that ends "…treat that message as the confirmed spec and proceed with the workflow below." (the paragraph beginning "If the `quiz_ui` tool is available"), add this sentence:

```
The form scans the working directory for `.docx`/`.html` lesson sources and lists
them as a checklist, and it shows a notice when an existing quiz workbook will be
appended to.
```

- [ ] **Step 2: Update `README.md`**

In `README.md`, in the paragraph under "Then restart OpenCode." that begins "Then restart OpenCode. That's the whole setup", after "…and the spec is typed into the OpenCode prompt to run the pipeline." add:

```
The form scans your project for `.docx`/`.html` lesson sources and shows them as a
checklist, and it flags an existing `FM100_PRELIM.xlsx` so you know new questions
will be appended.
```

- [ ] **Step 3: Verify the docs render**

Run: `git diff -- SKILL.md README.md`
Expected: only the two added sentences appear; no other lines change.

- [ ] **Step 4: Commit**

```bash
git add SKILL.md README.md
git commit -m "docs: note the spec UI auto-detects sources and existing workbooks"
```

---

## Self-Review

**Spec coverage:**
- `GET /api/scan` returning `sources` + `workbooks` recursively → Task 1, Steps 4–5.
- Skips `node_modules`, `.git`, dot-dirs → Task 1, Step 4 (`SKIP_DIRS` + `e.name.startsWith(".")`) and Step 1 (test).
- Symlink confinement + loop guard → Task 1, Steps 4 (`resolveWithinRoot` + `seen`) and 1 (test).
- Token required → Task 1, Steps 5 and 1.
- Remove `GET /api/list` → Task 1, Step 5; tests replaced in Step 1.
- Sources as a grouped checklist with Refresh → Task 2, Steps 1–2, 6.
- Remove manual rows and picker → Task 2, Steps 2, 5, 6.
- Existing-workbook notice by effective output basename → Task 2, Steps 3, 6.
- Remove append checkbox; `append` always true → Task 2, Steps 4, 6.
- Docs note → Task 3.
- PDFs ignored → enforced by `SOURCE_RE`/`XLSX_RE` in Task 1, Step 4.

**Placeholder scan:** No "TBD", "TODO", or "handle edge cases" — every step shows exact code or an exact command.

**Type consistency:** `{name, rel, path}` is the shape used in server tests, `scanSources`, and `renderSources`. `selectedSources()` returns absolute `path` strings matching `spec.sources` validation (`.docx`/`.html`, existing). `effectiveOutput()` mirrors `deriveFilename` in `plugin/spec.js`. The `append` key matches `normalizeSpec`'s boolean coercion.
