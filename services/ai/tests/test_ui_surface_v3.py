"""TDD tests for Arden-AI /v3/generations and OpenAI strict=True array UI surfaces (T-03)."""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from openai.lib._pydantic import to_strict_json_schema
from pydantic import BaseModel, SecretStr, ValidationError
from test_governed import GEN, ORG, REQUEST, SNAPSHOT, Generator, Search, generation

from arden_ai.application.governed import GovernedAnswerer
from arden_ai.application.governed_v3 import GovernedV3Answerer, RawGenerationV3Result
from arden_ai.contracts.export_schemas import build_schemas
from arden_ai.contracts.governed_v3 import (
    PROTOTYPE_DENYLIST,
    AiSurfaceDraft,
    GenerationV3Request,
    GenerationV3Response,
    SourceCatalogEntry,
)
from arden_ai.domain.ui_surface import SurfaceValidationError, validate_ai_surface_draft
from arden_ai.infrastructure import answering
from arden_ai.infrastructure.answering import OpenAIGroundedAnswerGenerator, _GovernedV3Output
from arden_ai.infrastructure.hybrid import HybridRetriever
from arden_ai.infrastructure.settings import Settings
from arden_ai.presentation.api import create_api

TEXT_1 = "MFA is required for all production accounts."
TEXT_2 = "Hardware security keys are required for org admins."
HASH_1 = hashlib.sha256(TEXT_1.encode("utf-8")).hexdigest()
HASH_2 = hashlib.sha256(TEXT_2.encode("utf-8")).hexdigest()
CHUNK_1 = "a" * 64
CHUNK_2 = "c" * 64


def catalog_entries(
    *, with_collection: bool = True, has_links: bool = True
) -> list[dict[str, Any]]:
    return [
        {
            "docRef": "D1",
            "title": "Security Policy",
            "type": "Policy & Standard",
            "ownerDepartment": "Security",
            "version": "1.0",
            "readerScope": "ORGANIZATION",
            "hasDirectRelationships": has_links,
            "departmentRef": "DEPT1",
            "collectionRef": "C1" if with_collection else None,
        },
        {
            "docRef": "D2",
            "title": "Admin Access Procedure",
            "type": "Procedure",
            "ownerDepartment": "Platform",
            "version": "2.1",
            "readerScope": "DEPARTMENT",
            "hasDirectRelationships": False,
            "departmentRef": "DEPT2",
            "collectionRef": None,
        },
    ]


def v3_request(**changes: object) -> GenerationV3Request:
    base: dict[str, Any] = {
        "contractVersion": 3,
        "purpose": "PUBLISHED_CHAT",
        "requestId": str(REQUEST),
        "organizationId": str(ORG),
        "query": "What are the MFA rules?",
        "history": [],
        "evidence": [
            {
                "generationId": str(GEN),
                "snapshotVersionId": str(SNAPSHOT),
                "snapshotContentHash": "b" * 64,
                "chunkId": CHUNK_1,
                "contentHash": HASH_1,
                "content": TEXT_1,
                "startOffset": 0,
                "endOffset": len(TEXT_1),
                "sourceBlockIds": ["pdf-page-2"],
                "parentSectionBlockId": "security",
                "label": "Security Policy · Version 1.0",
            },
            {
                "generationId": str(GEN),
                "snapshotVersionId": str(SNAPSHOT),
                "snapshotContentHash": "b" * 64,
                "chunkId": CHUNK_2,
                "contentHash": HASH_2,
                "content": TEXT_2,
                "startOffset": 100,
                "endOffset": 100 + len(TEXT_2),
                "sourceBlockIds": ["pdf-page-3"],
                "parentSectionBlockId": "admin",
                "label": "Admin Access Procedure · Version 2.1",
            },
        ],
        "sourceCatalog": catalog_entries(),
        "uiSurfaceMode": "AUTO",
    }
    base.update(changes)
    return GenerationV3Request.model_validate(base)


def valid_minimal_surface() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "rootId": "root",
        "nodes": [
            {"id": "root", "kind": "stack", "gap": "md", "childIds": ["p1", "d1"]},
            {
                "id": "p1",
                "kind": "prose",
                "markdown": "MFA is required [1].",
                "citationIndexes": [1],
            },
            {"id": "d1", "kind": "document_item", "docRef": "D1"},
        ],
    }


def _lint_openai_strict_schema(schema: dict[str, Any]) -> tuple[int, int]:
    """Lint a JSON Schema against OpenAI strict=True constraints.

    Returns (max_object_nesting_depth, total_property_count).
    """
    Draft202012Validator.check_schema(schema)
    defs = schema.get("$defs", {})

    # 1. Structural global checks across the entire schema tree
    def walk_raw(node: Any, path: str) -> None:
        if isinstance(node, list):
            for idx, item in enumerate(node):
                walk_raw(item, f"{path}[{idx}]")
            return
        if not isinstance(node, dict):
            return
        assert "oneOf" not in node, f"oneOf forbidden at {path}"
        assert "patternProperties" not in node, f"patternProperties forbidden at {path}"
        if node.get("type") == "object" or "properties" in node:
            assert node.get("additionalProperties") is False, (
                f"additionalProperties must be False at {path}"
            )
            props = node.get("properties", {})
            assert isinstance(props, dict)
            required = node.get("required", [])
            assert set(required) == set(props.keys()), (
                f"all properties must be required at {path}: missing={set(props) - set(required)}"
            )
        if "additionalProperties" in node:
            assert node["additionalProperties"] is False, (
                f"dynamic dict additionalProperties forbidden at {path}"
            )
        for key, value in node.items():
            walk_raw(value, f"{path}.{key}")

    walk_raw(schema, "$")

    # 2. Measure max object nesting depth (resolving $refs, root object = depth 1)
    def resolve(node: dict[str, Any]) -> dict[str, Any]:
        if "$ref" in node:
            ref = node["$ref"]
            assert isinstance(ref, str) and ref.startswith("#/$defs/"), f"unexpected $ref {ref}"
            name = ref.split("/", 2)[2]
            return defs[name]
        return node

    def max_object_depth(node: Any, seen_refs: frozenset[str] = frozenset()) -> int:
        if not isinstance(node, dict):
            return 0
        if "$ref" in node:
            ref = node["$ref"]
            assert ref not in seen_refs, f"recursive schema $ref cycle forbidden: {ref}"
            return max_object_depth(resolve(node), seen_refs | {ref})
        child_depths: list[int] = []
        if "properties" in node:
            for prop_schema in node["properties"].values():
                child_depths.append(max_object_depth(prop_schema, seen_refs))
        if "items" in node:
            child_depths.append(max_object_depth(node["items"], seen_refs))
        if "anyOf" in node:
            for variant in node["anyOf"]:
                child_depths.append(max_object_depth(variant, seen_refs))
        if "allOf" in node:
            for variant in node["allOf"]:
                child_depths.append(max_object_depth(variant, seen_refs))
        nested = max(child_depths, default=0)
        is_object = node.get("type") == "object" or "properties" in node
        return (1 + nested) if is_object else nested

    # 3. Count total object properties across root + all $defs objects
    total_props = len(schema.get("properties", {}))
    for def_schema in defs.values():
        if isinstance(def_schema, dict) and "properties" in def_schema:
            total_props += len(def_schema["properties"])

    return max_object_depth(schema), total_props


