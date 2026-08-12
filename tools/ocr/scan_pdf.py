"""OCR selected PDF pages into reproducible JSONL records.

This is intentionally a small ingestion primitive for the DBT demo. It keeps
PDF page numbers, OCR boxes, confidence scores, and page dimensions together so
that every extracted passage can later be traced back to the source scan.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pymupdf as fitz
import numpy as np
from rapidocr_onnxruntime import RapidOCR


def parse_pages(spec: str, page_count: int) -> list[int]:
    """Parse a 1-based page specification such as ``1-20,35,40-42``."""

    selected: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            start, end = int(start_text), int(end_text)
        else:
            start = end = int(part)
        if start < 1 or end < start or end > page_count:
            raise ValueError(
                f"Invalid page range {part!r}; document has {page_count} pages"
            )
        selected.update(range(start - 1, end))
    return sorted(selected)


def normalize_result(result: list | None) -> tuple[list[dict], str, float | None]:
    if not result:
        return [], "", None

    lines: list[dict] = []
    for item in result:
        box, text, score = item
        lines.append(
            {
                "box": [[round(float(x), 2), round(float(y), 2)] for x, y in box],
                "text": str(text).strip(),
                "score": round(float(score), 4),
            }
        )

    lines.sort(
        key=lambda line: (
            min(point[1] for point in line["box"]),
            min(point[0] for point in line["box"]),
        )
    )
    text = "\n".join(line["text"] for line in lines if line["text"])
    avg_score = round(sum(line["score"] for line in lines) / len(lines), 4)
    return lines, text, avg_score


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--pages", required=True, help="1-based ranges: 1-20,35")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--dpi", type=int, default=150)
    args = parser.parse_args()

    pdf_path = args.pdf.resolve()
    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    document = fitz.open(pdf_path)
    page_indexes = parse_pages(args.pages, document.page_count)
    engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1)
    zoom = args.dpi / 72
    matrix = fitz.Matrix(zoom, zoom)

    with output_path.open("w", encoding="utf-8", newline="\n") as stream:
        for page_index in page_indexes:
            page = document.load_page(page_index)
            pixmap = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB, alpha=False)
            image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
                pixmap.height, pixmap.width, pixmap.n
            )
            result, _ = engine(image, use_cls=True)
            lines, text, avg_score = normalize_result(result)
            record = {
                "source_file": pdf_path.name,
                "pdf_page": page_index + 1,
                "page_index": page_index,
                "render_dpi": args.dpi,
                "width": pixmap.width,
                "height": pixmap.height,
                "avg_score": avg_score,
                "text": text,
                "lines": lines,
            }
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
            stream.flush()
            print(
                f"OCR {pdf_path.name} page {page_index + 1}/{document.page_count}",
                flush=True,
            )


if __name__ == "__main__":
    main()
