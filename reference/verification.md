# Pass 2 — Verification

Re-check EVERY generated question against the extracted source text before
exporting. For each question, walk this list; fix any failure in place. Never
leave a known failure for the teacher to find.

## Checklist

1. **Factual correctness** — the correct answer and the whole stem are true and
   supported by the source. Correct the answer if it is wrong.
2. **Distractor compliance (MC)** — the four choices are within ±2 words of each
   other, share polarity, are grammatically parallel, are all plausible, and
   none is "all/none of the above".
3. **Answer-key distribution (MC)** — for a set of N, no 3+ consecutive same
   letter; roughly even per letter (2–3 each for 10). Re-balance if skewed.
4. **No duplicates** — no two questions test the same point in the same way.
5. **No meta-references** — no "According to the text/lesson…". If present, rewrite
   the stem to stand alone.
6. **Difficulty band** — each `taxonomy` is inside the requested difficulty's
   Bloom's levels (applies to every type).
7. **Type conformance** — True/False is a declarative statement (no `?`); the
   True/False choices are exactly `{"A":"True","B":"False"}`; Identification
   contains `______`; Problem Solving is numeric and its `answerText` is ` → `-separated
   steps ending in the final value with units.
8. **Original composition** — not a reworded source example; tests understanding.
9. **Plain numbers only** — no LaTeX in stem, choices, or `answerText`.
10. **Modes** — if situational / term-only / calculation were enabled, confirm each
    question conforms; otherwise confirm the default rules were followed.
11. **Timers** — must be absent or null (the export script computes them).

## Output

Return the corrected questions only. If a question passes unchanged, keep it
as-is. Then write the final `questions.json` and export.
