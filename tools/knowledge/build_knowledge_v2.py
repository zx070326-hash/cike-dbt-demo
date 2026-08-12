"""Build the canonical V2 DBT knowledge package from the full page index.

The V1 index remains the immutable OCR-derived page layer. V2 adds source-
exact evidence chunks and an evidence-linked Wiki navigation layer. Every
non-empty source character must be covered by at least one chunk; the build
fails closed when page, character, or Wiki-link coverage is incomplete.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path


BOUNDARIES = "\n。！？；;.!?"


def stable_id(*parts: object) -> str:
    value = ":".join(str(part) for part in parts)
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]


def normalize(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", value.casefold())


def source_hash(path: Path) -> str | None:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def choose_end(text: str, start: int, max_chars: int) -> int:
    hard_end = min(start + max_chars, len(text))
    if hard_end == len(text):
        return hard_end
    soft_start = start + int(max_chars * 0.62)
    for cursor in range(hard_end, soft_start, -1):
        if text[cursor - 1] in BOUNDARIES:
            return cursor
    return hard_end


def split_page(page: dict, max_chars: int, overlap: int) -> list[dict]:
    text = page["text"]
    if not text:
        return []
    chunks: list[dict] = []
    start = 0
    ordinal = 0
    while start < len(text):
        end = choose_end(text, start, max_chars)
        chunk_id = stable_id("knowledge-v2", page["sourceId"], page["pdfPage"], start, end)
        chunks.append(
            {
                "id": chunk_id,
                "pageId": page["id"],
                "sourceId": page["sourceId"],
                "sourceFile": page["sourceFile"],
                "book": page["book"],
                "section": page["section"],
                "pdfPage": page["pdfPage"],
                "printedPage": page["printedPage"],
                "charStart": start,
                "charEnd": end,
                "ordinal": ordinal,
                "text": text[start:end],
                "ocrScore": page.get("ocrScore"),
            }
        )
        if end >= len(text):
            break
        next_start = max(start + 1, end - overlap)
        start = next_start
        ordinal += 1
    return chunks


def character_coverage(text_length: int, chunks: list[dict]) -> int:
    if text_length == 0:
        return 0
    ranges = sorted((chunk["charStart"], chunk["charEnd"]) for chunk in chunks)
    covered = 0
    cursor = 0
    for start, end in ranges:
        if start > cursor:
            continue
        if end > cursor:
            covered += end - cursor
            cursor = end
    return covered


def build_wiki_nodes(taxonomy: list[dict], chunks: list[dict]) -> list[dict]:
    nodes: list[dict] = []
    for item in taxonomy:
        aliases = [normalize(alias) for alias in item["aliases"]]
        scored: list[tuple[float, dict, list[str]]] = []
        for chunk in chunks:
            normalized_text = normalize(chunk["text"])
            normalized_section = normalize(chunk["section"])
            matched = [
                item["aliases"][index]
                for index, alias in enumerate(aliases)
                if alias and (alias in normalized_text or alias in normalized_section)
            ]
            if not matched:
                continue
            score = sum(10 if aliases[item["aliases"].index(alias)] in normalized_section else 2 for alias in matched)
            score += sum(min(normalized_text.count(normalize(alias)), 4) for alias in matched)
            if chunk["printedPage"] is None and chunk["pdfPage"] <= 20:
                score *= 0.15
            scored.append((score, chunk, matched))
        scored.sort(key=lambda row: (-row[0], row[1]["sourceId"], row[1]["pdfPage"], row[1]["ordinal"]))
        if not scored:
            raise ValueError(f"Wiki node has no source evidence: {item['id']}")
        selected = []
        seen_pages: set[tuple[str, int]] = set()
        for score, chunk, matched in scored:
            page_key = (chunk["sourceId"], chunk["pdfPage"])
            if page_key in seen_pages and len(selected) >= 6:
                continue
            selected.append(
                {
                    "chunkId": chunk["id"],
                    "matchedAliases": matched,
                    "retrievalWeight": round(score, 2),
                }
            )
            seen_pages.add(page_key)
            if len(selected) >= 12:
                break
        nodes.append(
            {
                **item,
                "reviewStatus": "source-linked-unreviewed",
                "linkedChunkCount": len(scored),
                "evidence": selected,
            }
        )
    return nodes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--page-index", type=Path, default=Path("data/rag/index-v1.json"))
    parser.add_argument("--taxonomy", type=Path, default=Path("tools/knowledge/wiki_taxonomy.json"))
    parser.add_argument("--source-root", type=Path, default=Path(".."))
    parser.add_argument("--output", type=Path, default=Path("data/knowledge/knowledge-v2.json"))
    parser.add_argument("--manifest-output", type=Path, default=Path("data/knowledge/manifest-v2.json"))
    parser.add_argument("--max-chars", type=int, default=900)
    parser.add_argument("--overlap", type=int, default=120)
    args = parser.parse_args()

    if args.max_chars < 300 or args.overlap < 0 or args.overlap >= args.max_chars:
        raise ValueError("Chunk settings are outside safe bounds")

    page_index = json.loads(args.page_index.resolve().read_text(encoding="utf-8"))
    taxonomy = json.loads(args.taxonomy.resolve().read_text(encoding="utf-8"))
    pages = page_index["pages"]
    chunks = [
        chunk
        for page in pages
        for chunk in split_page(page, args.max_chars, args.overlap)
    ]
    chunks_by_page: dict[str, list[dict]] = {}
    for chunk in chunks:
        chunks_by_page.setdefault(chunk["pageId"], []).append(chunk)

    source_characters = sum(len(page["text"]) for page in pages)
    covered_characters = sum(
        character_coverage(len(page["text"]), chunks_by_page.get(page["id"], []))
        for page in pages
    )
    orphan_page_ids = [page["id"] for page in pages if page["text"] and not chunks_by_page.get(page["id"])]

    source_groups: dict[str, list[dict]] = {}
    for page in pages:
        source_groups.setdefault(page["sourceId"], []).append(page)
    sources = []
    for source_id, source_pages in sorted(source_groups.items()):
        source_pages.sort(key=lambda page: page["pdfPage"])
        source_file = source_pages[0]["sourceFile"]
        sources.append(
            {
                "id": source_id,
                "file": source_file,
                "book": source_pages[0]["book"],
                "sha256": source_hash(args.source_root.resolve() / source_file),
                "indexedPageCount": len(source_pages),
                "firstPdfPage": source_pages[0]["pdfPage"],
                "lastPdfPage": source_pages[-1]["pdfPage"],
                "searchablePageCount": sum(bool(page["text"]) for page in source_pages),
                "blankPageCount": sum(not page["text"] for page in source_pages),
            }
        )

    wiki_nodes = build_wiki_nodes(taxonomy, chunks)
    chunk_ids = {chunk["id"] for chunk in chunks}
    unresolved_links = [
        evidence["chunkId"]
        for node in wiki_nodes
        for evidence in node["evidence"]
        if evidence["chunkId"] not in chunk_ids
    ]
    coverage = {
        "indexedPageCount": len(pages),
        "searchablePageCount": sum(bool(page["text"]) for page in pages),
        "blankPageCount": sum(not page["text"] for page in pages),
        "sourceCharacterCount": source_characters,
        "coveredCharacterCount": covered_characters,
        "characterCoverage": round(covered_characters / max(source_characters, 1), 8),
        "chunkCount": len(chunks),
        "orphanNonEmptyPageCount": len(orphan_page_ids),
        "orphanNonEmptyPageIds": orphan_page_ids,
        "wikiNodeCount": len(wiki_nodes),
        "unresolvedWikiLinkCount": len(unresolved_links),
    }
    if coverage["characterCoverage"] != 1 or orphan_page_ids or unresolved_links:
        raise ValueError(f"Knowledge coverage gate failed: {coverage}")

    output = {
        "schemaVersion": "2.0",
        "builtAt": datetime.now(UTC).isoformat(),
        "mode": "source-exact-chunks+evidence-wiki",
        "sourceIndexVersion": page_index["version"],
        "sourceIndexBuiltAt": page_index["builtAt"],
        "chunkPolicy": {"maxChars": args.max_chars, "overlap": args.overlap},
        "coverage": coverage,
        "sources": sources,
        "chunks": chunks,
        "wikiNodes": wiki_nodes,
    }
    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    public_manifest = {
        "schemaVersion": output["schemaVersion"],
        "builtAt": output["builtAt"],
        "mode": output["mode"],
        "coverage": output["coverage"],
        "sources": [
            {
                "id": source["id"],
                "book": source["book"],
                "indexedPageCount": source["indexedPageCount"],
                "searchablePageCount": source["searchablePageCount"],
                "blankPageCount": source["blankPageCount"],
            }
            for source in sources
        ],
        "wiki": {
            "nodeCount": len(wiki_nodes),
            "professionallyReviewedCount": sum(
                node["reviewStatus"] == "professionally-reviewed" for node in wiki_nodes
            ),
        },
    }
    manifest_path = args.manifest_output.resolve()
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(public_manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(json.dumps({"output": str(output_path), **coverage}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