# ---------------------------------------------------------------------------
# 1. OpenAI strict=True Structured Output Schema Linter
# ---------------------------------------------------------------------------


def test_governed_v3_llm_schema_satisfies_openai_strict_mode_constraints() -> None:
    raw_schema = _GovernedV3Output.model_json_schema()
    strict_schema = to_strict_json_schema(_GovernedV3Output)

    for label, candidate in [("pydantic", raw_schema), ("openai-strict", strict_schema)]:
        depth, prop_count = _lint_openai_strict_schema(candidate)
        assert depth <= 5, f"{label} schema object depth {depth} exceeds OpenAI ceiling 5"
        assert prop_count <= 100, f"{label} schema property count {prop_count} exceeds 100"

    # Verify LangChain ChatOpenAI accepts the schema with method="json_schema", strict=True
    model = ChatOpenAI(
        model="gpt-6-luna",
        api_key=SecretStr("test-only"),
        use_responses_api=True,
        store=False,
    )
    runnable = model.with_structured_output(
        answering._GOVERNED_V3_PROVIDER_SCHEMA, method="json_schema", strict=True, include_raw=True
    )
    assert runnable is not None


# ---------------------------------------------------------------------------
# 2. Wire Contract & Exported Schema Parity
# ---------------------------------------------------------------------------


def test_answer_v3_schema_is_exported_and_has_no_dynamic_dicts_or_one_of() -> None:
    schemas = build_schemas()
    assert "answer-v3.schema.json" in schemas
    assert "answer-v2.schema.json" in schemas
    v3_schema = schemas["answer-v3.schema.json"]
    Draft202012Validator.check_schema(v3_schema)

    def assert_no_dynamic_dict_or_one_of(node: Any, path: str = "$") -> None:
        if isinstance(node, list):
            for idx, item in enumerate(node):
                assert_no_dynamic_dict_or_one_of(item, f"{path}[{idx}]")
            return
        if not isinstance(node, dict):
            return
        assert "oneOf" not in node, f"oneOf found at {path}"
        assert "patternProperties" not in node, f"patternProperties found at {path}"
        if "additionalProperties" in node:
            assert node["additionalProperties"] is False, f"dynamic dict at {path}"
        for key, value in node.items():
            assert_no_dynamic_dict_or_one_of(value, f"{path}.{key}")

    assert_no_dynamic_dict_or_one_of(v3_schema)


