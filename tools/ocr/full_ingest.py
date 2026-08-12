"""Run full-book OCR in bounded parallel jobs with resumable JSONL outputs."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
from pathlib import Path

import pymupdf as fitz
import numpy as np
from rapidocr_onnxruntime import RapidOCR

from scan_pdf import normalize_result


ROOT = Path(__file__).resolve().parents[2]
SPECS = [
    ("upper-001-157", ROOT.parent / "DBT情绪调节手册（上） (莱恩汉).pdf", 1, 157),
    ("upper-158-314", ROOT.parent / "DBT情绪调节手册（上） (莱恩汉).pdf", 158, 314),
    ("upper-315-471", ROOT.parent / "DBT情绪调节手册（上） (莱恩汉).pdf", 315, 471),
    ("upper-472-628", ROOT.parent / "DBT情绪调节手册（上） (莱恩汉).pdf", 472, 628),
    ("upper-629-784", ROOT.parent / "DBT情绪调节手册（上） (莱恩汉).pdf", 629, 784),
    ("lower-001-131", ROOT.parent / "DBT情绪调节手册（下） (莱恩汉).pdf", 1, 131),
    ("lower-132-262", ROOT.parent / "DBT情绪调节手册（下） (莱恩汉).pdf", 132, 262),
    ("lower-263-392", ROOT.parent / "DBT情绪调节手册（下） (莱恩汉).pdf", 263, 392),
]


def completed_pages(path: Path) -> set[int]:
    if not path.exists():
        return set()
    result: set[int] = set()
    with path.open("rb") as stream:
        for line in stream:
            try:
                page = json.loads(line.decode("utf-8")).get("pdf_page")
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            if isinstance(page, int):
                result.add(page)
    return result


def remove_partial_tail(path: Path) -> None:
    """Drop an interrupted final JSONL line before appending resumed pages."""
    if not path.exists() or path.stat().st_size == 0:
        return
    content = path.read_bytes()
    if content.endswith(b"\n"):
        return
    boundary = content.rfind(b"\n")
    path.write_bytes(content[: boundary + 1] if boundary >= 0 else b"")


def compact_output(spec: tuple[str, Path, int, int]) -> dict:
    """Rewrite one job file to exactly one best valid record per expected page."""
    name, _, first_page, last_page = spec
    output_path = ROOT / "data" / "ocr" / f"{name}.jsonl"
    records: dict[int, dict] = {}
    invalid = 0
    total = 0
    with output_path.open("rb") as stream:
        for line in stream:
            total += 1
            try:
                record = json.loads(line.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                invalid += 1
                continue
            page = record.get("pdf_page")
            if not isinstance(page, int) or not first_page <= page <= last_page:
                invalid += 1
                continue
            current = records.get(page)
            quality = (
                float(record.get("avg_score") or 0),
                int(record.get("render_dpi") or 0),
                len(str(record.get("text") or "")),
            )
            current_quality = (
                float(current.get("avg_score") or 0),
                int(current.get("render_dpi") or 0),
                len(str(current.get("text") or "")),
            ) if current else (-1.0, -1, -1)
            if quality > current_quality:
                records[page] = record

    expected = set(range(first_page, last_page + 1))
    missing = sorted(expected - records.keys())
    if missing:
        raise RuntimeError(f"{name} missing pages: {missing[:12]}")

    temporary = output_path.with_suffix(".jsonl.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        for page in sorted(records):
            stream.write(json.dumps(records[page], ensure_ascii=False) + "\n")
    temporary.replace(output_path)
    return {
        "job": name,
        "unique": len(records),
        "duplicatesRemoved": max(0, total - invalid - len(records)),
        "invalidRemoved": invalid,
    }


def run_spec(spec: tuple[str, Path, int, int], dpi: int) -> dict:
    name, pdf_path, first_page, last_page = spec
    output_path = ROOT / "data" / "ocr" / f"{name}.jsonl"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    remove_partial_tail(output_path)
    done = completed_pages(output_path)
    mode = "a" if done else "w"
    document = fitz.open(pdf_path)
    engine = RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
    matrix = fitz.Matrix(dpi / 72, dpi / 72)
    processed = 0

    with output_path.open(mode, encoding="utf-8", newline="\n") as stream:
        for pdf_page in range(first_page, last_page + 1):
            if pdf_page in done:
                continue
            page = document.load_page(pdf_page - 1)
            pixmap = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB, alpha=False)
            image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
                pixmap.height, pixmap.width, pixmap.n
            )
            result, _ = engine(image, use_cls=True)
            lines, text, avg_score = normalize_result(result)
            record = {
                "source_file": pdf_path.name,
                "pdf_page": pdf_page,
                "page_index": pdf_page - 1,
                "render_dpi": dpi,
                "width": pixmap.width,
                "height": pixmap.height,
                "avg_score": avg_score,
                "text": text,
                "lines": lines,
            }
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
            stream.flush()
            processed += 1
    return {"job": name, "processed": processed, "total": last_page - first_page + 1}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--dpi", type=int, default=105)
    args = parser.parse_args()
    lock_path = ROOT / "data" / "ocr" / ".full_ingest.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as error:
        raise SystemExit(f"OCR ingest is already running: {lock_path}") from error
    try:
        os.write(descriptor, str(os.getpid()).encode("ascii"))
        os.close(descriptor)
        with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as executor:
            futures = [executor.submit(run_spec, spec, args.dpi) for spec in SPECS]
            for future in concurrent.futures.as_completed(futures):
                print(json.dumps(future.result(), ensure_ascii=False), flush=True)
        for spec in SPECS:
            print(json.dumps(compact_output(spec), ensure_ascii=False), flush=True)
    finally:
        lock_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
