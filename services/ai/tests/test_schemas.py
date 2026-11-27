import json
from pathlib import Path

from jsonschema import Draft202012Validator

from arden_ai.contracts.export_schemas import build_schemas


def test_checked_in_contract_schemas_are_current() -> None:
    schema_root = Path(__file__).resolve().parents[1] / "schemas"
    for name, expected in build_schemas().items():
        actual = json.loads((schema_root / name).read_text(encoding="utf-8"))
        assert actual == expected, f"{name} is stale; run uv run arden-ai-export-schemas"
        Draft202012Validator.check_schema(actual)

