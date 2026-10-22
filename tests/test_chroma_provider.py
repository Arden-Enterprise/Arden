from arden_ai.providers.chroma import _chroma_endpoint


def test_chroma_endpoint_accepts_private_http_and_https_hosts() -> None:
    assert _chroma_endpoint("http://chroma:8000") == ("chroma", 8000, False)
    assert _chroma_endpoint("https://chroma.internal") == ("chroma.internal", 443, True)


def test_chroma_endpoint_rejects_credentials_and_paths() -> None:
    for value in ["chroma:8000", "http://user:pass@chroma:8000", "http://chroma:8000/api"]:
        try:
            _chroma_endpoint(value)
        except ValueError:
            pass
        else:
            raise AssertionError(f"unsafe Chroma URL was accepted: {value}")

