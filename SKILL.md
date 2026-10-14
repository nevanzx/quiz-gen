---
name: quiz-gen
description: Use when generating exam or quiz questions from lesson sources — a .docx file or an HTML lesson notebook (e.g. an FM100 Week-N-Notebook.html) — and exporting them to the NotesLM 13-column Excel format. Triggers on "generate a quiz", "make exam questions", "quiz from this lesson", "add more questions to the quiz", "MCQ / True-False / Identification / Problem Solving / Short Answer questions", "export the quiz to Excel", "build an answer key", or any lesson file accompanied by a request for questions, including when a quiz .xlsx already exists or is open in Excel.
---

# Quiz-Gen

## Overview

Turn one or more lesson sources into an exam-ready quiz and export it to the
NotesLM `.xlsx`. **You write the questions; the bundled scripts do the binary
I/O** you cannot do directly (read `.docx`/HTML, write Excel). No API key.

Two passes, in this order:
1. **Generate** — write questions from the source (`reference/generation-rules.md`).
2. **Verify** — fact-check and fix them against the source (`reference/verification.md`), then export.

## When to Use

- A teacher hands you a lesson (`.docx` or `.html` notebook) and wants quiz/exam questions.
- Keywords: quiz, exam, test paper, MCQ, identification, true/false, problem solving, answer key, Excel.
- When NOT to use: writing lesson content, slides, or activities.

## Step 0 — Launch the spec UI (default)

If the `quiz_ui` tool is available, call it **first**, before anything else. It opens a
browser form that collects every input below (source, subject, exam period, counts,
difficulty, modes, word-count targets, output). The user fills it in and clicks Generate;
the spec is then typed into the OpenCode prompt and arrives as the next message — treat
that message as the confirmed spec and proceed with the workflow below.

Do not also ask the same questions in chat. If (and only if) the `quiz_ui` tool is not
available, fall back to collecting the inputs with the question tool as described in
`## Inputs`.

## Inputs (fallback when the UI is unavailable)

Do not guess these; use the question tool, then confirm a one-line summary.

1. **Source path(s)** — `.docx` or `.html`. Multiple allowed.
2. **Subject code** (e.g. `FM100`) and **description** (e.g. `Annuities & Perpetuities`).
3. **Exam period** — `PRELIM` | `MIDTERM` | `FINALS`.
4. **Counts per type** — Multiple Choice, True/False, Identification, Problem Solving, Short Answer. Default: MCQ = 10, others = 0.
5. **Difficulty** — easy | medium | hard (default medium).
6. **Modes** (default off): situational, term-only, calculation.
7. **Word-count targets** — question stem (default ~30), choices/answer (default ~3).

## Existing output workbook

Before generating, check whether the output file (`{SubjectCode}_{ExamPeriod}.xlsx`, or the
`-o` path) already exists in the working folder. This decides the export flags — and
whether you ask anything at all.

- **Exists and already has questions** → keep them. Export with `--append` (below). Do
  **not** ask the user anything; just add the new questions after the existing ones. Put
  **only the new questions** in `questions.json` — `--append` reads the old rows back out
  of the workbook itself, so don't re-type them. (Re-adding an existing question is
  harmless: duplicates are skipped by question text.)
- **Exists but has no questions yet** → ask the owner (question tool) whether it is the
  correct workbook to write to before overwriting it.
- **Does not exist** → create it normally.

## Workflow

**1. Extract the source text.** Never read `.docx`/HTML as raw bytes; run the script.
Run every command below from the skill directory (the folder holding this `SKILL.md`),
or substitute the absolute path to the script.

```bash
# HTML lesson notebook — keeps ONLY teaching sections; drops Overview,
# Glossary, Lab/Activity, Assignment, Recap, References (your standing rule).
python scripts/html_text.py "lesson.html" -o source.txt --outcomes-file outcomes.txt
python scripts/html_text.py "lesson.html" --list-sections   # show what is kept/dropped

# .docx
python scripts/docx_text.py "lesson.docx" -o source.txt
```

`outcomes.txt` (optional) holds the lesson's learning outcomes — use it ONLY for the
`learningOutcome` column; never draw question content from the Overview.

**2. Generate (Pass 1).** Read `reference/generation-rules.md`, then write the
questions to `questions.json`. **Leave `timer` out — the script computes it exactly.**
Use the schema in `examples/questions.sample.json`.

**3. Verify (Pass 2).** Read `reference/verification.md` and re-check every question
against `source.txt`. Fix what fails, then save `questions.json` again. Do not skip
this pass.

**4. Export.**

```bash
# new workbook
python scripts/build_xlsx.py questions.json -o "FM100_PRELIM.xlsx" --answer-key

# workbook already exists and holds questions — keep them, add the new ones
python scripts/build_xlsx.py new_questions.json -o "FM100_PRELIM.xlsx" --append --answer-key
```

Filename defaults to `{SubjectCode}_{ExamPeriod}.xlsx`. If the workbook is open in Excel,
`build_xlsx.py` saves and closes it (via Excel automation) and retries; if it still cannot
write, it stops and tells you to close the file. Report the output path, the type counts,
which sections were used, and anything you flagged.

## Question object schema

```json
{ "learningOutcome": "", "topic": "SourceName", "question": "…", "type": "Multiple Choice",
  "taxonomy": "Understanding", "choices": {"A": "…","B": "…","C": "…","D": "…"},
  "answer": "A", "answerText": "…" }
```

- `type` ∈ Multiple Choice, True/False, Identification, Problem Solving, Short Answer.
- Non-MC types: `choices` = `{}`, `answer` = `""`, the key lives in `answerText`.
- `topic` = source filename without extension, same for every question.

## Excel output (13 columns, matches NotesLM `_exportExcel`)

`# | Learning Outcome | Topic | QUESTION | Type of Question | Taxonomy | Choice A | Choice B | Choice C | Choice D | Answer | Correct answer in Words | Timer (Seconds)`

## Common Mistakes

| Mistake | Fix |
|---|---|
| MC choices of wildly different lengths | All four choices within **±2 words** of each other |
| Using "Remembering" for a medium/hard set | Difficulty band applies to **every** type (see rules) |
| "According to the lesson…" in a stem | Standalone question, no meta-references |
| Hand-computing timers | Omit `timer`; `build_xlsx.py` computes it |
| LaTeX / `$…$` in text | Plain numbers only (`×`, `−`, `√`, `^`, `_`) |
| Drawing questions from Overview/Glossary/Assignment/Recap | Source = teaching sections only |
| Re-typing existing questions into `questions.json` when the workbook already has them | Pass `--append`; list only the new questions — old rows are read from the file |
| Asking "overwrite or append?" when the workbook already has questions | Append silently with `--append`; ask only when the file exists but is empty |
| Treating a `PermissionError` on save as fatal | `build_xlsx.py` saves+closes the open workbook and retries; let it finish |

## Requirements

`pip install -r requirements.txt` (`python-docx`, `beautifulsoup4`, `openpyxl`).
