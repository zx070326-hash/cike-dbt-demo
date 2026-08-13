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

STRUCTURED_HEADING_PATTERNS = [
    re.compile(
        r"(?:通用|正念|情绪调节|人际效能|痛苦忍受)(?:讲义|练习单)\s*"
        r"[0-9一二三四五六七八九十]+(?:[a-zA-Z]|[一二]?[—－-][0-9a-zA-Z一二]+)?"
        r"(?:[：:]\s*[^\n。]{1,38})?"
    ),
    re.compile(r"第[一二三四五六七八九十百0-9]+章(?:chapter\s*[0-9]+)?\s*[^\n。]{0,30}", re.I),
]

NOISY_HEADING_MARKERS = ("一样", "搭配", "中，", "时，", "是指", "如果", "以及", "包括")


def stable_id(*parts: object) -> str:
    value = ":".join(str(part) for part in parts)
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]


def normalize(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", value.casefold())


def compact_line(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" \n\r\t·•—－-_:：，,。")


def valid_display_heading(value: str) -> bool:
    heading = compact_line(value)
    if not 3 <= len(heading) <= 58:
        return False
    if any(marker in heading for marker in NOISY_HEADING_MARKERS):
        return False
    if len(re.findall(r"[。！？；]", heading)) > 0:
        return False
    return bool(re.search(r"[\u4e00-\u9fffA-Za-z]", heading))


def derive_display_section(page: dict) -> tuple[str, str]:
    """Return a readable derived title without changing the OCR source text."""
    beginning = page["text"][:1200]
    candidates: list[str] = []
    for pattern in STRUCTURED_HEADING_PATTERNS:
        candidates.extend(compact_line(match.group(0)) for match in pattern.finditer(beginning))
    candidates = [candidate for candidate in candidates if valid_display_heading(candidate)]
    if candidates:
        # Prefer an explicit handout/worksheet heading. It is more useful to an
        # end user than a repeated chapter header from the top of the page.
        candidates.sort(key=lambda value: ("讲义" not in value and "练习单" not in value, len(value)))
        return candidates[0], "detected-structure"

    raw = compact_line(page.get("section", ""))
    if valid_display_heading(raw):
        return raw, "ocr-heading"

    source_label = "训练师手册" if page["sourceId"] == "dbt-manual-upper" else "技能讲义与练习"
    printed = page.get("printedPage")
    page_label = f"第 {printed} 页" if printed is not None else f"PDF 第 {page['pdfPage']} 页"
    return f"{source_label} · {page_label}", "generated-location-label"


def source_quality(page: dict, display_heading_source: str) -> dict:
    text = page["text"]
    issues: list[str] = []
    score = 1.0
    if page.get("printedPage") is None and page["pdfPage"] <= 20:
        issues.append("front-matter-or-contents")
        score -= 0.62
    if len(text) < 90:
        issues.append("short-source-page")
        score -= 0.3
    ocr_score = page.get("ocrScore")
    if isinstance(ocr_score, (int, float)) and ocr_score < 0.75:
        issues.append("low-ocr-confidence")
        score -= min(0.32, (0.75 - float(ocr_score)) * 1.6)
    if display_heading_source == "generated-location-label":
        issues.append("unreliable-ocr-heading")
        score -= 0.12
    text_single_line = re.sub(r"\s+", "", text)
    if len(re.findall(r"第[一二三四五六七八九十0-9]+章", text_single_line[:1000])) >= 3:
        issues.append("likely-contents-page")
        score -= 0.45
    score = round(max(0.0, min(score, 1.0)), 3)
    content_type = "trainer-note"
    if "练习单" in text[:500]:
        content_type = "worksheet"
    elif "讲义" in text[:500]:
        content_type = "handout"
    elif "front-matter-or-contents" in issues or "likely-contents-page" in issues:
        content_type = "front-matter"
    return {
        "score": score,
        "issues": issues,
        "contentType": content_type,
        "groundingEligible": score >= 0.48 and "front-matter-or-contents" not in issues and "likely-contents-page" not in issues,
    }


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
    display_section, display_heading_source = derive_display_section(page)
    quality = source_quality(page, display_heading_source)
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
                "displaySection": display_section,
                "displaySectionSource": display_heading_source,
                "pdfPage": page["pdfPage"],
                "printedPage": page["printedPage"],
                "charStart": start,
                "charEnd": end,
                "ordinal": ordinal,
                "text": text[start:end],
                "ocrScore": page.get("ocrScore"),
                "sourceQuality": quality,
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


def build_wiki_nodes(taxonomy: list[dict], skill_cards: list[dict], chunks: list[dict]) -> list[dict]:
    card_contracts = {item["id"]: item for item in skill_cards}
    nodes: list[dict] = []
    for item in taxonomy:
        contract = card_contracts.get(item["id"])
        if contract is None:
            raise ValueError(f"Missing skill-card contract: {item['id']}")
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
            quality = chunk["sourceQuality"]
            if not quality["groundingEligible"]:
                score *= 0.08
            else:
                score *= 0.72 + quality["score"] * 0.28
            if quality["contentType"] in {"handout", "worksheet"}:
                score += 2.5
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
                    "evidenceStatus": "candidate-unverified",
                }
            )
            seen_pages.add(page_key)
            if len(selected) >= 12:
                break
        evidence_ids = [evidence["chunkId"] for evidence in selected[:4]]
        claim = lambda text: {
            "text": text,
            "evidenceIds": evidence_ids,
            "verificationStatus": "candidate-unverified",
        }
        nodes.append(
            {
                **item,
                "reviewStatus": "source-linked-unreviewed",
                "contentAuthority": "navigation-only",
                "linkedChunkCount": len(scored),
                "evidence": selected,
                "definition": claim(contract["definition"]),
                "applicableWhen": claim(contract["applicableWhen"]),
                "notApplicableWhen": claim(contract["notApplicableWhen"]),
                "firstStep": claim(contract["firstStep"]),
                "retrievalHints": contract["retrievalHints"],
            }
        )
    return nodes