def test_shared_v3_golden_fixture_matches_models_and_exported_schema() -> None:
    fixture = json.loads(
        (Path(__file__).parent / "fixtures/governed-v3.json").read_text(encoding="utf-8")
    )
    req_model = GenerationV3Request.model_validate(fixture["generationV3Request"])
    resp_model = GenerationV3Response.model_validate(fixture["generationV3Response"])
    assert req_model.request_id == resp_model.request_id
    assert resp_model.ui_surface is not None
    validate_ai_surface_draft(
        resp_model.ui_surface,
        catalog=req_model.source_catalog,
        citation_count=len(resp_model.citations),
    )

    v3_schema = build_schemas()["answer-v3.schema.json"]
    Draft202012Validator({"$ref": "#/$defs/GenerationV3Request", **v3_schema}).validate(
        fixture["generationV3Request"]
    )
    Draft202012Validator({"$ref": "#/$defs/GenerationV3Response", **v3_schema}).validate(
        fixture["generationV3Response"]
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"contractVersion": 2},
        {"purpose": "READER_QUESTION"},
        {"uiSurfaceMode": "FORCE"},
        {"sourceCatalog": []},
        {"sourceCatalog": [catalog_entries()[0], catalog_entries()[0]]},
        {
            "sourceCatalog": [
                {**catalog_entries()[0], "docRef": "10000000-0000-4000-8000-000000000002"}
            ]
        },
        {
            "sourceCatalog": [
                {**catalog_entries()[0], "departmentRef": "10000000-0000-4000-8000-000000000002"}
            ]
        },
        {
            "sourceCatalog": [
                {**catalog_entries()[0], "collectionRef": "10000000-0000-4000-8000-000000000002"}
            ]
        },
        {"unknownField": True},
    ],
)
def test_v3_request_rejects_invalid_version_purpose_raw_uuids_and_extra_fields(
    changes: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        v3_request(**changes)


# ---------------------------------------------------------------------------
# 3. Domain Surface Validator (F13-UI-AC1 / F13-UI-AC2)
# ---------------------------------------------------------------------------


def _catalog_models(*, with_collection: bool = True) -> list[SourceCatalogEntry]:
    return [
        SourceCatalogEntry.model_validate(item)
        for item in catalog_entries(with_collection=with_collection)
    ]


def test_validator_accepts_depth_4_nested_tree_and_all_v1_primitives() -> None:
    # stack(0) -> tabs(1) -> split(2) -> card(3) -> governance_kv(4) + action footer(4)
    draft = AiSurfaceDraft.model_validate(
        {
            "schemaVersion": 1,
            "rootId": "root",
            "nodes": [
                {
                    "id": "root",
                    "kind": "stack",
                    "gap": "md",
                    "childIds": [
                        "tabs_1",
                        "sec_1",
                        "row_1",
                        "table_1",
                        "callout_1",
                        "callout_2",
                        "metrics_1",
                        "lineage_1",
                    ],
                },
                {
                    "id": "tabs_1",
                    "kind": "tabs",
                    "defaultTabId": "t1",
                    "tabs": [
                        {"id": "t1", "label": "Overview", "childIds": ["split_1"]},
                        {"id": "t2", "label": "Details", "childIds": ["prose_1"]},
                    ],
                },
                {
                    "id": "split_1",
                    "kind": "split",
                    "leftTitle": "Policy",
                    "leftId": "card_left",
                    "rightTitle": "Procedure",
                    "rightId": "card_right",
                },
                {
                    "id": "card_left",
                    "kind": "card",
                    "title": "Security Policy",
                    "tone": "default",
                    "bodyIds": ["gov_1"],
                    "footerIds": ["act_focus", "act_filter", "act_open", "act_handoff"],
                },
                {
                    "id": "gov_1",
                    "kind": "governance_kv",
                    "docRef": "D1",
                    "fields": [
                        "ownerDepartment",
                        "version",
                        "validityStatus",
                        "openMaintenanceCaseCount",
                    ],
                },
                {
                    "id": "act_focus",
                    "kind": "graph_action",
                    "label": "Focus docs",
                    "action": {"op": "focus_nodes", "docRefs": ["D1", "D2"]},
                },
                {
                    "id": "act_filter",
                    "kind": "graph_action",
                    "label": "Filter Security",
                    "action": {
                        "op": "apply_filter",
                        "departmentRef": "DEPT1",
                        "typeCode": "POLICY_AND_STANDARD",
                        "collectionRef": "C1",
                        "readerScope": "ORGANIZATION",
                        "validity": "CURRENT",
                    },
                },
                {
                    "id": "act_open",
                    "kind": "open_reader",
                    "label": "Open policy",
                    "docRef": "D1",
                    "blockId": "pdf-page-2",
                    "page": 2,
                },
                {
                    "id": "act_handoff",
                    "kind": "workflow_handoff",
                    "label": "Report issue",
                    "handoff": "report_issue",
                    "docRef": "D1",
                },
                {
                    "id": "card_right",
                    "kind": "card",
                    "title": "Admin Access",
                    "tone": "subtle",
                    "bodyIds": ["doc_2"],
                    "footerIds": ["act_isolate", "act_links", "act_pin", "act_prompt"],
                },
                {
                    "id": "doc_2",
                    "kind": "document_item",
                    "docRef": "D2",
                    "highlightNote": "Applies to org admins.",
                },
                {
                    "id": "act_isolate",
                    "kind": "graph_action",
                    "label": "Isolate collection",
                    "action": {
                        "op": "isolate_branch",
                        "branchKind": "collection",
                        "branchRef": "C1",
                    },
                },
                {
                    "id": "act_links",
                    "kind": "graph_action",
                    "label": "Show links",
                    "action": {
                        "op": "toggle_links",
                        "enabled": True,
                        "relationshipTypes": ["REFERENCES", "SUPERSEDES"],
                    },
                },
                {
                    "id": "act_pin",
                    "kind": "graph_action",
                    "label": "Pin to context",
                    "action": {"op": "pin_to_context", "docRefs": ["D1"]},
                },
                {
                    "id": "act_prompt",
                    "kind": "prompt_chip",
                    "label": "Check exceptions",
                    "prompt": "Are there MFA exceptions for contractors?",
                },
                {
                    "id": "prose_1",
                    "kind": "prose",
                    "markdown": "Production accounts require MFA [1] and admins need keys [2].",
                    "citationIndexes": [1, 2],
                },
                {
                    "id": "sec_1",
                    "kind": "section",
                    "title": "Additional notes",
                    "defaultOpen": False,
                    "childIds": ["doc_1"],
                },
                {
                    "id": "doc_1",
                    "kind": "document_item",
                    "docRef": "D1",
                },
                {
                    "id": "row_1",
                    "kind": "row",
                    "columns": 2,
                    "childIds": ["prose_a", "prose_b"],
                },
                {"id": "prose_a", "kind": "prose", "markdown": "Standard users [1]."},
                {"id": "prose_b", "kind": "prose", "markdown": "Org admins [2]."},
                {
                    "id": "table_1",
                    "kind": "comparison_table",
                    "caption": "MFA by role",
                    "columns": ["Role", "Requirement"],
                    "rows": [
                        {
                            "cells": [
                                {"text": "Production users"},
                                {"text": "MFA required", "citationIndexes": [1]},
                            ]
                        },
                        {
                            "cells": [
                                {"text": "Org admins"},
                                {"text": "Hardware key required", "citationIndexes": [2]},
                            ]
                        },
                    ],
                },
                {
                    "id": "callout_1",
                    "kind": "callout",
                    "tone": "info",
                    "title": "Scope",
                    "body": "Applies across production accounts.",
                    "citationIndexes": [1],
                },
                {
                    "id": "callout_2",
                    "kind": "callout",
                    "tone": "conflict",
                    "title": "Stricter admin rule",
                    "body": "Org admins require hardware keys beyond standard MFA.",
                    "citationIndexes": [1, 2],
                },
                {
                    "id": "metrics_1",
                    "kind": "metric_strip",
                    "metricKeys": ["MATCHED_DOCS", "DISTINCT_OWNER_DEPTS"],
                },
                {
                    "id": "lineage_1",
                    "kind": "lineage_tree",
                    "docRef": "D1",
                },
            ],
        }
    )
    validate_ai_surface_draft(draft, catalog=_catalog_models(), citation_count=2)


def test_validator_enforces_exact_max_nodes_32_and_max_depth_4() -> None:
    # 32 nodes exact: root stack + 3 child stacks + 28 prose leaves = 32
    nodes_32: list[dict[str, Any]] = [
        {"id": "root", "kind": "stack", "childIds": ["s1", "s2", "s3"]},
        {"id": "s1", "kind": "stack", "childIds": [f"p{i}" for i in range(1, 11)]},
        {"id": "s2", "kind": "stack", "childIds": [f"p{i}" for i in range(11, 21)]},
        {"id": "s3", "kind": "stack", "childIds": [f"p{i}" for i in range(21, 29)]},
    ] + [{"id": f"p{i}", "kind": "prose", "markdown": f"Item {i} [1]."} for i in range(1, 29)]
    assert len(nodes_32) == 32
    validate_ai_surface_draft(
        AiSurfaceDraft.model_validate({"schemaVersion": 1, "rootId": "root", "nodes": nodes_32}),
        catalog=_catalog_models(),
        citation_count=1,
    )

    # 33 nodes must fail
    nodes_33 = list(nodes_32)
    nodes_33[3] = {"id": "s3", "kind": "stack", "childIds": [f"p{i}" for i in range(21, 30)]}
    nodes_33.append({"id": "p29", "kind": "prose", "markdown": "Item 29 [1]."})
    assert len(nodes_33) == 33
    with pytest.raises((ValidationError, SurfaceValidationError)):
        draft = AiSurfaceDraft.model_validate(
            {"schemaVersion": 1, "rootId": "root", "nodes": nodes_33}
        )
        validate_ai_surface_draft(draft, catalog=_catalog_models(), citation_count=1)

    # Depth 5 must fail: stack(0) -> tabs(1) -> split(2) -> card(3) -> stack(4) -> prose(5)
    depth_5 = AiSurfaceDraft.model_validate(
        {
            "schemaVersion": 1,
            "rootId": "n0",
            "nodes": [
                {"id": "n0", "kind": "stack", "childIds": ["n1"]},
                {
                    "id": "n1",
                    "kind": "tabs",
                    "defaultTabId": "a",
                    "tabs": [
                        {"id": "a", "label": "A", "childIds": ["n2"]},
                        {"id": "b", "label": "B", "childIds": ["b_leaf"]},
                    ],
                },
                {"id": "b_leaf", "kind": "prose", "markdown": "Ok [1]."},
                {"id": "n2", "kind": "split", "leftId": "n3", "rightId": "r_leaf"},
                {"id": "r_leaf", "kind": "prose", "markdown": "Right [1]."},
                {"id": "n3", "kind": "card", "bodyIds": ["n4"]},
                {"id": "n4", "kind": "stack", "childIds": ["n5"]},
                {"id": "n5", "kind": "prose", "markdown": "Too deep [1]."},
            ],
        }
    )
    with pytest.raises(SurfaceValidationError, match="depth"):
        validate_ai_surface_draft(depth_5, catalog=_catalog_models(), citation_count=1)


@pytest.mark.parametrize(
    "case_name,surface_dict",
    [
        (
            "non_stack_or_card_root",
            {
                "schemaVersion": 1,
                "rootId": "p1",
                "nodes": [{"id": "p1", "kind": "prose", "markdown": "Hello [1]."}],
            },
        ),
        (
            "cycle",
            {
                "schemaVersion": 1,
                "rootId": "a",
                "nodes": [
                    {"id": "a", "kind": "stack", "childIds": ["b"]},
                    {"id": "b", "kind": "stack", "childIds": ["a"]},
                ],
            },
        ),
        (
            "dag_diamond_reuse",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["s1", "s2"]},
                    {"id": "s1", "kind": "stack", "childIds": ["shared"]},
                    {"id": "s2", "kind": "stack", "childIds": ["shared"]},
                    {"id": "shared", "kind": "prose", "markdown": "Shared [1]."},
                ],
            },
        ),
        (
            "orphan_node",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["p1"]},
                    {"id": "p1", "kind": "prose", "markdown": "Used [1]."},
                    {"id": "orphan", "kind": "prose", "markdown": "Orphan [1]."},
                ],
            },
        ),
        (
            "duplicate_node_id",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["p1"]},
                    {"id": "p1", "kind": "prose", "markdown": "One [1]."},
                    {"id": "p1", "kind": "prose", "markdown": "Two [1]."},
                ],
            },
        ),
        (
            "card_stack_card_ancestor_ban",
            {
                "schemaVersion": 1,
                "rootId": "c1",
                "nodes": [
                    {"id": "c1", "kind": "card", "bodyIds": ["s1"]},
                    {"id": "s1", "kind": "stack", "childIds": ["c2"]},
                    {"id": "c2", "kind": "card", "bodyIds": ["p1"]},
                    {"id": "p1", "kind": "prose", "markdown": "Nested card [1]."},
                ],
            },
        ),
        (
            "section_stack_section_ancestor_ban",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["sec1"]},
                    {"id": "sec1", "kind": "section", "title": "Outer", "childIds": ["s1"]},
                    {"id": "s1", "kind": "stack", "childIds": ["sec2"]},
                    {"id": "sec2", "kind": "section", "title": "Inner", "childIds": ["p1"]},
                    {"id": "p1", "kind": "prose", "markdown": "Nested section [1]."},
                ],
            },
        ),
        (
            "tabs_stack_tabs_ancestor_ban",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["t1"]},
                    {
                        "id": "t1",
                        "kind": "tabs",
                        "defaultTabId": "a",
                        "tabs": [
                            {"id": "a", "label": "A", "childIds": ["s1"]},
                            {"id": "b", "label": "B", "childIds": ["p2"]},
                        ],
                    },
                    {"id": "s1", "kind": "stack", "childIds": ["t2"]},
                    {
                        "id": "t2",
                        "kind": "tabs",
                        "defaultTabId": "x",
                        "tabs": [
                            {"id": "x", "label": "X", "childIds": ["p1"]},
                            {"id": "y", "label": "Y", "childIds": ["p3"]},
                        ],
                    },
                    {"id": "p1", "kind": "prose", "markdown": "One [1]."},
                    {"id": "p2", "kind": "prose", "markdown": "Two [1]."},
                    {"id": "p3", "kind": "prose", "markdown": "Three [1]."},
                ],
            },
        ),
        (
            "section_card_tabs_ancestor_ban",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["sec1"]},
                    {"id": "sec1", "kind": "section", "title": "Sec", "childIds": ["c1"]},
                    {"id": "c1", "kind": "card", "bodyIds": ["t1"]},
                    {
                        "id": "t1",
                        "kind": "tabs",
                        "defaultTabId": "a",
                        "tabs": [
                            {"id": "a", "label": "A", "childIds": ["p1"]},
                            {"id": "b", "label": "B", "childIds": ["p2"]},
                        ],
                    },
                    {"id": "p1", "kind": "prose", "markdown": "A [1]."},
                    {"id": "p2", "kind": "prose", "markdown": "B [1]."},
                ],
            },
        ),
        (
            "split_stack_split_ancestor_ban",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["sp1"]},
                    {"id": "sp1", "kind": "split", "leftId": "s1", "rightId": "p2"},
                    {"id": "s1", "kind": "stack", "childIds": ["sp2"]},
                    {"id": "sp2", "kind": "split", "leftId": "p1", "rightId": "p3"},
                    {"id": "p1", "kind": "prose", "markdown": "A [1]."},
                    {"id": "p2", "kind": "prose", "markdown": "B [1]."},
                    {"id": "p3", "kind": "prose", "markdown": "C [1]."},
                ],
            },
        ),
        (
            "row_card_comparison_table_ancestor_ban",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["r1"]},
                    {"id": "r1", "kind": "row", "columns": 2, "childIds": ["c1"]},
                    {"id": "c1", "kind": "card", "bodyIds": ["tbl"]},
                    {
                        "id": "tbl",
                        "kind": "comparison_table",
                        "columns": ["A", "B"],
                        "rows": [
                            {"cells": [{"text": "1"}, {"text": "2", "citationIndexes": [1]}]}
                        ],
                    },
                ],
            },
        ),
        (
            "split_card_comparison_table_ancestor_ban",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["sp1"]},
                    {"id": "sp1", "kind": "split", "leftId": "c1", "rightId": "p1"},
                    {"id": "c1", "kind": "card", "bodyIds": ["tbl"]},
                    {"id": "p1", "kind": "prose", "markdown": "Right [1]."},
                    {
                        "id": "tbl",
                        "kind": "comparison_table",
                        "columns": ["A", "B"],
                        "rows": [
                            {"cells": [{"text": "1"}, {"text": "2", "citationIndexes": [1]}]}
                        ],
                    },
                ],
            },
        ),
        (
            "row_stack_row_ancestor_ban",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["r1"]},
                    {"id": "r1", "kind": "row", "columns": 2, "childIds": ["s1"]},
                    {"id": "s1", "kind": "stack", "childIds": ["r2"]},
                    {"id": "r2", "kind": "row", "columns": 2, "childIds": ["p1"]},
                    {"id": "p1", "kind": "prose", "markdown": "Nested row [1]."},
                ],
            },
        ),
        (
            "non_action_in_card_footer",
            {
                "schemaVersion": 1,
                "rootId": "c1",
                "nodes": [
                    {"id": "c1", "kind": "card", "bodyIds": ["p1"], "footerIds": ["p2"]},
                    {"id": "p1", "kind": "prose", "markdown": "Body [1]."},
                    {"id": "p2", "kind": "prose", "markdown": "Not an action [1]."},
                ],
            },
        ),
        (
            "uncited_comparison_table_row",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["tbl"]},
                    {
                        "id": "tbl",
                        "kind": "comparison_table",
                        "columns": ["Role", "Rule"],
                        "rows": [
                            {"cells": [{"text": "Users"}, {"text": "MFA", "citationIndexes": [1]}]},
                            {"cells": [{"text": "Guests"}, {"text": "No citation here"}]},
                        ],
                    },
                ],
            },
        ),
        (
            "jagged_comparison_table",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["tbl"]},
                    {
                        "id": "tbl",
                        "kind": "comparison_table",
                        "columns": ["A", "B", "C"],
                        "rows": [
                            {"cells": [{"text": "1"}, {"text": "2", "citationIndexes": [1]}]}
                        ],
                    },
                ],
            },
        ),
        (
            "unknown_doc_ref",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["d3"]},
                    {"id": "d3", "kind": "document_item", "docRef": "D3"},
                ],
            },
        ),
        (
            "unknown_department_ref",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["a1"]},
                    {
                        "id": "a1",
                        "kind": "graph_action",
                        "label": "Filter unknown",
                        "action": {"op": "apply_filter", "departmentRef": "DEPT9"},
                    },
                ],
            },
        ),
        (
            "unknown_collection_ref",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["a1"]},
                    {
                        "id": "a1",
                        "kind": "graph_action",
                        "label": "Isolate unknown",
                        "action": {
                            "op": "isolate_branch",
                            "branchKind": "collection",
                            "branchRef": "C9",
                        },
                    },
                ],
            },
        ),
        (
            "out_of_range_citation_index",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["p1"]},
                    {"id": "p1", "kind": "prose", "markdown": "Text [3].", "citationIndexes": [3]},
                ],
            },
        ),
        (
            "inline_out_of_range_prose_citation",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["p1"]},
                    {"id": "p1", "kind": "prose", "markdown": "Unsupported claim [9]."},
                ],
            },
        ),
        (
            "row_stack_split_ancestor_ban",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["r1"]},
                    {"id": "r1", "kind": "row", "columns": 2, "childIds": ["s1"]},
                    {"id": "s1", "kind": "stack", "childIds": ["sp1"]},
                    {"id": "sp1", "kind": "split", "leftId": "p1", "rightId": "p2"},
                    {"id": "p1", "kind": "prose", "markdown": "A [1]."},
                    {"id": "p2", "kind": "prose", "markdown": "B [1]."},
                ],
            },
        ),
        (
            "row_card_tabs_ancestor_ban",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["r1"]},
                    {"id": "r1", "kind": "row", "columns": 2, "childIds": ["c1"]},
                    {"id": "c1", "kind": "card", "bodyIds": ["t1"]},
                    {
                        "id": "t1",
                        "kind": "tabs",
                        "defaultTabId": "a",
                        "tabs": [
                            {"id": "a", "label": "A", "childIds": ["p1"]},
                            {"id": "b", "label": "B", "childIds": ["p2"]},
                        ],
                    },
                    {"id": "p1", "kind": "prose", "markdown": "A [1]."},
                    {"id": "p2", "kind": "prose", "markdown": "B [1]."},
                ],
            },
        ),
        (
            "split_card_tabs_ancestor_ban",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["sp1"]},
                    {"id": "sp1", "kind": "split", "leftId": "c1", "rightId": "p0"},
                    {"id": "p0", "kind": "prose", "markdown": "Right [1]."},
                    {"id": "c1", "kind": "card", "bodyIds": ["t1"]},
                    {
                        "id": "t1",
                        "kind": "tabs",
                        "defaultTabId": "a",
                        "tabs": [
                            {"id": "a", "label": "A", "childIds": ["p1"]},
                            {"id": "b", "label": "B", "childIds": ["p2"]},
                        ],
                    },
                    {"id": "p1", "kind": "prose", "markdown": "A [1]."},
                    {"id": "p2", "kind": "prose", "markdown": "B [1]."},
                ],
            },
        ),
        (
            "invalid_isolate_branch_type_code",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["a1"]},
                    {
                        "id": "a1",
                        "kind": "graph_action",
                        "label": "Isolate bad type",
                        "action": {
                            "op": "isolate_branch",
                            "branchKind": "type",
                            "branchRef": "NOT_A_TYPE_CODE",
                        },
                    },
                ],
            },
        ),
        (
            "empty_apply_filter",
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["a1"]},
                    {
                        "id": "a1",
                        "kind": "graph_action",
                        "label": "Empty filter",
                        "action": {"op": "apply_filter"},
                    },
                ],
            },
        ),
    ],
)
def test_validator_rejects_adversarial_surface_cases(
    case_name: str, surface_dict: dict[str, Any]
) -> None:
    with pytest.raises((ValidationError, SurfaceValidationError)):
        draft = AiSurfaceDraft.model_validate(surface_dict)
        validate_ai_surface_draft(draft, catalog=_catalog_models(), citation_count=2)


