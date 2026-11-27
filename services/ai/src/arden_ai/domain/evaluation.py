"""Offline ranking metrics. Inputs are authorized, sanitized rank observations."""

from dataclasses import dataclass
from typing import Literal

from arden_ai.domain.hybrid import reciprocal_rank_fusion

RankingField = Literal["allowed", "relevant", "semantic", "lexical"]


@dataclass(frozen=True)
class RankingCase:
    name: str
    allowed: tuple[str, ...]
    relevant: tuple[str, ...]
    semantic: tuple[str, ...]
    lexical: tuple[str, ...]


def evaluate_rankings(cases: list[RankingCase], k: int = 5) -> dict[str, object]:
    if not cases or not 1 <= k <= 24:
        raise ValueError("provide nonempty evaluation cases and k between 1 and 24")
    names = [case.name for case in cases]
    if len(set(names)) != len(names):
        raise ValueError("duplicate evaluation case name")
    for case in cases:
        allowed = set(case.allowed)
        if not set([*case.relevant, *case.semantic, *case.lexical]).issubset(allowed):
            raise ValueError("evaluation observations exceed their authorized source set")
        for observation in (case.allowed, case.relevant, case.semantic, case.lexical):
            if len(set(observation)) != len(observation):
                raise ValueError("duplicate evaluation identities")
    modes: dict[str, object] = {}
    positive = [case for case in cases if case.relevant]
    empty = [case for case in cases if not case.relevant]
    for mode in ("semantic", "lexical", "hybrid"):
        recall = reciprocal = empty_success = 0.0
        for case in cases:
            ranking = (
                reciprocal_rank_fusion([case.semantic, case.lexical], k)
                if mode == "hybrid"
                else list(case.semantic if mode == "semantic" else case.lexical)[:k]
            )
            relevant = set(case.relevant)
            if relevant:
                recall += len(set(ranking) & relevant) / len(relevant)
                reciprocal += next(
                    (
                        1 / position
                        for position, identity in enumerate(ranking, 1)
                        if identity in relevant
                    ),
                    0.0,
                )
            elif not ranking:
                empty_success += 1
        modes[mode] = {
            f"recall@{k}": round(recall / len(positive), 6) if positive else None,
            f"mrr@{k}": round(reciprocal / len(positive), 6) if positive else None,
            "empty_case_accuracy": round(empty_success / len(empty), 6) if empty else None,
        }
    return {
        "cases": len(cases),
        "relevant_cases": len(positive),
        "empty_cases": len(empty),
        "scope_violations": 0,
        "rankings": modes,
    }


def parse_cases(value: object) -> list[RankingCase]:
    if not isinstance(value, list) or len(value) > 10_000:
        raise ValueError("evaluation input must be a bounded array")
    result = []
    fields: tuple[RankingField, ...] = ("allowed", "relevant", "semantic", "lexical")
    for row in value:
        if not isinstance(row, dict) or set(row) != {"name", *fields}:
            raise ValueError("invalid evaluation case fields")
        if not isinstance(row["name"], str) or not 1 <= len(row["name"]) <= 80:
            raise ValueError("invalid evaluation case name")
        rankings: dict[RankingField, tuple[str, ...]] = {}
        for key in fields:
            ranking = row[key]
            if (
                not isinstance(ranking, list)
                or len(ranking) > 10_000
                or any(
                    not isinstance(identity, str) or not 1 <= len(identity) <= 200
                    for identity in ranking
                )
            ):
                raise ValueError("invalid evaluation ranking")
            rankings[key] = tuple(ranking)
        result.append(RankingCase(name=row["name"], **rankings))
    return result
