"""Local management request, executed inside Coolify's network namespace only."""

import json
from pathlib import Path
import sys
from urllib import request as http

sys.path.insert(0, str(Path(__file__).resolve().parent))
from management import NoRedirect
from protocol import strict_json


def main():
    data = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
    if len(data) > 4 * 1024 * 1024:
        raise ValueError("Management request exceeds limit")
    message = strict_json(data)
    if (message.get("base") != "http://127.0.0.1:8080/api/v1"
            or not isinstance(message.get("path"), str)
            or not message["path"].startswith("/")
            or message.get("method") not in {"GET", "POST", "PATCH"}):
        raise ValueError("Unexpected management request")
    token = Path("/etc/arden/releases/management.token").read_text().strip()
    data = None if message.get("body") is None else json.dumps(message["body"]).encode()
    request = http.Request(message["base"] + message["path"], data=data, method=message["method"],
                           headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with http.build_opener(NoRedirect).open(request, timeout=30) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            raise ValueError("Management response exceeds limit")
        print(json.dumps({"ok": True, "result": strict_json(raw)}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"ok":false,"error":"management_request_failed"}')
        sys.exit(1)
