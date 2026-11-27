import json
from pathlib import Path

import pytest

from arden_ai.domain.evaluation import evaluate_rankings, parse_cases


def test_controlled_complementary_rankings_and_empty_cases() -> None:
    cases = parse_cases(
        json.loads(
            (Path(__file__).parent / "fixtures/retrieval-rankings.synthetic.json").read_text()
        )
    )
    result = evaluate_rankings(cases)
    assert result["cases"] == 10 and result["scope_violations"] == 0
    assert result["rankings"]["hybrid"]["recall@5"] == 1.0
    assert result["rankings"]["semantic"]["recall@5"] < 1.0
    assert result["rankings"]["lexical"]["recall@5"] < 1.0


def test_evaluation_cannot_hide_scope_leakage_by_filtering_it_out() -> None:
    with pytest.raises(ValueError, match="authorized"):
        evaluate_rankings(
            parse_cases(
                [
                    {
                        "name": "leak",
                        "allowed": ["own"],
                        "relevant": ["own"],
                        "semantic": ["foreign"],
                        "lexical": [],
                    }
                ]
            )
        )


def test_evaluation_rejects_duplicate_cases_and_malformed_inputs() -> None:
    with pytest.raises(ValueError):
        parse_cases([{"name": "raw", "query": "Do not store private questions here"}])
    row = {"name": "case", "allowed": [], "relevant": [], "semantic": [], "lexical": []}
    with pytest.raises(ValueError, match="duplicate"):
        evaluate_rankings(parse_cases([row, row]))
