import { existsSync } from "node:fs";

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
