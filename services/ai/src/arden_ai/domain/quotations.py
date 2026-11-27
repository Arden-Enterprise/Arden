"""Recover a literal source span without fuzzy wording or cross-source lookup."""

import re


def recover_source_quote(quote: str, source: str) -> str:
    """Prefer a unique exact span; otherwise align whitespace only, uniquely.

    Offsets refer to original Python codepoints, including Unicode and PDF layout
    spacing. The returned value is always sliced from this exact source. Never
    normalize the canonical text, alter punctuation/case, or join disjoint spans.
    """
    needle = " ".join(quote.split())
    if not needle:
        raise ValueError("citation is not a unique exact source quotation")

    literal = source.find(quote)
    if literal >= 0:
        if source.find(quote, literal + 1) >= 0:
            raise ValueError("citation is not a unique exact source quotation")
        return source[literal : literal + len(quote)]

    characters: list[str] = []
    offsets: list[int] = []
    for word in re.finditer(r"\S+", source):
        if characters:
            characters.append(" ")
            offsets.append(word.start() - 1)
        characters.extend(word.group())
        offsets.extend(range(word.start(), word.end()))
    normalized = "".join(characters)
    start = normalized.find(needle)
    if start < 0 or normalized.find(needle, start + 1) >= 0:
        raise ValueError("citation is not a unique exact source quotation")
    # needle is stripped, so neither endpoint can be a collapsed separator.
    return source[offsets[start] : offsets[start + len(needle) - 1] + 1]
