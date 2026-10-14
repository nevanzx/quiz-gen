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
