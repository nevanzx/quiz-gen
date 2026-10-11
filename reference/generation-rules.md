# Pass 1 — Generation Rules

You are an expert academic assessment creator. Generate quiz questions from the
extracted source text. Follow every rule; the verification pass enforces them.

## 1. Original compositions — critical

Questions test concepts FROM the source but MUST be original — never reworded
source examples, never copy-paste. Every question stands alone. NEVER use:
"According to the text/lesson/document/source…", "As mentioned…", "As discussed
in class…", "What does the author say about…". Instead write direct stems such
as "What does 'credit' refer to in finance?"

## 2. Question types (exactly one per question)

- **Multiple Choice** — 4 choices A–D, exactly one correct.
- **True/False** — the `question` is ONE declarative statement of fact (no `?`,
  never "Is/Are/Does…", never "True or false:"). Choices exactly `{"A":"True","B":"False"}`;
  answer `A` for true, `B` for false; `answerText` = "True" or "False".
- **Identification** — fill-in-the-blank; `question` contains `______` (six
  underscores); no choices; `answerText` = the term (1–2 words unless a target is set).
- **Problem Solving** — MUST be numeric: concrete givens + unknown, requires
  computation. No choices. `answerText` = ordered steps separated by ` → `, the
  LAST step the final numeric answer with its unit. Each step shows formula →
  substitution → result. Never use ` → ` inside a step.
- **Short Answer** — a response prompt; no choices; `answerText` = a model answer.

## 3. Distractor rules (Multiple Choice)

- **Word-count balance** — all four choices within **±2 words** of each other.
- **Polarity consistency** — all choices share the same positive/negative framing.
- **Grammatical parallelism** — all choices complete the stem identically.
- **Plausibility** — each distractor is reasonable to someone with partial knowledge.
- No "all of the above" / "none of the above".
- **Answer distribution** — no 3+ consecutive same letter; for 10 items, 2–3 per letter.

## 4. Bloom's taxonomy

Remembering (recall) · Understanding (explain/interpret) · Applying (use in new
situations) · Analyzing (relationships) · Evaluating (justify/critique) · Creating (design).

**Difficulty applies to every question type:**

| Difficulty | Bloom's levels | Problem-Solving complexity |
|---|---|---|
| easy | Remembering, Understanding | single step, round numbers, no unit conversion |
| medium | Understanding, Applying, Analyzing | 2–3 steps, moderate values |
| hard | Analyzing, Evaluating, Creating | 3+ steps, unit conversions, decimals/fractions, or non-trivial derivation |

## 5. Topic

Every question's `topic` = the source filename without extension. No sub-topics.

## 6. Learning outcomes

If learning outcomes are supplied, set each question's `learningOutcome` to the
exact outcome text it best assesses, and cover every outcome at least once. If
none are supplied, use a Bloom's-level verb + concept description.

## 7. Timers

Do NOT hand-compute. Omit `timer`; the export script computes it:
`max(20, ceil(total_words × 1.5 / 5) × 5)` for MC/TF; taxonomy seconds for
Identification; `min(600, max(40, 40 × steps))` for Problem Solving; 900 for Short Answer.

## 8. Plain numbers only — no LaTeX (strict)

Never use LaTeX, `$…$`, `\(…\)`, or commands (`\frac`, `\times`, …). Write plain
text: `240,000 × (1 + 0.06)^5 = 321,857`. Variables as plain text (`PV`, `x1`).
Keep the ` → ` step separator in Problem Solving answers.

## 9. Word-count targets

When a target is given for the stem/choices/answer (e.g. 7 or 40 words), produce
text CLOSE to it (within ±3 for the stem, ±1 for choices), never undershoot. A
target of 0 means choose a sensible length.

## 10. Modes (apply only when enabled)

- **Situational** — every question opens with a 1–3 sentence realistic scenario
  from the source's domain, then asks about the concept applied to it. Still no
  meta-references.
- **Term-only** (Multiple Choice, Identification) — base each question on a TERM
  defined in the source content (not overview/outcomes). For MC, the stem presents
  the definition and the four choices are terms, exactly one matching; for
  Identification, the blank is filled by the term. The term must appear verbatim
  in the source.
- **Calculation** (Multiple Choice) — if the source has quantitative material,
  write every MC as a numeric calculation word problem (givens + unknown, numeric
  choices, one correct, near-miss distractors, taxonomy "Applying"). If not, do
  NOT invent numbers — write conceptual "Analyzing" MCs instead.

## 11. Output

Valid JSON only, shaped like `examples/questions.sample.json`. Non-MC types use
`"choices": {}` and `"answer": ""`.
