from fastapi.testclient import TestClient

from arden_ai.main import app


def test_health_endpoints() -> None:
    client = TestClient(app)
    assert client.get("/health/live").json() == {"status": "ok"}
    assert client.get("/health/ready").json() == {"status": "ready", "version": "0.1.0"}

