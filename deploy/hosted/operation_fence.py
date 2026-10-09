"""Drain development operations before operator cutover or rollback."""
from contextlib import contextmanager
import errno
import fcntl
import os
import stat


@contextmanager
def _lock_file(root, writable=False):
    """Open the same protected inode for contributors and the root operator."""
    controls = root / 'ops'
    metadata = controls.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise ValueError('Development controls must be an operator-owned protected directory.')
    descriptor = os.open(controls / 'development.lock',
                         (os.O_RDWR if writable else os.O_RDONLY) | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise ValueError('Development fence must be an operator-owned protected file.')
        yield descriptor
    finally:
        os.close(descriptor)


@contextmanager
def development_operation(root):
    """Hold a shared fence for the full mutation/start, including health waits."""
    with _lock_file(root) as descriptor:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno not in {errno.EACCES, errno.EAGAIN}:
                raise
            raise ValueError('Development maintenance is active. Try again later.') from error
        if os.path.lexists(root / 'ops' / 'coolify-cutover'):
            raise ValueError('The operator is switching development management. Try again later.')
        yield


@contextmanager
def maintenance(root, resume=False):
    """Root pauses admission, drains operations, and holds exclusive migration access.

    Wrap the entire reviewed cutover/rollback in this context. Failure leaves the
    pause marker in place; an operator may explicitly resume after inspection.
    Never replace/remove the lock file: other processes may still hold its inode.
    """
    if os.getuid() != 0:
        raise ValueError('Only the root operator may run development maintenance.')
    with _lock_file(root, writable=True) as descriptor:
        marker = root / 'ops' / 'coolify-cutover'
        try:
            pause = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        except FileExistsError:
            if not resume:
                raise ValueError('Development is already paused; inspect recovery before resuming.')
            metadata = marker.lstat()
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
                raise ValueError('Invalid maintenance pause marker.')
        else:
            os.close(pause)
        # Blocking here drains admitted starts/syncs before any storage operation.
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        # Another operator may have completed recovery while this resume waited.
        if not os.path.lexists(marker):
            raise ValueError('Maintenance pause was cleared while waiting; inspect the current state.')
        yield
        marker.unlink()
