"""Local POSIX process serialization and durable attempt reservations for #105."""
from contextlib import contextmanager
import fcntl
import json
import math
import os
from pathlib import Path
import tempfile

from source_candidates import canonical, digest, observe, validate_observation, validate_source


def atomic_state(path, state):
    """Reservation must be durable before network work; previous bytes survive error."""
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(canonical(state) + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def source_lock(path):
    # Never unlink a lock file: another process may already hold that inode.
    with path.open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def run_serialized(source, *, store, now_seconds, retrieved_at_utc, accepted=None,
                   observer=observe, **kwargs):
    """Reserve one attempt under a process lock, then observe without admitting data.

    The local store must be trusted and shared by all processes checking this
    registry. Observation state is separate from accepted snapshots and native data.
    A process crash releases flock but leaves its reservation/cooldown in place.
    Rate-limited invocations do not extend the cooldown. Clock rollback fails shut.
    """
    validate_source(source)
    if (type(now_seconds) not in (int, float) or not math.isfinite(now_seconds)
            or now_seconds < 0):
        raise ValueError('Invalid attempt clock')
    root = Path(store)
    root.mkdir(parents=True, exist_ok=True)
    key = digest(source['sourceId'])
    state_path, lock_path = root / (key + '.state.json'), root / (key + '.lock')
    failure = dict(schemaVersion=1, sourceId=source['sourceId'], status='failed',
                   staleEvidence=True, candidate=None, retrievedAtUtc=retrieved_at_utc,
                   acceptedSnapshotId=(accepted or {}).get('candidateId'))
    try:
        with source_lock(lock_path):
            state = json.loads(state_path.read_bytes()) if state_path.exists() else {
                'schemaVersion': 1, 'sourceId': source['sourceId'], 'observation': None,
                'lastAttemptSeconds': None, 'staleEvidence': True}
            if state['schemaVersion'] != 1 or state['sourceId'] != source['sourceId']:
                raise ValueError('Incompatible rate state')
            previous = state['observation']
            if previous:
                validate_observation(previous)
            last_attempt = state['lastAttemptSeconds']
            if last_attempt is not None:
                if type(last_attempt) not in (int, float) or not math.isfinite(last_attempt):
                    raise ValueError('Invalid persisted attempt clock')
                if now_seconds - last_attempt < source['fetchLimits']['minIntervalSeconds']:
                    return dict(failure, status='rate-limited', lastAttemptSeconds=last_attempt)
            state.update(lastAttemptSeconds=now_seconds, staleEvidence=True,
                         lastStatus='in-progress', lastRetrievedAtUtc=retrieved_at_utc)
            atomic_state(state_path, state)
            result = observer(source, now_seconds=now_seconds, retrieved_at_utc=retrieved_at_utc,
                              previous=previous, accepted=accepted,
                              directory=root / 'candidates', **kwargs)
            if result.get('observation') is not None:
                state['observation'] = result['observation']
            state.update(lastStatus=result['status'], staleEvidence=result['staleEvidence'])
            atomic_state(state_path, state)
            return result
    except Exception as error:
        # A reserved attempt remains stale if transport, parse, write or process
        # completion fails. Neither source exception strings nor accepted data persist.
        return dict(failure, failureType=type(error).__name__)