@pytest.mark.parametrize("bad_tone", ["warning", "gap"])
def test_callout_rejects_core_reserved_tones_warning_and_gap(bad_tone: str) -> None:
    with pytest.raises((ValidationError, SurfaceValidationError)):
        draft = AiSurfaceDraft.model_validate(
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["c1"]},
                    {
                        "id": "c1",
                        "kind": "callout",
                        "tone": bad_tone,
                        "title": "Spoofed banner",
                        "body": "Must be rejected.",
                        "citationIndexes": [1],
                    },
                ],
            }
        )
        validate_ai_surface_draft(draft, catalog=_catalog_models(), citation_count=1)


@pytest.mark.parametrize("proto_key", sorted(PROTOTYPE_DENYLIST))
def test_prototype_pollution_keys_are_rejected_as_node_and_tab_ids(proto_key: str) -> None:
    with pytest.raises((ValidationError, SurfaceValidationError)):
        draft = AiSurfaceDraft.model_validate(
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": [proto_key]},
                    {"id": proto_key, "kind": "prose", "markdown": "Exploit [1]."},
                ],
            }
        )
        validate_ai_surface_draft(draft, catalog=_catalog_models(), citation_count=1)

    with pytest.raises((ValidationError, SurfaceValidationError)):
        draft = AiSurfaceDraft.model_validate(
            {
                "schemaVersion": 1,
                "rootId": "root",
                "nodes": [
                    {"id": "root", "kind": "stack", "childIds": ["t1"]},
                    {
                        "id": "t1",
                        "kind": "tabs",
                        "defaultTabId": proto_key,
                        "tabs": [
                            {"id": proto_key, "label": "Bad", "childIds": ["p1"]},
                            {"id": "ok", "label": "Ok", "childIds": ["p2"]},
                        ],
                    },
                    {"id": "p1", "kind": "prose", "markdown": "A [1]."},
                    {"id": "p2", "kind": "prose", "markdown": "B [1]."},
                ],
            }
        )
        validate_ai_surface_draft(draft, catalog=_catalog_models(), citation_count=1)


