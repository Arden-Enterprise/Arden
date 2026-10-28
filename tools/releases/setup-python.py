"""Disposable CI test environment; no pip cache or production package install."""
import os
from pathlib import Path
import subprocess
import sys

temporary = Path(os.environ["RUNNER_TEMP"])
if not temporary.is_absolute():
    raise ValueError("Expected the hosted runner's temporary directory")
directory = temporary / "arden-release-python"
subprocess.run([sys.executable, "-m", "venv", str(directory)], check=True)
python = directory / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "--no-cache-dir",
                "--only-binary=:all:", "-r", "deploy/release/requirements-ci.txt"], check=True)
with Path(os.environ["GITHUB_ENV"]).open("a", encoding="utf-8") as environment:
    environment.write("ARDEN_RELEASE_PYTHON=" + str(python) + "\n")
