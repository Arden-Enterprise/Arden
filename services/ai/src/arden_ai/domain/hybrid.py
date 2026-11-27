"""Deterministic, dependency-free BM25 and reciprocal rank fusion.

Inputs must already be restricted to the caller's authorized source set. Ranking
never grants access. No corpus cache or cross-request document state lives here.
"""

import math
import re
import unicodedata
from collections import Counter
from collections.abc import Sequence


def lexical_tokens(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", text).casefold()
    words = re.findall(r"[^\W_]+(?:[-./][^\W_]+)*", normalized)
    # Preserve exact document codes and also allow individual code components.
    return words + [
        part for word in words if re.search(r"[-./]", word) for part in re.split(r"[-./]", word)
    ]


def bm25_rank(query: str, documents: Sequence[tuple[str, str]], limit: int) -> list[str]:
    if not documents or limit <= 0:
        return []
    terms = set(lexical_tokens(query))
    counts = [Counter(lexical_tokens(text)) for _, text in documents]
    lengths = [sum(tokens.values()) for tokens in counts]
    average = sum(lengths) / len(lengths) or 1.0
    frequencies = {term: sum(term in tokens for tokens in counts) for term in terms}
    scores = []
    for (identity, _), tokens, length in zip(documents, counts, lengths, strict=True):
        score = 0.0
        for term in terms:
            frequency = tokens[term]
            if not frequency:
                continue
            inverse = math.log(
                1 + (len(documents) - frequencies[term] + 0.5) / (frequencies[term] + 0.5)
            )
            score += (
                inverse * frequency * 2.5 / (frequency + 1.5 * (0.25 + 0.75 * length / average))
            )
        if score > 0:
            scores.append((identity, score))
    return [
        identity for identity, _ in sorted(scores, key=lambda item: (-item[1], item[0]))[:limit]
    ]


def reciprocal_rank_fusion(rankings: Sequence[Sequence[str]], limit: int) -> list[str]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for position, identity in enumerate(dict.fromkeys(ranking), 1):
            scores[identity] = scores.get(identity, 0.0) + 1.0 / (60 + position)
    return sorted(scores, key=lambda identity: (-scores[identity], identity))[:limit]