def test_validator_rejects_surface_exceeding_48000_compact_bytes() -> None:
    # 5 prose nodes of 11_000 chars each = > 55_000 bytes (> 48_000 ceiling)
    nodes = [{"id": "root", "kind": "stack", "childIds": [f"p{i}" for i in range(5)]}] + [
        {"id": f"p{i}", "kind": "prose", "markdown": "x" * 11_000} for i in range(5)
    ]
    draft = AiSurfaceDraft.model_validate({"schemaVersion": 1, "rootId": "root", "nodes": nodes})
    with pytest.raises(SurfaceValidationError, match="48"):
        validate_ai_surface_draft(draft, catalog=_catalog_models(), citation_count=1)


# ---------------------------------------------------------------------------
# 4. Application Orchestrator & Non-502 Surface Fallback
# ---------------------------------------------------------------------------


@dataclass
class FakeV3Generator:
    raw_surface: object | None = field(default_factory=valid_minimal_surface)
    insufficient: bool = False
    surface_parse_failed: bool = False
    quote_failures: int = 0
    network_error: bool = False
    calls: list[GenerationV3Request] = field(default_factory=list)

    async def generate_grounded_v3(self, request: GenerationV3Request) -> RawGenerationV3Result:
        self.calls.append(request)
        if self.network_error:
            raise ConnectionError("upstream unreachable")
        quote = "not in evidence" if len(self.calls) <= self.quote_failures else TEXT_1
        return RawGenerationV3Result(
            request_id=request.request_id,
            status="INSUFFICIENT_EVIDENCE" if self.insufficient else "ANSWERED",
            answer="Not enough evidence." if self.insufficient else "MFA is required [1].",
            citations=[] if self.insufficient else [{"chunkId": CHUNK_1, "quote": quote}],
            used_evidence=[chunk.chunk_id for chunk in request.evidence],
            raw_ui_surface=self.raw_surface,
            surface_parse_failed=self.surface_parse_failed,
        )


