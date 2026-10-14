# Quiz-Gen Spec UI — Auto-Scan Sources & Existing Workbook — Design

**Date:** 2026-10-14
**Status:** Approved (pending written-spec review)
**Topic:** Improve the Quiz-Gen spec UI so it auto-detects lesson sources (.docx/.html)
as a checklist and notices an existing quiz workbook, replacing the manual file browser.

## Problem

The Quiz-Gen spec UI currently makes the user build a source list by hand: each source is
a text row with a `Browse…` button that opens a directory picker (`/api/list`). The user
must know where the lesson files live and add them one by one. Separately, whether the
output workbook already exists is only reflected by a generic "append if workbook exists"
checkbox, so the user cannot see that a real workbook is present.

We want the UI, the moment it opens, to:

- Show every lesson source it can find (`.docx`/`.html`) under the working directory as a
  checklist, so the user just ticks the topics to include.
- Detect an existing quiz workbook for the chosen subject/period and say plainly that new
  questions will be appended to it.

## Goals

- Auto-scan the working directory (recursively) for `.docx`/`.html` sources and `.xlsx`
  workbooks, and render the sources as a checklist.
- Remove the manual `+ Add source` rows and the Browse picker.
- Detect the effective output workbook and show a read-only notice that new questions will
  be appended when it already exists.
- Always append (no append/overwrite choice in the UI).
- Keep the prompt format, `questions.json` schema, NotesLM 13-column output, and the
  Python scripts unchanged.

## Non-goals

- No PDF support. PDFs are not scanned and are out of scope for this change.
- No changes to `scripts/docx_text.py`, `scripts/html_text.py`, `scripts/build_xlsx.py`.
- No change to the prompt format or the question schema.
- No change to the existing skill auto-append behaviour; the UI merely reflects it.
- No hosted/remote UI; the server stays loopback-only and short-lived.

## Architecture

```
User: "make a quiz for FM100"
  → agent loads the quiz-gen skill
  → agent calls quiz_ui
        └─ plugin starts loopback HTTP server, opens the browser form
  → page loads:
        GET /api/scan   → { sources: [...docx/.html], workbooks: [...xlsx] }
        renders sources as a checklist; matches the effective output
        against workbooks and shows an append notice if found
  → user ticks topics, fills the spec, clicks Generate
        └─ POST /api/submit → validate → inject the spec prompt into the TUI
  → skill runs: extract source → Pass 1 generate → Pass 2 verify → build_xlsx.py --append
```

Scanning happens on every page load and on demand via a **Refresh** button; the server
walks the filesystem at request time, so results are never stale.

## Components

### A. Server — `plugin/server.js`

**Add `GET /api/scan?token=…`:**

- Recursively walks the confined root (`root`) and returns:
  - `sources`: `[{ name, rel, path }]` for every file matching `/\.(docx|html)$/i`.
  - `workbooks`: `[{ name, rel, path }]` for every file matching `/\.xlsx$/i`.
- `rel` is the path relative to `root` (forward-slashed), used as the display label;
  `path` is the absolute path, used as the selected source value.
- Skips `node_modules`, `.git`, and any directory whose name begins with `.`.
- Guards against symlink loops by tracking visited real paths and never following a
  symlink out of the root (reuses the same confinement rule as `resolveWithinRoot`).
- Requires the auth token; unauthenticated → 403.
- Unreadable sub-directories are skipped silently; an unreadable root is a 400.

**Remove `GET /api/list`** (and its confinement/`/api/list` tests). `/api/scan` replaces
its directory-reading role. `resolveWithinRoot` stays (used by `/api/scan`).

### B. UI — `plugin/ui.html`

**Sources fieldset → checklist:**

- On load, fetch `/api/scan` and render each returned source as a checkbox:
  - Label: the source's `rel` (relative path); group entries by their parent folder.
  - Value: the absolute `path`.
  - Checked sources become `spec.sources` (absolute paths), in the returned order.
- A **Refresh** button re-fetches `/api/scan` and preserves existing ticks by path.
- Empty result shows a short hint ("No .docx/.html sources found in <root>").
- Remove the `+ Add source` button and the `Browse…`/picker `<dialog>` markup and code.

**Existing-workbook notice:**

- Compute the effective output name: the trimmed `output` field if set, else
  `{SubjectCode}_{ExamPeriod}.xlsx` (same derivation as `spec.js`).
- If that basename matches an entry in `workbooks`, show a read-only notice:
  *"Found <name> — new questions will be appended."*
- If it does not match, show nothing (or a neutral hint), never an error.

**Remove the append checkbox.** `append` is implicitly always `true`.

### C. Spec — `plugin/spec.js`

- Keep `append: true` as the constant default; `normalizeSpec` still coerces `append` to
  a boolean (default stays `true`).
- `buildPrompt` keeps the existing "(append if the workbook already has questions)"
  wording. No prompt schema change.
- `validateSpec` unchanged: sources must be non-empty, exist, and end in `.docx`/`.html`.
  Scan results satisfy this.

### D. Skill / docs

- `SKILL.md`: note in Step 0 that the UI auto-detects lesson sources and existing
  workbooks, so the user just ticks the topics.
- `README.md`: same one-line note in the UI usage section.

## Error handling

- Token mismatch/absent on `/api/scan` → 403, no side effects.
- Unreadable sub-directory during the walk → skipped, walk continues.
- Unreadable root → 400 with a message the page shows inline.
- Scan failure on page load → the checklist shows a retry hint; other fields still work.
- Symlink escaping the root → not followed; never listed.
- No sources selected at submit → existing `sources` validation fires (400).

## File layout (changes)

```
plugin/server.js   # + GET /api/scan, − GET /api/list
plugin/ui.html     # sources checklist + refresh + workbook notice; − manual rows/picker
plugin/spec.js     # append stays true by default (no behavioural change)
test/server.test.js# replace /api/list tests with /api/scan tests
SKILL.md, README.md# note auto-detected sources + workbook
docs/superpowers/specs/2026-10-14-quiz-gen-ui-source-scan-design.md
```

## Testing

`node --test` covering:

- `/api/scan` returns nested `.docx`/`.html` files (recursive) and `.xlsx` workbooks.
- `/api/scan` skips `node_modules`, `.git`, and dot-directories.
- `/api/scan` requires the token (403 without) and stays confined to the root.
- `/api/scan` does not follow a symlink that escapes the root.
- Existing prompt/validation/submit tests remain green.

## Open questions (defaults chosen)

1. **Scan depth** → unbounded recursion, skipping the heavy/hidden dirs above.
2. **Workbook matching** → by basename of the effective output; multiple matches → the
   first is named in the notice.
3. **PDFs** → ignored entirely.
