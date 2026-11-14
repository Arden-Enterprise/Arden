# 0021 — Governed hybrid answering and applicable-version sources

Status: accepted scope, 12 November 2026. Implementation: local code/tests complete
on 13 November; review, live acceptance and release pending.
Decision owner: requesting maintainer; recorded by Codex. Source approval: explicit
request to implement combined permission hardening/Ask Arden with hybrid search,
and explicit confirmation to default to the currently applicable version.
Refines ADR 0012/0020; does not replace Core ownership or Target Readers authority.

Use staged retrieve → authorize exact evidence → generate → reauthorize all used
sources → persist/return. Chroma is derived storage; AI never gets business DB
credentials. Add lexical BM25 with deterministic RRF alongside dense retrieval,
both permission-filtered before ranking. Retain standalone LangChain packages;
the archived Python community package is not a new runtime dependency.

Core owns private conversation history and publication lineage. A future-effective
publication may be readable but is not today's default AI policy. The applicable
baseline remains citation-addressable under its own current reader selection;
newer effective-but-denied or expired releases do not revive an older source.
Pointer withdrawal revokes that chain. No retroactive guess of withdrawn history.
These are explicit refinements of current-pointer-only AI retrieval, not permission
for a general historical-reader bypass or mutable approved content.

Versioned contracts, bounds, failure behavior and requirement/evidence mapping
belong in [GA-v2](../engineering/governed-hybrid-answering.md). Changes require
paired tests, a forward-only operator migration/ownership rehearsal and separately
authorized release. Prior v1 clients need coordinated rollout; new Core never
falls back to v1 on authorization/availability failure.