def test_orchestrator_returns_generated_surface_and_recovers_verbatim_quote() -> None:
    gen = FakeV3Generator()
    result = asyncio.run(GovernedV3Answerer(gen).generate_v3(v3_request()))
    assert result.contract_version == 3
    assert result.status == "ANSWERED"
    assert result.ui_surface_status == "GENERATED"
    assert result.ui_surface is not None and result.ui_surface.root_id == "root"
    assert result.citations[0].quote == TEXT_1
    assert len(gen.calls) == 1


def test_orchestrator_strips_invalid_surface_to_omitted_invalid_without_retry_or_error() -> None:
    bad_surface = {
        "schemaVersion": 1,
        "rootId": "root",
        "nodes": [
            {"id": "root", "kind": "stack", "childIds": ["c1"]},
            {
                "id": "c1",
                "kind": "callout",
                "tone": "warning",
                "title": "Illegal warning",
                "body": "Must be stripped.",
                "citationIndexes": [1],
            },
        ],
    }
    gen = FakeV3Generator(raw_surface=bad_surface)
    result = asyncio.run(GovernedV3Answerer(gen).generate_v3(v3_request()))
    assert result.status == "ANSWERED"
    assert result.answer == "MFA is required [1]."
    assert result.citations[0].quote == TEXT_1
    assert result.ui_surface is None
    assert result.ui_surface_status == "OMITTED_INVALID"
    # Invalid surface must NOT trigger a full LLM retry
    assert len(gen.calls) == 1


def test_orchestrator_always_omits_surface_on_insufficient_evidence() -> None:
    gen = FakeV3Generator(insufficient=True, raw_surface=valid_minimal_surface())
    result = asyncio.run(GovernedV3Answerer(gen).generate_v3(v3_request()))
    assert result.status == "INSUFFICIENT_EVIDENCE"
    assert result.citations == []
    assert result.ui_surface is None
    assert result.ui_surface_status == "OMITTED_INSUFFICIENT"


def test_orchestrator_always_disables_surface_when_mode_is_disabled() -> None:
    gen = FakeV3Generator(raw_surface=valid_minimal_surface())
    result = asyncio.run(
        GovernedV3Answerer(gen).generate_v3(v3_request(uiSurfaceMode="DISABLED"))
    )
    assert result.status == "ANSWERED"
    assert result.ui_surface is None
    assert result.ui_surface_status == "DISABLED"


def test_orchestrator_repairs_invalid_quote_once_and_does_not_retry_network_errors() -> None:
    repair_gen = FakeV3Generator(quote_failures=1)
    result = asyncio.run(GovernedV3Answerer(repair_gen).generate_v3(v3_request()))
    assert result.ui_surface_status == "GENERATED"
    assert len(repair_gen.calls) == 2

    broken_gen = FakeV3Generator(network_error=True)
    with pytest.raises(ConnectionError):
        asyncio.run(GovernedV3Answerer(broken_gen).generate_v3(v3_request()))
    assert len(broken_gen.calls) == 1


# ---------------------------------------------------------------------------
# 5. OpenAI Provider Adapter (Zero Raw UUIDs, Strict Mode, Translation)
# ---------------------------------------------------------------------------


