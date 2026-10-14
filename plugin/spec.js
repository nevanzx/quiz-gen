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
