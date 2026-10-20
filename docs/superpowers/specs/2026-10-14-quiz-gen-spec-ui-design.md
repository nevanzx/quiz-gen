# Quiz-Gen Spec UI — Design

**Date:** 2026-10-14
**Status:** Approved (pending written-spec review)
**Topic:** A local browser UI, driven by an OpenCode companion plugin, that collects
quiz specs and types them into the running OpenCode TUI to trigger the quiz-gen pipeline.

## Problem

The quiz-gen skill gathers its inputs (source, subject, exam period, per-type counts,
difficulty, modes, word-count targets, output) by asking questions in the chat. That is
slow and error-prone. We want a single form — used whenever the skill runs — and on
submit the selection should be **typed into OpenCode** and start the quiz pipeline.

## Goals

- A browser form presenting the full skill input set, with sensible defaults.
- Triggered automatically whenever the quiz-gen skill is used.
- On submit, the spec is typed into the OpenCode TUI prompt box and submitted, starting
  a new agent turn that runs the existing generate → verify → export pipeline.
- Zero new runtime dependencies for the UI; minimal, self-contained plugin.
- No changes to the existing Python scripts or question-generation rules.

## Non-goals

- No changes to `scripts/docx_text.py`, `scripts/html_text.py`, `scripts/build_xlsx.py`.
- No change to the NotesLM 13-column Excel output format.
- No hosted/remote UI; the server is loopback-only and short-lived.
- No attempt to discover the TUI server port by scanning (it is not published); an
  in-process plugin is the bridge.

## Architecture

```
User: "make a quiz for FM100"
  → agent loads the quiz-gen skill
  → agent calls the custom tool `quiz_ui`
        └─ plugin starts a loopback HTTP server (ephemeral port, per-run token)
           opens the browser to the form
           returns immediately ("UI opened at …")
  → user fills the form, clicks Generate
        └─ POST /api/submit → validate
           client.tui.clearPrompt()
           client.tui.appendPrompt({ body: { text: <spec prompt> } })
           client.tui.submitPrompt()
           client.tui.showToast(...)
  → a new agent turn begins with the spec prompt visible in the TUI
  → skill runs: extract source → Pass 1 generate → Pass 2 verify → build_xlsx.py
```

The TUI server's port is randomly assigned and not published, so a plain skill script
cannot reliably reach the session. OpenCode plugins receive an in-process SDK `client`
and the `serverUrl`, which is the only reliable bridge.

## Components

### A. Companion plugin — `plugin/quiz-ui.js`

Source lives in this repo; installed to the OpenCode global plugins directory
(`~/.config/opencode/plugins/`).

- Exports an OpenCode plugin function (`Plugin` shape from `@opencode-ai/plugin`) that:
  - Registers a custom tool `quiz_ui` via the plugin `tool` hook.
  - Captures `client`, `directory`, and `worktree` from the plugin input.
- The `quiz_ui` tool `execute`:
  - Starts the HTTP server if it is not already running (idempotent; returns the
    existing URL on repeat calls).
  - Opens the default browser (`start` on Windows, `open` on macOS, `xdg-open` on Linux).
  - Returns a short result: `UI opened at <url> — fill in the quiz spec and click Generate.`
  - If the browser cannot be opened, returns the URL so it can be opened manually.
- The server is a Node `http` server bound to `127.0.0.1` on an ephemeral port,
  zero runtime dependencies, with:
  - A per-run random token (passed as `?token=` and mirrored into a cookie) required by
    `POST /api/submit` and `GET /api/list`, defeating other local pages.
  - An idle timeout and cleanup on the plugin `dispose` hook so it does not linger.
- On submit the plugin:
  1. Validates the spec server-side (see Validation).
  2. Builds the spec prompt string (see Prompt format).
  3. `client.tui.clearPrompt()` then `client.tui.appendPrompt({ body: { text } })` then
     `client.tui.submitPrompt()`.
  4. `client.tui.showToast({ body: { message, variant } })` for success/failure.
  5. On success, the server stays up until the idle timeout (so the browser can show a
     confirmation), then closes.

The plugin must call `client.app.log(...)` (not `console.log`) for diagnostics.

#### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Serve `ui.html` (token-gated) |
| `GET` | `/api/list?dir=<abs>&token=…` | Read-only listing of sub-folders and `.docx`/`.html` files |
| `POST` | `/api/submit?token=…` | Receive + validate the spec, inject the prompt |
| `GET` | `/api/config?token=…` | Initial defaults (cwd root, default counts) for the page |

- `/api/list` resolves and confines `dir` to the file-picker root (default: the plugin's
  `directory`/`worktree`). Paths outside the root are rejected. Only directory names and
  `.docx`/`.html` file names are returned; no file contents.

### B. UI page — `plugin/ui.html`

