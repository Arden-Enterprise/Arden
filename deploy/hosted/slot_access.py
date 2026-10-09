"""Read operator-owned slot assignments; writer leases do not grant account access."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def require_slot_owner(slot, caller_uid, allow_root=False):
    """Fail closed unless the caller owns the slot or is an explicitly allowed root operator."""
    assignments = ROOT / 'ops' / 'slot-owners.json'
    if assignments.is_symlink():
        raise ValueError('Invalid operator slot assignments.')
    metadata = assignments.stat()
    if metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise ValueError('Slot assignments must be root-owned and protected from other writers.')
    owner = json.loads(assignments.read_text())[slot]
    if not isinstance(owner, int) or isinstance(owner, bool) or owner <= 0:
        raise ValueError('Invalid slot owner.')
    if caller_uid != owner and not (allow_root and caller_uid == 0):
        raise ValueError('This SSH account is not assigned to the requested development slot.')
