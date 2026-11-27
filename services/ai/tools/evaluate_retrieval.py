"""Run with uv run python tools/evaluate_retrieval.py <sanitized-rankings.json>.

Does not call providers, open private corpora, or print queries/document content.
The checked-in fixture is a controlled example, not production relevance proof.
"""

import argparse
import json
from pathlib import Path

from arden_ai.domain.evaluation import evaluate_rankings, parse_cases


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rankings", type=Path)
    parser.add_argument("--k", type=int, default=5)
    arguments = parser.parse_args()
    if arguments.rankings.stat().st_size > 8_000_000:
        raise ValueError("evaluation file exceeds its input budget")
    cases = parse_cases(json.loads(arguments.rankings.read_text(encoding="utf-8")))
    print(json.dumps(evaluate_rankings(cases, arguments.k), indent=2))


if __name__ == "__main__":
    main()
