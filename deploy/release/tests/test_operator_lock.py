import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from receiver import ReleaseEngine
from state import release_lock
from test_receiver import MemoryManager


@unittest.skipUnless(os.name == "posix", "Operator lock contract requires Linux")
class OperatorLockTests(unittest.TestCase):
    def test_idempotent_cutover_check_uses_the_existing_host_lock(self):
        import bootstrap_operator as operator
        import receiver
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config_root = root / "config"
            config_root.mkdir()
            state_root = root / "state"
            manager = MemoryManager()
            config = {"state_dir": str(state_root / "staging"), "staging_dir": str(state_root / "staging")}
            ReleaseEngine("staging", config["state_dir"], manager).status()
            (config_root / "staging.json").write_text(json.dumps(config))
            bounded_lock = lambda parent: release_lock(parent, timeout=0.05)
            with patch.object(operator, "CONFIG", config_root), patch.object(operator, "STATE", state_root), \
                    patch.object(operator, "CoolifyManager", lambda config: manager), \
                    patch.object(operator, "retire_original", lambda *args: None), \
                    patch.object(receiver, "release_lock", bounded_lock):
                with release_lock(state_root):
                    operator.cutover("staging", {"phase": "cutover_verified"})


if __name__ == "__main__":
    unittest.main()