def node_matches_for_chunk(chunk: dict, nodes: list[dict]) -> list[str]:
    text = normalize(f"{chunk['displaySection']}\n{chunk['text']}")
    scored: list[tuple[int, str]] = []
    for node in nodes:
        aliases = [alias for alias in node["aliases"] if len(normalize(alias)) >= 3]
        matches = [alias for alias in aliases if normalize(alias) in text]
        if not matches:
            continue
        score = max(len(normalize(alias)) for alias in matches) + 3 * sum(
            normalize(alias) in normalize(chunk["displaySection"]) for alias in matches
        )
        scored.append((score, node["id"]))
    scored.sort(key=lambda value: (-value[0], value[1]))
    return [node_id for _, node_id in scored[:3]]


def build_parent_blocks(pages: list[dict], chunks: list[dict], nodes: list[dict]) -> list[dict]:
    """Build source-exact context windows; blocks only reference chunks."""
    chunks_by_page: dict[str, list[dict]] = {}
    for chunk in chunks:
        chunk["skillCardIds"] = node_matches_for_chunk(chunk, nodes)
        chunks_by_page.setdefault(chunk["pageId"], []).append(chunk)

    searchable_pages = [page for page in pages if page["text"]]
    pages_by_source: dict[str, list[dict]] = {}
    for page in searchable_pages:
        pages_by_source.setdefault(page["sourceId"], []).append(page)
    blocks: list[dict] = []
    for source_pages in pages_by_source.values():
        source_pages.sort(key=lambda page: page["pdfPage"])
        for index, page in enumerate(source_pages):
            center_chunks = chunks_by_page[page["id"]]
            center_cards = {card for chunk in center_chunks for card in chunk["skillCardIds"]}
            context_pages = [page]
            for neighbor_index in (index - 1, index + 1):
                if not 0 <= neighbor_index < len(source_pages):
                    continue
                neighbor = source_pages[neighbor_index]
                if abs(neighbor["pdfPage"] - page["pdfPage"]) != 1:
                    continue
                neighbor_chunks = chunks_by_page[neighbor["id"]]
                neighbor_cards = {card for chunk in neighbor_chunks for card in chunk["skillCardIds"]}
                same_display = center_chunks[0]["displaySection"] == neighbor_chunks[0]["displaySection"]
                if same_display or (center_cards and center_cards.intersection(neighbor_cards)):
                    context_pages.append(neighbor)
            context_pages.sort(key=lambda item: item["pdfPage"])
            context_chunks = [
                chunk
                for context_page in context_pages
                for chunk in chunks_by_page[context_page["id"]]
                if chunk["sourceQuality"]["groundingEligible"]
            ]
            block_id = stable_id("parent-v3", page["sourceId"], page["pdfPage"])
            for chunk in center_chunks:
                chunk["parentBlockId"] = block_id
            blocks.append(
                {
                    "id": block_id,
                    "sourceId": page["sourceId"],
                    "book": page["book"],
                    "title": center_chunks[0]["displaySection"],
                    "primaryPageId": page["id"],
                    "startPdfPage": min(item["pdfPage"] for item in context_pages),
                    "endPdfPage": max(item["pdfPage"] for item in context_pages),
                    "chunkIds": [chunk["id"] for chunk in context_chunks],
                    "skillCardIds": sorted(center_cards),
                    "sourceExact": True,
                }
            )
    return blocks


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--page-index", type=Path, default=Path("data/rag/index-v1.json"))
    parser.add_argument("--taxonomy", type=Path, default=Path("tools/knowledge/wiki_taxonomy.json"))
    parser.add_argument("--skill-cards", type=Path, default=Path("tools/knowledge/skill_cards.json"))
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
    skill_cards = json.loads(args.skill_cards.resolve().read_text(encoding="utf-8"))
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

    wiki_nodes = build_wiki_nodes(taxonomy, skill_cards, chunks)
    parent_blocks = build_parent_blocks(pages, chunks, wiki_nodes)
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
        "parentBlockCount": len(parent_blocks),
        "unresolvedWikiLinkCount": len(unresolved_links),
    }
    if coverage["characterCoverage"] != 1 or orphan_page_ids or unresolved_links:
        raise ValueError(f"Knowledge coverage gate failed: {coverage}")

    output = {
        # Keep the public schema discriminator backward compatible. The mode
        # and new optional fields advertise the quality-first V3 profile.
        "schemaVersion": "2.0",
        "builtAt": datetime.now(UTC).isoformat(),
        "mode": "source-exact-chunks+skill-cards+parent-context",
        "sourceIndexVersion": page_index["version"],
        "sourceIndexBuiltAt": page_index["builtAt"],
        "chunkPolicy": {"maxChars": args.max_chars, "overlap": args.overlap},
        "coverage": coverage,
        "sources": sources,
        "chunks": chunks,
        "wikiNodes": wiki_nodes,
        "parentBlocks": parent_blocks,
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
