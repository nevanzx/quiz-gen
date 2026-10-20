#!/usr/bin/env python3
"""Extract quiz-source text from a .docx document.

Reads paragraphs and tables in document order. A heading paragraph that
matches the exclusion list (Overview, Glossary, Lab/Activity, Assignment,
Recap, Summary, References, Outcomes) starts a skipped region that ends at
the next heading, so a syllabus/lesson export can carry the same section
names as the HTML notebooks.

Usage:
    python docx_text.py source.docx                 # text to stdout
    python docx_text.py source.docx -o source.txt   # text to file
    python docx_text.py source.docx --keep overview # force-include a heading
"""
import argparse
import re
import sys

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

EXCLUDE_RE = re.compile(
    r"^\s*(?:\d+[.)]?\s*)?(overview|glossary|lab|activity|activities|assignment|"
    r"recap|summary|references?|outcomes?)\b", re.I)


def iter_blocks(doc):
    from docx.oxml.ns import qn
    body = doc.element.body
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, doc)
        elif child.tag == qn("w:tbl"):
            yield Table(child, doc)


def is_heading(p):
    style_el = p.style
    style = ((style_el.name if style_el is not None else "") or "").lower()
    return style.startswith("heading") or style in ("title", "subtitle")


def table_text(tbl):
    lines = []
    for row in tbl.rows:
        cells = [c.text.strip().replace("\n", " ") for c in row.cells]
        if any(cells):
            lines.append(" | ".join(cells))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="Extract quiz source text from a .docx document.")
    ap.add_argument("docx")
    ap.add_argument("-o", "--out")
    ap.add_argument("--keep", nargs="*", default=[],
                    help="heading keywords to force-include")
    args = ap.parse_args()

    doc = Document(args.docx)
    keep = [k.lower() for k in args.keep]
    parts = []
    skipping = False

    for block in iter_blocks(doc):
        if isinstance(block, Table):
            if not skipping:
                t = table_text(block)
                if t:
                    parts.append(t)
            continue
        text = block.text.strip()
        if not text:
            continue
        if is_heading(block):
            forced = any(k in text.lower() for k in keep)
            skipping = (not forced) and bool(EXCLUDE_RE.match(text))
            if not skipping:
                parts.append(f"## {text}")
            continue
        if skipping:
            continue
        parts.append(text)

    out = "\n\n".join(parts).strip() + "\n"
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(out)
        print(f"Wrote {len(out)} chars -> {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