Single-page, dependency-free HTML/CSS/JS (fields rendered by vanilla JS). Fields:

| Field | Control | Default |
|---|---|---|
| Sources | repeatable rows; `Browse…` (server listing) + manual path; `+ Add source` / `×` | empty |
| Subject code | text | `FM100` (placeholder) |
| Description | text | empty |
| Exam period | radio: PRELIM / MIDTERM / FINALS | PRELIM |
| Counts per type | number: Multiple Choice, True/False, Identification, Problem Solving, Short Answer | MCQ 10, others 0 |
| Difficulty | radio: easy / medium / hard | medium |
| Modes | checkboxes: situational, term-only, calculation | all off |
| Word-count targets | number: stem, choices/answer | stem 30, choices 3 |
| Output | text (filename/path) | `{SubjectCode}_{ExamPeriod}.xlsx` |
| Append if exists | checkbox | on (matches skill auto-append) |
| Preview | read-only generated prompt text | live |
| Generate | submit button | — |

Behaviour:
- A live preview shows the exact prompt that will be typed.
- Client-side validation mirrors the server (see Validation) with inline messages.
- On success, the page shows a confirmation; on failure, the returned error.

### C. Prompt format

Structured but plain text (no LaTeX, no meta-references), e.g.:

```
Generate a quiz using the quiz-gen skill with these settings:
- Sources: FM100/Week7.html
- Subject code: FM100
- Description: Annuities, Perpetuities & Multi-Stage Planning
- Exam period: PRELIM
- Counts: Multiple Choice 10, True/False 0, Identification 0, Problem Solving 0, Short Answer 0
- Difficulty: medium
- Modes: situational off, term-only off, calculation off
- Word-count targets: stem ~30, choices/answer ~3
- Output: FM100_PRELIM.xlsx (append if the workbook already has questions)
Run the full pipeline: extract the source, generate (Pass 1), verify (Pass 2), export.
```

With multiple sources, `Sources:` lists them comma-separated; per-type counts are
**totals across all sources**; each question's `topic` is the filename of the source it
came from (existing skill rule).

### D. Validation

Server-side (mirrored client-side):

- At least one source path is required; each must exist and end in `.docx` or `.html`.
- Subject code and description required.
- Exam period ∈ {PRELIM, MIDTERM, FINALS}.
- Counts are non-negative integers; total questions > 0.
- Difficulty ∈ {easy, medium, hard}.
- Word-count targets are non-negative integers (0 means "sensible length").
- Output ends in `.xlsx` (extension appended if missing).

Invalid input returns HTTP 400 with per-field messages; nothing is injected.

### E. Skill / docs changes

- `SKILL.md`: add **Step 0 — Launch the spec UI**, instructing the agent to call the
  `quiz_ui` tool first. If the tool is not available, tell the user to install the plugin
  (see README) or fall back to collecting inputs with the chat `question` tool. The
  Inputs section notes specs normally come from the UI.
- `README.md`: install + usage section for the plugin.
- `scripts/install-plugin.ps1`: copies `plugin/quiz-ui.js` and `plugin/ui.html` into
  `~/.config/opencode/plugins/` (creating it if needed). A shell/`cp` note for macOS/Linux.

## Error handling

- Port busy → retry the next ephemeral port.
- Browser open failure → return the URL in the tool result.
- Token mismatch/absent → HTTP 403, no side effects.
- `/api/list` path outside root → HTTP 403.
- Injection failure (TUI endpoints unreachable) → error toast + error surfaced to the
  browser and the tool result; server stays up so the user can retry.
- Idle timeout and plugin `dispose` close the server.

## File layout (additions)

```
plugin/quiz-ui.js                 # companion plugin: tool + HTTP server + injection
plugin/ui.html                    # single-page form (vanilla)
scripts/install-plugin.ps1        # install into ~/.config/opencode/plugins/
package.json                      # private; node --test scripts (dev only)
test/quiz-ui.test.js              # unit tests
docs/superpowers/specs/2026-10-14-quiz-gen-spec-ui-design.md
```

## Testing

`node --test` (Node 24 available) covering:

- Prompt formatting from a spec object (single + multiple sources; defaults filled).
- Validation rules (missing source, bad period, negative counts, zero total, bad ext).
- HTTP layer against the real server on `127.0.0.1`: token required for `/api/submit`
  and `/api/list`; `/api/list` confines to root; submit happy-path; submit invalid → 400.
- Injection: a mocked `client` records `clearPrompt`/`appendPrompt`/`submitPrompt` calls
  with the expected text.

## Open questions (defaults chosen)

1. **File-picker root** → defaults to the plugin's project/worktree `directory`;
   sub-folders navigable; manual path entry also allowed.
2. **Multiple sources** → per-type counts are totals across all sources (simplest);
   per-source topics preserved.
