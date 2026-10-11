#!/usr/bin/env python3
"""Extract quiz-source text from an HTML lesson notebook.

Targets the "interactive-lesson-notebook" / v2 notebook structure, whose
teaching content lives in <section class="block" id="..."> blocks.

By default only the NUMBERED teaching sections are kept. These are DROPPED:
    Overview & Outcomes, Glossary, Lab/Activity, Assignment, Recap, References
(the exclusion is matched on the section id and its <h2> heading).

MathML (<math> ...) is flattened to readable plain text (e.g. PV_due, x^(n),
(a) / (b)) so downstream quiz generation can read formulas. App chrome
(nav/buttons/script/style/no-print) is stripped.

Usage:
    python html_text.py lesson.html                 # text to stdout
    python html_text.py lesson.html -o source.txt   # text to file
    python html_text.py lesson.html --list-sections # show the section map only
    python html_text.py lesson.html --keep overview # force-include a section
    python html_text.py lesson.html --outcomes-file outcomes.txt
"""
import argparse
import re
import sys

from bs4 import BeautifulSoup, NavigableString, Tag

EXCLUDE_PATTERNS = [
    r"overview", r"glossary", r"\blab\b", r"activity", r"activities",
    r"assignment", r"recap", r"summary", r"references?\b", r"outcomes?\b",
]
EXCLUDE_RE = re.compile("|".join(EXCLUDE_PATTERNS), re.I)

SKIP_TAGS = {"script", "style", "svg", "nav", "button", "header", "footer", "aside", "noscript"}
BLOCK_TAGS = {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "div",
              "tr", "blockquote", "pre", "figcaption", "figcaption"}


# --- MathML -> plain text -------------------------------------------------

def _kids(el):
    return [c for c in el.children
            if not (isinstance(c, NavigableString) and not str(c).strip())]


def math_to_text(el):
    if isinstance(el, NavigableString):
        return str(el)
    if not isinstance(el, Tag):
        return ""
    tag = el.name
    ch = _kids(el)
    if tag in ("mi", "mn", "mo", "mtext", "ms", "mspace"):
        return el.get_text()
    if tag in ("math", "mrow", "semantics", "mstyle", "mphantom", "mpadded",
               "menclose", "mover", "munder", "munderover"):
        return "".join(math_to_text(c) for c in ch)
    if tag == "msub":
        return f"{math_to_text(ch[0])}_{math_to_text(ch[1])}" if len(ch) >= 2 else ""
    if tag == "msup":
        return f"{math_to_text(ch[0])}^{math_to_text(ch[1])}" if len(ch) >= 2 else ""
    if tag == "msubsup":
        return (f"{math_to_text(ch[0])}_{math_to_text(ch[1])}^{math_to_text(ch[2])}"
                if len(ch) >= 3 else "")
    if tag == "mfrac":
        if len(ch) >= 2:
            return f"({math_to_text(ch[0])}) / ({math_to_text(ch[1])})"
        return ""
    if tag == "msqrt":
        return "sqrt(" + "".join(math_to_text(c) for c in ch) + ")"
    if tag == "mroot":
        return (f"root({math_to_text(ch[0])}, {math_to_text(ch[1])})"
                if len(ch) >= 2 else "")
    if tag == "mfenced":
        return "(" + ", ".join(math_to_text(c) for c in ch) + ")"
    if tag == "mtable":
        return " ; ".join(" | ".join(math_to_text(td) for td in _kids(tr)) for tr in ch)
    if tag in ("mtr", "mtd"):
        return " | ".join(math_to_text(c) for c in ch)
    if tag == "annotation":
        return ""
    return "".join(math_to_text(c) for c in ch)


# --- HTML -> text ---------------------------------------------------------

def _replace_math(soup):
    for m in soup.find_all("math"):
        m.replace_with(NavigableString(" " + math_to_text(m) + " "))


def _render_table(tbl):
    lines = []
    for tr in tbl.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
        if cells:
            lines.append(" | ".join(cells))
    return "\n".join(lines)


def _walk(el, out):
    for c in el.children:
        if isinstance(c, NavigableString):
            out.append(str(c))
            continue
        if not isinstance(c, Tag):
            continue
        classes = c.get("class") or []
        if c.name in SKIP_TAGS or "no-print" in classes:
            continue
        if c.name == "table":
            out.append("\n" + _render_table(c) + "\n")
            continue
        if c.name in ("ul", "ol"):
            for li in c.find_all("li", recursive=False):
                out.append("\n- ")
                _walk(li, out)
            out.append("\n")
            continue
        if c.name == "br":
            out.append("\n")
            continue
        if c.name in BLOCK_TAGS:
            out.append("\n")
            _walk(c, out)
            out.append("\n")
            continue
        _walk(c, out)


def _normalize(out):
    text = "".join(out)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def section_text(section):
    _walk(section, [])
    out = []
    _walk(section, out)
    return _normalize(out)


def find_sections(soup):
    sections = soup.select("section.block") or soup.find_all("section")
    result = []
    for s in sections:
        sid = s.get("id", "")
        h2 = s.find("h2")
        title = h2.get_text(" ", strip=True) if h2 else ""
        result.append((sid, title, s))
    return result


def is_excluded(sid, title, keep):
    key = f"{sid} {title}".lower()
    if any(k.lower() in key for k in keep):
        return False
    return bool(EXCLUDE_RE.search(f"{sid} {title}"))


def extract_outcomes(soup):
    for sid, title, sec in find_sections(soup):
        if "overview" in (sid + " " + title).lower() or "outcome" in (sid + " " + title).lower():
            items = [li.get_text(" ", strip=True) for li in sec.find_all("li")]
            if not items:
                txt = section_text(sec)
                # keep lines that read like learning outcomes
                items = [ln for ln in txt.splitlines() if len(ln) > 30]
            return "\n".join(i for i in items if i)
    return ""


def main():
    ap = argparse.ArgumentParser(description="Extract quiz source text from an HTML lesson notebook.")
    ap.add_argument("html")
    ap.add_argument("-o", "--out")
    ap.add_argument("--outcomes-file")
    ap.add_argument("--list-sections", action="store_true")
    ap.add_argument("--keep", nargs="*", default=[],
                    help="section ids/titles to force-include despite the exclusion list")
    args = ap.parse_args()

    with open(args.html, "r", encoding="utf-8", errors="replace") as fh:
        soup = BeautifulSoup(fh.read(), "html.parser")
    _replace_math(soup)

    sections = find_sections(soup)

    if args.list_sections:
        for sid, title, _ in sections:
            mark = "SKIP" if is_excluded(sid, title, args.keep) else "KEEP"
            print(f"[{mark}] {sid} :: {title}")
        return 0

    parts = []
    for sid, title, sec in sections:
        if is_excluded(sid, title, args.keep):
            continue
        body = section_text(sec)
        if not body:
            continue
        # The <h2> heading is rendered inside the section body too; drop the echo.
        first, _, rest = body.partition("\n")
        if first.strip() == title.strip():
            body = rest.strip()
        parts.append(f"## {title}".rstrip())
        parts.append(body)
    text = "\n\n".join(parts).strip() + "\n"

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        kept = sum(1 for sid, t, _ in sections if not is_excluded(sid, t, args.keep))
        print(f"Wrote {len(text)} chars from {kept} kept section(s) -> {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(text)

    if args.outcomes_file:
        with open(args.outcomes_file, "w", encoding="utf-8") as fh:
            fh.write(extract_outcomes(soup) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
