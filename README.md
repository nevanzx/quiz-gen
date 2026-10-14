# quiz-gen

An [OpenCode](https://opencode.ai) skill that generates exam-ready quizzes from
lesson sources and exports them to the NotesLM 13-column Excel format. The
OpenCode agent writes the questions; small Python scripts handle the binary I/O
(reading `.docx` and HTML lesson notebooks, writing `.xlsx`). No API key needed.

It reproduces the generation + verification pipeline used by the NotesLM app's
Quiz module, so quizzes generated on the command line match the app's output.

## Sources

| Source | Script | Notes |
|---|---|---|
| `.docx` | `scripts/docx_text.py` | paragraphs + tables in order |
| `.html` lesson notebook | `scripts/html_text.py` | keeps teaching sections only |

For HTML notebooks, the extractor keeps the numbered teaching sections and drops
Overview, Glossary, Lab/Activity, Assignment, Recap, and References. MathML is
flattened to plain text (`PV_due`, `(a) / (b)`).

## Install

```bash
pip install -r requirements.txt   # python-docx, beautifulsoup4, openpyxl
# optional: pywin32, only needed to auto save+close a workbook you have open in Excel
pip install pywin32
```

### Wire into OpenCode

Add the repo path to `skills.paths` in `~/.config/opencode/opencode.json`:

```json
{ "skills": { "paths": ["D:/Python/quiz-gen"] } }
```

…and/or link it into your skills directory:

```bash
# macOS/Linux
ln -s /path/to/quiz-gen ~/.claude/skills/quiz-gen
# Windows (PowerShell, as admin or with developer mode)
New-Item -ItemType Junction -Path "$HOME\.claude\skills\quiz-gen" -Target "D:\Python\quiz-gen"
```

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

## Use

Once installed, just ask in OpenCode, e.g. *"Generate a Week 7 exam quiz from
this lesson notebook"*. The skill asks for the settings, then runs the pipeline.
Under the hood:

```bash
python scripts/html_text.py lesson.html -o source.txt --outcomes-file outcomes.txt
python scripts/docx_text.py lesson.docx -o source.txt
#   ... agent writes questions.json (Pass 1), then verifies it (Pass 2) ...
python scripts/build_xlsx.py questions.json -o "FM100_PRELIM.xlsx" --answer-key

# a workbook already exists and holds questions — keep them, add only the new ones
python scripts/build_xlsx.py new_questions.json -o "FM100_PRELIM.xlsx" --append --answer-key
```

## Output

`{SubjectCode}_{ExamPeriod}.xlsx`, sheet **Questions**, 13 columns:
`# · Learning Outcome · Topic · QUESTION · Type of Question · Taxonomy · Choice A–D ·
Answer · Correct answer in Words · Timer (Seconds)` — identical to the NotesLM
Quiz editor's Excel export. `--answer-key` adds a readable second sheet.

When the output workbook already exists and holds questions, pass `--append`: its
existing rows are kept and round-trip unchanged, the new questions are added after
them, and duplicates (by question text) are skipped — so re-running is safe. If the
file is open in Excel, `build_xlsx.py` saves and closes it via Excel automation
(pywin32) and retries before giving up.

Timers are computed by the script (`max(20, ceil(words × 1.5 / 5) × 5)` for
MC/TF, taxonomy seconds for Identification, step-based for Problem Solving, 900
for Short Answer), so leave `timer` out of your JSON.

## Layout

```
SKILL.md                     # workflow the agent follows
reference/generation-rules.md # Pass 1 rules
reference/verification.md     # Pass 2 checklist
scripts/html_text.py          # HTML notebook -> source text
scripts/docx_text.py          # .docx -> source text
scripts/build_xlsx.py         # questions JSON -> .xlsx
examples/questions.sample.json
```

## License

MIT
