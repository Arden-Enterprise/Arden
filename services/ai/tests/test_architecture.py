import ast
from pathlib import Path


def test_layer_dependencies_point_inward() -> None:
    package_root = Path(__file__).resolve().parents[1] / "src" / "arden_ai"
    forbidden = {
        "domain": ("arden_ai.application", "arden_ai.infrastructure", "arden_ai.presentation"),
        "application": ("arden_ai.infrastructure", "arden_ai.presentation"),
        "contracts": ("arden_ai.application", "arden_ai.infrastructure", "arden_ai.presentation"),
        "presentation": ("arden_ai.infrastructure",),
    }

    violations: list[str] = []
    for layer, prefixes in forbidden.items():
        for source in (package_root / layer).rglob("*.py"):
            tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
            imports = [
                node.module
                for node in ast.walk(tree)
                if isinstance(node, ast.ImportFrom) and node.module is not None
            ]
            imports.extend(
                alias.name
                for node in ast.walk(tree)
                if isinstance(node, ast.Import)
                for alias in node.names
            )
            for imported in imports:
                if imported.startswith(prefixes):
                    violations.append(f"{source.relative_to(package_root)} imports {imported}")

    assert not violations, "Layer dependency violations:\n" + "\n".join(violations)
