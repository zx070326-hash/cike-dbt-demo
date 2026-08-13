"""Fail-closed validation for the generated V2 knowledge package."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--page-index", type=Path, default=Path("data/rag/index-v1.json"))
    parser.add_argument("--knowledge", type=Path, default=Path("data/knowledge/knowledge-v2.json"))
    args = parser.parse_args()

    page_index = json.loads(args.page_index.resolve().read_text(encoding="utf-8"))
    knowledge = json.loads(args.knowledge.resolve().read_text(encoding="utf-8"))
    pages = {page["id"]: page for page in page_index["pages"]}
    chunks = knowledge["chunks"]
    chunk_ids = {chunk["id"] for chunk in chunks}
    if len(chunk_ids) != len(chunks):
        raise AssertionError("duplicate chunk id")

    chunks_by_page: dict[str, list[dict]] = {}
    for chunk in chunks:
        page = pages.get(chunk["pageId"])
        if page is None:
            raise AssertionError(f"unknown page: {chunk['pageId']}")
        if chunk["text"] != page["text"][chunk["charStart"] : chunk["charEnd"]]:
            raise AssertionError(f"chunk is not a source-exact slice: {chunk['id']}")
        chunks_by_page.setdefault(chunk["pageId"], []).append(chunk)

    covered = 0
    source_characters = 0
    for page_id, page in pages.items():
        text = page["text"]
        source_characters += len(text)
        if not text:
            continue
        ranges = sorted((chunk["charStart"], chunk["charEnd"]) for chunk in chunks_by_page.get(page_id, []))
        cursor = 0
        for start, end in ranges:
            if start > cursor:
                raise AssertionError(f"uncovered character range on {page_id}: {cursor}-{start}")
            cursor = max(cursor, end)
        if cursor != len(text):
            raise AssertionError(f"uncovered page tail on {page_id}: {cursor}-{len(text)}")
        covered += len(text)

    unresolved = [
        evidence["chunkId"]
        for node in knowledge["wikiNodes"]
        for evidence in node["evidence"]
        if evidence["chunkId"] not in chunk_ids
    ]
    if unresolved:
        raise AssertionError(f"unresolved wiki evidence links: {unresolved[:5]}")
    required_claims = ("definition", "applicableWhen", "notApplicableWhen", "firstStep")
    for node in knowledge["wikiNodes"]:
        if node.get("contentAuthority") != "navigation-only" and node.get("reviewStatus") != "professionally-reviewed":
            raise AssertionError(f"unreviewed skill card has authoritative content: {node['id']}")
        for claim_name in required_claims:
            claim = node.get(claim_name)
            if not isinstance(claim, dict) or "text" not in claim or "evidenceIds" not in claim:
                raise AssertionError(f"incomplete skill-card claim {node['id']}:{claim_name}")
            unknown_claim_evidence = [chunk_id for chunk_id in claim["evidenceIds"] if chunk_id not in chunk_ids]
            if unknown_claim_evidence:
                raise AssertionError(f"unknown claim evidence {node['id']}:{claim_name}: {unknown_claim_evidence[:3]}")

    parent_ids = set()
    for block in knowledge.get("parentBlocks", []):
        if block["id"] in parent_ids:
            raise AssertionError(f"duplicate parent block: {block['id']}")
        parent_ids.add(block["id"])
        unknown_parent_chunks = [chunk_id for chunk_id in block["chunkIds"] if chunk_id not in chunk_ids]
        if unknown_parent_chunks:
            raise AssertionError(f"unknown parent block chunks: {block['id']}: {unknown_parent_chunks[:3]}")
        if not block.get("sourceExact"):
            raise AssertionError(f"parent block is not source exact: {block['id']}")
    for chunk in chunks:
        if chunk.get("parentBlockId") not in parent_ids:
            raise AssertionError(f"chunk missing parent block: {chunk['id']}")
        if chunk.get("displaySection") is None or chunk.get("sourceQuality") is None:
            raise AssertionError(f"chunk missing V3 derived metadata: {chunk['id']}")
    coverage = knowledge["coverage"]
    assert coverage["indexedPageCount"] == len(pages)
    assert coverage["sourceCharacterCount"] == source_characters
    assert coverage["coveredCharacterCount"] == covered
    assert coverage["characterCoverage"] == 1
    assert coverage["orphanNonEmptyPageCount"] == 0
    assert coverage["unresolvedWikiLinkCount"] == 0
    assert coverage["parentBlockCount"] == len(parent_ids)
    print(json.dumps({"status": "PASS", **coverage}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
