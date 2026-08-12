"""Build a compact, provenance-preserving search index from OCR JSONL files.

The generated JSON is intentionally model-agnostic. Retrieval can run without
an API key, while a configured closed-model adapter may use the same evidence
records for grounded generation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path


SOURCE_CONFIG = {
    "DBT情绪调节手册（上） (莱恩汉).pdf": {
        "source_id": "dbt-manual-upper",
        "book": "《DBT情绪调节手册（上）：标准技能训练手册》",
        "printed_offset": 23,
        "role": "训练师教学说明",
    },
    "DBT情绪调节手册（下） (莱恩汉).pdf": {
        "source_id": "dbt-handouts-lower",
        "book": "《DBT情绪调节手册（下）：讲义与练习单》",
        "printed_offset": 21,
        "role": "用户讲义与练习单",
    },
}

HEADING_PATTERNS = [
    re.compile(r"第[一二三四五六七八九十百0-9]+[章节篇][^。]{0,28}"),
    re.compile(r"(?:情绪调节|痛苦耐受|人际效能|正念)[^\n]{0,8}(?:讲义|练习单)[^\n]{0,30}"),
    re.compile(r"(?:讲义|练习单)\s*[0-9A-Za-z一二三四五六七八九十]+[^\n]{0,32}"),
]


def compact_text(value: str) -> str:
    lines = []
    for raw_line in value.replace("\r", "\n").split("\n"):
        line = re.sub(r"\s+", " ", raw_line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def select_heading(text: str, fallback: str) -> str:
    beginning = text[:900]
    candidates: list[str] = []
    for pattern in HEADING_PATTERNS:
        candidates.extend(match.group(0).strip(" ：:。") for match in pattern.finditer(beginning))
    if candidates:
        heading = min(candidates, key=lambda item: (len(item) > 34, -len(item)))[:46]
        heading = heading.split("。", 1)[0].strip(" ，,；;：:。")
        heading = re.sub(r"(?:这份|这项|本讲义)$", "", heading).strip()
        return heading

    for line in beginning.split("\n")[:8]:
        cleaned = line.strip(" -—_·•：:")
        if 4 <= len(cleaned) <= 32 and not re.fullmatch(r"[0-9 .]+", cleaned):
            return cleaned.split("。", 1)[0].strip()
    return fallback


def excerpt(text: str, limit: int = 420) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip("，。；; ") + "……"


def read_records(ocr_dir: Path) -> tuple[dict[tuple[str, int], dict], list[str], int, int]:
    records: dict[tuple[str, int], dict] = {}
    files: list[str] = []
    valid_line_count = 0
    invalid_line_count = 0
    for path in sorted(ocr_dir.glob("*.jsonl")):
        if path.name == "speed-test.jsonl":
            continue
        files.append(path.name)
        with path.open("rb") as stream:
            for line_number, line in enumerate(stream, 1):
                try:
                    record = json.loads(line.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    # A concurrently running OCR process may leave one partial tail line.
                    invalid_line_count += 1
                    continue
                source_file = record.get("source_file")
                pdf_page = record.get("pdf_page")
                if source_file not in SOURCE_CONFIG or not isinstance(pdf_page, int):
                    continue
                valid_line_count += 1
                text = compact_text(str(record.get("text", "")))
                key = (source_file, pdf_page)
                current = records.get(key)
                quality = (float(record.get("avg_score") or 0), int(record.get("render_dpi") or 0), len(text))
                current_quality = (
                    float(current.get("avg_score") or 0),
                    int(current.get("render_dpi") or 0),
                    len(str(current.get("text", ""))),
                ) if current else (-1.0, -1, -1)
                if quality > current_quality:
                    records[key] = {**record, "text": text, "_input": f"{path.name}:{line_number}"}
    return records, files, valid_line_count, invalid_line_count


def build_pages(records: dict[tuple[str, int], dict]) -> list[dict]:
    pages: list[dict] = []
    previous_heading: dict[str, str] = {}
    for (source_file, pdf_page), record in sorted(records.items(), key=lambda item: (item[0][0], item[0][1])):
        config = SOURCE_CONFIG[source_file]
        fallback = previous_heading.get(source_file, config["role"])
        heading = select_heading(record["text"], fallback)
        previous_heading[source_file] = heading
        printed_page = pdf_page - config["printed_offset"]
        if printed_page < 1:
            printed_page = None
        stable_key = f"{config['source_id']}:{pdf_page}"
        pages.append(
            {
                "id": hashlib.sha1(stable_key.encode("utf-8")).hexdigest()[:14],
                "sourceId": config["source_id"],
                "sourceFile": source_file,
                "book": config["book"],
                "section": heading,
                "pdfPage": pdf_page,
                "printedPage": printed_page,
                "text": record["text"],
                "excerpt": excerpt(record["text"]),
                "ocrScore": record.get("avg_score"),
                "renderDpi": record.get("render_dpi"),
            }
        )
    return pages


def quality_summary(pages: list[dict], valid_line_count: int, invalid_line_count: int) -> dict:
    by_source = Counter(page["sourceId"] for page in pages)
    searchable_pages = [page for page in pages if page["text"]]
    scores = [float(page["ocrScore"]) for page in pages if isinstance(page.get("ocrScore"), (int, float))]
    low_confidence = [page["id"] for page in pages if isinstance(page.get("ocrScore"), (int, float)) and page["ocrScore"] < 0.75]
    return {
        "pageCount": len(pages),
        "searchablePageCount": len(searchable_pages),
        "bySource": dict(by_source),
        "duplicateRecordCount": max(0, valid_line_count - len(pages)),
        "invalidJsonLineCount": invalid_line_count,
        "averageOcrScore": round(sum(scores) / len(scores), 4) if scores else None,
        "lowConfidencePageCount": len(low_confidence),
        "lowConfidencePageIds": low_confidence,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ocr-dir", type=Path, default=Path("data/ocr"))
    parser.add_argument("--output", type=Path, default=Path("data/rag/index-v1.json"))
    args = parser.parse_args()

    records, files, valid_line_count, invalid_line_count = read_records(args.ocr_dir.resolve())
    pages = build_pages(records)
    output = {
        "version": "1.0",
        "builtAt": datetime.now(UTC).isoformat(),
        "mode": "page-level-provenance",
        "quality": quality_summary(pages, valid_line_count, invalid_line_count),
        "inputFiles": files,
        "pages": pages,
    }
    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(output_path), **output["quality"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