def test_openai_v3_provider_uses_strict_schema_zero_uuids_and_translates_nodes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    class FakeModel:
        def __init__(self, **kwargs: Any) -> None:
            captured["init"] = kwargs

        def with_structured_output(
            self, schema: type[BaseModel] | dict[str, Any], **kwargs: Any
        ) -> Any:
            captured["schema"] = schema
            captured["structured_kwargs"] = kwargs

            class Runnable:
                async def ainvoke(self, messages: list[Any]) -> Any:
                    captured["messages"] = messages
                    if isinstance(schema, dict):
                        null_node = {
                            "child_ids": None,
                            "body_ids": None,
                            "footer_ids": None,
                            "left_id": None,
                            "right_id": None,
                            "left_title": None,
                            "right_title": None,
                            "gap": None,
                            "row_columns": None,
                            "title": None,
                            "subtitle": None,
                            "tone": None,
                            "default_open": None,
                            "default_tab_id": None,
                            "tabs": None,
                            "markdown": None,
                            "body": None,
                            "caption": None,
                            "table_columns": None,
                            "table_rows": None,
                            "doc_ref": None,
                            "highlight_note": None,
                            "fields": None,
                            "metric_keys": None,
                            "citation_indexes": None,
                            "label": None,
                            "prompt": None,
                            "block_id": None,
                            "page": None,
                            "handoff": None,
                            "graph_op": None,
                            "doc_refs": None,
                            "department_ref": None,
                            "collection_ref": None,
                            "type_code": None,
                            "reader_scope": None,
                            "validity": None,
                            "branch_kind": None,
                            "branch_ref": None,
                            "enabled": None,
                            "relationship_types": None,
                        }
                        return {"raw": AIMessage(content=json.dumps(
                            {
                                "status": "ANSWERED",
                                "answer": "MFA is required for production accounts [1].",
                                "citations": [{"evidence_id": "E1", "quote": TEXT_1}],
                                "ui_surface": {
                                    "root_id": "root",
                                    "nodes": [
                                        {
                                            **null_node,
                                            "id": "root",
                                            "kind": "stack",
                                            "gap": "md",
                                            "child_ids": ["p1", "tbl1", "act1"],
                                        },
                                        {
                                            **null_node,
                                            "id": "p1",
                                            "kind": "prose",
                                            "markdown": "MFA is required [1].",
                                            "citation_indexes": [1],
                                        },
                                        {
                                            **null_node,
                                            "id": "tbl1",
                                            "kind": "comparison_table",
                                            "caption": "Rules",
                                            "table_columns": ["Account", "Requirement"],
                                            "table_rows": [
                                                [
                                                    {
                                                        "text": "Production",
                                                        "citation_indexes": None,
                                                    },
                                                    {
                                                        "text": "MFA required",
                                                        "citation_indexes": [1],
                                                    },
                                                ]
                                            ],
                                        },
                                        {
                                            **null_node,
                                            "id": "act1",
                                            "kind": "graph_action",
                                            "label": "Focus policy",
                                            "graph_op": "focus_nodes",
                                            "doc_refs": ["D1"],
                                        },
                                    ],
                                },
                            }
                        ))}
                    return schema.model_validate(
                        {
                            "status": "ANSWERED",
                            "answer": "MFA is required for production accounts [1].",
                            "citations": [{"evidence_id": "E1", "quote": TEXT_1}],
                        }
                    )

            return Runnable()

    monkeypatch.setattr(answering, "ChatOpenAI", FakeModel)
    provider = OpenAIGroundedAnswerGenerator(
        Settings(openai_api_key=SecretStr("test-only"), _env_file=None)
    )
    req = v3_request()
    result = asyncio.run(GovernedV3Answerer(provider).generate_v3(req))

    assert captured["structured_kwargs"] == {
        "method": "json_schema", "strict": True, "include_raw": True
    }
    assert captured["schema"] == _GovernedV3Output.model_json_schema()
    assert captured["init"]["store"] is False
    assert captured["init"]["use_responses_api"] is True
    assert isinstance(captured["messages"][0], SystemMessage)
    assert isinstance(captured["messages"][1], HumanMessage)
    human_payload = json.loads(captured["messages"][1].content)
    assert human_payload["evidence"][0]["id"] == "E1"
    assert human_payload["sourceCatalog"][0]["docRef"] == "D1"
    # Zero raw UUIDs or chunk hashes leaked to LLM prompt
    raw_human = captured["messages"][1].content
    for secret_id in [str(ORG), str(GEN), str(SNAPSHOT), str(REQUEST), CHUNK_1, CHUNK_2]:
        assert secret_id not in raw_human

    assert result.ui_surface_status == "GENERATED"
    assert result.ui_surface is not None
    assert len(result.ui_surface.nodes) == 4

    # When uiSurfaceMode == DISABLED, provider uses lean schema (not _GovernedV3Output)
    disabled_result = asyncio.run(
        GovernedV3Answerer(provider).generate_v3(v3_request(uiSurfaceMode="DISABLED"))
    )
    assert captured["schema"] is answering._GovernedOutput
    assert disabled_result.ui_surface is None
    assert disabled_result.ui_surface_status == "DISABLED"


@pytest.mark.parametrize("node_kind", ["prose", "bad_kind"])
def test_openai_v3_provider_downgrades_malformed_llm_surface_without_failing_answer(
    monkeypatch: pytest.MonkeyPatch, node_kind: str,
) -> None:
    calls: list[dict[str, Any]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/responses"
        calls.append(json.loads(request.content))
        null_node = {
            name: None for name in answering._LlmSurfaceNode.model_fields
            if name not in ("id", "kind")
        }
        # Pydantic rejects an unknown kind. Translation rejects prose without markdown.
        generated = {
            "status": "ANSWERED",
            "answer": "MFA is required for production accounts [1].",
            "citations": [{"evidence_id": "E1", "quote": TEXT_1}],
            "ui_surface": {
                "root_id": "root",
                "nodes": [
                    {**null_node, "id": "root", "kind": "stack", "child_ids": ["p"]},
                    {**null_node, "id": "p", "kind": node_kind},
                ],
            },
        }
        return httpx.Response(200, json={
            "id": "resp_test",
            "object": "response",
            "created_at": 0,
            "model": "test-model",
            "status": "completed",
            "error": None,
            "usage": None,
            "output": [{
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [{
                    "type": "output_text",
                    "text": json.dumps(generated),
                    "annotations": [],
                }],
            }],
        })

    async def generate() -> GenerationV3Response:
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            monkeypatch.setattr(
                answering, "ChatOpenAI",
                lambda **kwargs: ChatOpenAI(http_async_client=client, **kwargs),
            )
            provider = OpenAIGroundedAnswerGenerator(
                Settings(openai_api_key=SecretStr("test-only"), _env_file=None)
            )
            return await GovernedV3Answerer(provider).generate_v3(v3_request())

    result = asyncio.run(generate())
    assert result.status == "ANSWERED"
    assert result.answer == "MFA is required for production accounts [1]."
    assert result.citations[0].quote == TEXT_1
    assert result.ui_surface is None
    assert result.ui_surface_status == "OMITTED_INVALID"
    assert len(calls) == 1
    schema = calls[0]["text"]["format"]
    assert schema["type"] == "json_schema"
    assert schema["strict"] is True
    assert "ui_surface" in schema["schema"]["required"]


def test_v3_response_model_enforces_status_surface_invariants() -> None:
    base_answered: dict[str, Any] = {
        "contractVersion": 3,
        "requestId": str(REQUEST),
        "status": "ANSWERED",
        "answer": "MFA is required.",
        "citations": [{"chunkId": CHUNK_1, "quote": TEXT_1}],
        "usedEvidence": [CHUNK_1],
        "uiSurface": valid_minimal_surface(),
        "uiSurfaceStatus": "GENERATED",
    }
    assert GenerationV3Response.model_validate(base_answered).ui_surface_status == "GENERATED"

    for invalid_patch in [
        {"uiSurface": None, "uiSurfaceStatus": "GENERATED"},
        {"uiSurface": valid_minimal_surface(), "uiSurfaceStatus": "OMITTED_INVALID"},
        {"uiSurface": None, "uiSurfaceStatus": "OMITTED_INSUFFICIENT"},
        {
            "status": "INSUFFICIENT_EVIDENCE",
            "citations": [],
            "uiSurface": valid_minimal_surface(),
            "uiSurfaceStatus": "GENERATED",
        },
        {
            "status": "INSUFFICIENT_EVIDENCE",
            "citations": [],
            "uiSurface": None,
            "uiSurfaceStatus": "OMITTED_INVALID",
        },
    ]:
        with pytest.raises(ValidationError):
            GenerationV3Response.model_validate({**base_answered, **invalid_patch})


def test_llm_surface_translator_covers_all_17_node_kinds_and_5_graph_ops() -> None:
    null_node = {
        field_name: None
        for field_name in answering._LlmSurfaceNode.model_fields
        if field_name not in ("id", "kind")
    }

    def mk(node_id: str, kind: str, **fields: Any) -> dict[str, Any]:
        return {**null_node, "id": node_id, "kind": kind, **fields}

    llm_draft = answering._LlmSurfaceDraft.model_validate(
        {
            "root_id": "root",
            "nodes": [
                mk(
                    "root",
                    "stack",
                    gap="sm",
                    child_ids=[
                        "row1",
                        "card1",
                        "sec1",
                        "tabs1",
                        "split1",
                        "tbl1",
                        "call1",
                        "met1",
                        "lin1",
                    ],
                ),
                mk("row1", "row", row_columns=2, child_ids=["p1", "doc1"]),
                mk("p1", "prose", markdown="MFA [1].", citation_indexes=[1]),
                mk("doc1", "document_item", doc_ref="D1", highlight_note="Key rule"),
                mk(
                    "card1",
                    "card",
                    title="Policy",
                    subtitle="Sub",
                    tone="subtle",
                    body_ids=["gov1"],
                    footer_ids=["g1", "g2", "g3", "g4"],
                ),
                mk("gov1", "governance_kv", doc_ref="D1", fields=["ownerDepartment", "version"]),
                mk("g1", "graph_action", label="Focus", graph_op="focus_nodes", doc_refs=["D1"]),
                mk(
                    "g2",
                    "graph_action",
                    label="Filter",
                    graph_op="apply_filter",
                    department_ref="DEPT1",
                    type_code="POLICY_AND_STANDARD",
                    collection_ref="C1",
                    reader_scope="ORGANIZATION",
                    validity="CURRENT",
                ),
                mk(
                    "g3",
                    "graph_action",
                    label="Isolate",
                    graph_op="isolate_branch",
                    branch_kind="department",
                    branch_ref="DEPT1",
                ),
                mk(
                    "g4",
                    "graph_action",
                    label="Links",
                    graph_op="toggle_links",
                    enabled=True,
                    relationship_types=["REFERENCES"],
                ),
                mk("sec1", "section", title="More", default_open=True, child_ids=["g5", "or1"]),
                mk("g5", "graph_action", label="Pin", graph_op="pin_to_context", doc_refs=["D2"]),
                mk("or1", "open_reader", label="Open", doc_ref="D1", block_id="b1", page=3),
                mk(
                    "tabs1",
                    "tabs",
                    default_tab_id="a",
                    tabs=[
                        {"id": "a", "label": "A", "child_ids": ["wh1"]},
                        {"id": "b", "label": "B", "child_ids": ["pc1"]},
                    ],
                ),
                mk(
                    "wh1",
                    "workflow_handoff",
                    label="Renew",
                    handoff="open_renewal",
                    doc_ref="D1",
                ),
                mk("pc1", "prompt_chip", label="Ask", prompt="What are exceptions?"),
                mk(
                    "split1",
                    "split",
                    left_title="L",
                    left_id="p2",
                    right_title="R",
                    right_id="p3",
                ),
                mk("p2", "prose", markdown="Left [1]."),
                mk("p3", "prose", markdown="Right [2]."),
                mk(
                    "tbl1",
                    "comparison_table",
                    caption="Compare",
                    table_columns=["Col1", "Col2"],
                    table_rows=[
                        [
                            {"text": "A", "citation_indexes": None},
                            {"text": "B", "citation_indexes": [1]},
                        ]
                    ],
                ),
                mk(
                    "call1",
                    "callout",
                    tone="conflict",
                    title="Conflict",
                    body="Differs for admins.",
                    citation_indexes=[1, 2],
                ),
                mk("met1", "metric_strip", metric_keys=["MATCHED_DOCS"]),
                mk("lin1", "lineage_tree", doc_ref="D1"),
            ],
        }
    )
    translated = answering._translate_llm_surface(llm_draft)
    draft = AiSurfaceDraft.model_validate(translated)
    validate_ai_surface_draft(draft, catalog=_catalog_models(), citation_count=2)
    assert len(draft.nodes) == 23


# ---------------------------------------------------------------------------
# 6. HTTP Presentation Route (/v3/generations) & /v2 Non-Regression
# ---------------------------------------------------------------------------


def test_v3_http_auth_success_non_502_fallback_and_v2_untouched(
    caplog: pytest.LogCaptureFixture,
) -> None:
    v2_gen = Generator()
    v3_gen = FakeV3Generator()
    app = create_api(
        service_token=SecretStr("test-only"),
        governed=GovernedAnswerer(HybridRetriever(Search()), v2_gen),
        governed_v3=GovernedV3Answerer(v3_gen),
    )
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-only"}
    payload = v3_request().model_dump(mode="json", by_alias=True)

    # Auth required
    assert client.post("/v3/generations", json=payload).status_code == 401
    # Invalid payload -> 422
    assert (
        client.post("/v3/generations", headers=headers, json={**payload, "contractVersion": 2})
        .status_code
        == 422
    )
    # Valid v3 generation -> 200 GENERATED
    ok = client.post("/v3/generations", headers=headers, json=payload)
    assert ok.status_code == 200
    body = ok.json()
    assert body["contractVersion"] == 3
    assert body["uiSurfaceStatus"] == "GENERATED"
    assert body["uiSurface"]["schemaVersion"] == 1
    assert isinstance(body["uiSurface"]["nodes"], list)

    # Invalid surface -> HTTP 200 OMITTED_INVALID (NEVER 502)
    v3_gen.raw_surface = {
        "schemaVersion": 1,
        "rootId": "root",
        "nodes": [{"id": "root", "kind": "prose", "markdown": "Wrong root [1]."}],
    }
    degraded = client.post("/v3/generations", headers=headers, json=payload)
    assert degraded.status_code == 200
    assert degraded.json()["uiSurface"] is None
    assert degraded.json()["uiSurfaceStatus"] == "OMITTED_INVALID"
    assert degraded.json()["answer"] == "MFA is required [1]."

    # Disabled mode -> HTTP 200 DISABLED
    v3_gen.raw_surface = valid_minimal_surface()
    disabled = client.post(
        "/v3/generations", headers=headers, json={**payload, "uiSurfaceMode": "DISABLED"}
    )
    assert disabled.status_code == 200
    assert disabled.json()["uiSurface"] is None
    assert disabled.json()["uiSurfaceStatus"] == "DISABLED"

    # Insufficient evidence -> HTTP 200 OMITTED_INSUFFICIENT
    v3_gen.insufficient = True
    insuff = client.post("/v3/generations", headers=headers, json=payload)
    assert insuff.status_code == 200
    assert insuff.json()["status"] == "INSUFFICIENT_EVIDENCE"
    assert insuff.json()["uiSurface"] is None
    assert insuff.json()["uiSurfaceStatus"] == "OMITTED_INSUFFICIENT"

    # Provider transport failure -> HTTP 502 with zero private detail leaks
    v3_gen.insufficient = False
    v3_gen.network_error = True
    failed = client.post("/v3/generations", headers=headers, json=payload)
    assert failed.status_code == 502
    assert "upstream unreachable" not in failed.text + caplog.text
    assert TEXT_1 not in failed.text + caplog.text

    # Existing /v2/generations stays 100% intact
    v2_resp = client.post(
        "/v2/generations",
        headers=headers,
        json=generation().model_dump(mode="json", by_alias=True),
    )
    assert v2_resp.status_code == 200
    assert v2_resp.json()["contractVersion"] == 2
    assert "uiSurface" not in v2_resp.json()
