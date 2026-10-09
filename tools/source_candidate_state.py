"""Local POSIX process serialization and durable attempt reservations for #105."""
from contextlib import contextmanager
import fcntl
import json
import math
import os
from pathlib import Path
import tempfile

from source_candidates import (canonical, digest, observe, validate_observation, validate_source,
                               durable_directory, fsync_directory, immutable_document,
                               load_candidate, read_document, record_diff, utc_timestamp)


def atomic_state(path, state):
    """Reservation must be durable before network work; previous bytes survive error."""
    payload = {k: v for k, v in state.items() if k != 'stateSha256'}
    payload['stateSha256'] = digest(payload)
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(canonical(payload) + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
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


DEFAULT_RETENTION = {'maxSnapshots': 256, 'maxTransitions': 1024, 'maxBytes': 67108864}


class RetentionLimitError(ValueError):
    pass


class Capacity:
    """Shared-store caps. No automatic pruning of evidence needed by admission."""
    def __init__(self, root, limits):
        self.root, self.limits = root, dict(limits)
        if set(self.limits) != set(DEFAULT_RETENTION) or any(type(n) is not int or n <= 0 for n in self.limits.values()):
            raise ValueError('Invalid retention policy')

    def files(self, directory):
        path = self.root / directory
        return list(path.iterdir()) if path.exists() else []

    def ensure_run_room(self):
        if len([p for p in self.files('transitions') if p.suffix == '.json']) >= self.limits['maxTransitions']:
            raise RetentionLimitError('Transition quota full')

    def __call__(self, directory, target, payload_bytes):
        key = 'maxSnapshots' if directory.name == 'candidates' else 'maxTransitions'
        published = [p for p in directory.iterdir() if p.suffix == '.json']
        if len(published) >= self.limits[key]:
            raise RetentionLimitError('Evidence count quota full')
        # Count orphan temporaries too. Reserve both names of the temporary/link
        # publication conservatively, so a crash cannot cause unbounded growth.
        used = sum(p.stat().st_size for group in ('candidates', 'transitions') for p in self.files(group))
        if used + 2 * payload_bytes > self.limits['maxBytes']:
            raise RetentionLimitError('Evidence byte quota full')


def change_kind(candidate, parent, diff):
    if parent is None:
        return 'initial'
    if candidate['candidateId'] == parent['candidateId']:
        return 'no-change'
    if any(diff.values()):
        return 'records'
    if any(candidate['identity'][key] != parent['identity'][key]
           for key in ('registrySha256', 'parserVersion', 'sourceSchemaVersion')):
        return 'contract'
    return 'provenance-only'


def validate_transition(transition):
    payload = {k: v for k, v in transition.items() if k != 'transitionId'}
    if transition['schemaVersion'] != 1 or digest(payload) != transition['transitionId']:
        raise ValueError('Transition integrity failed')
    utc_timestamp(transition['retrievedAtUtc'])


def load_transition(root, transition_id):
    """Revalidate the complete current transition and both immutable snapshots."""
    transition = read_document(root / 'transitions' / (transition_id + '.json'),
                               transition_id, 'transitionId', validate_transition)
    candidate = load_candidate(root / 'candidates', transition['candidateId'])
    parent = (load_candidate(root / 'candidates', transition['parentCandidateId'])
              if transition['parentCandidateId'] is not None else None)
    diff = record_diff(candidate['records'], parent['records'] if parent else {})
    kind = change_kind(candidate, parent, diff)
    if (candidate['sourceId'] != transition['sourceId']
            or (parent and parent['sourceId'] != transition['sourceId'])
            or transition['candidateProvenanceSha256'] != candidate['provenanceSha256']
            or transition['parentProvenanceSha256'] != (parent['provenanceSha256'] if parent else None)
            or transition['diff'] != diff or transition['changeKind'] != kind
            or transition['observationOnly'] != (kind == 'provenance-only')
            or transition['status'] != ('no-change' if kind == 'no-change' else 'candidate')):
        raise ValueError('Transition differs from its bound snapshots')
    return transition


def persist_transition(root, result, previous, capacity):
    observation = result['observation']
    candidate = load_candidate(root / 'candidates', observation['candidateId'], validate_observation(observation))
    parent = load_candidate(root / 'candidates', previous['candidateId']) if previous else None
    diff = record_diff(candidate['records'], parent['records'] if parent else {})
    kind = change_kind(candidate, parent, diff)
    transition = dict(schemaVersion=1, sourceId=observation['sourceId'],
                      candidateId=candidate['candidateId'], parentCandidateId=parent['candidateId'] if parent else None,
                      candidateProvenanceSha256=candidate['provenanceSha256'],
                      parentProvenanceSha256=parent['provenanceSha256'] if parent else None,
                      retrievedAtUtc=result['retrievedAtUtc'], attemptedAtSeconds=result['attemptedAtSeconds'],
                      diff=diff, status=result['status'], changeKind=kind, observationOnly=kind == 'provenance-only')
    transition['transitionId'] = digest(transition)
    immutable_document(root / 'transitions', transition, 'transitionId', validate_transition, capacity)
    return load_transition(root, transition['transitionId'])


def run_serialized(source, *, store, now_seconds, retrieved_at_utc, accepted=None,
                   observer=observe, retention_limits=None, **kwargs):
    """Durable attempt reservation, immutable snapshot, and hash-bound run journal.

    Hold per-source and shared-store POSIX locks through validation/publication.
    Complete successful transitions are durable before state references them;
    no-change paths revalidate their referenced snapshots and transition as well.
    Quotas refuse new evidence without pruning or mutating accepted snapshots.
    """
    validate_source(source)
    if (type(now_seconds) not in (int, float) or not math.isfinite(now_seconds)
            or now_seconds < 0):
        raise ValueError('Invalid attempt clock')
    root = Path(store)
    durable_directory(root)
    key = digest(source['sourceId'])
    state_path, lock_path = root / (key + '.state.json'), root / (key + '.lock')
    failure = dict(schemaVersion=1, sourceId=source['sourceId'], status='failed',
                   staleEvidence=True, candidate=None, retrievedAtUtc=retrieved_at_utc,
                   acceptedSnapshotId=(accepted or {}).get('candidateId'))
    try:
        with source_lock(lock_path), source_lock(root / 'retention.lock'):
            exists = state_path.exists()
            state = json.loads(state_path.read_bytes()) if exists else {
                'schemaVersion': 1, 'sourceId': source['sourceId'], 'observation': None,
                'lastAttemptSeconds': None, 'staleEvidence': True, 'lastTransitionId': None}
            if exists and digest({k: v for k, v in state.items() if k != 'stateSha256'}) != state.get('stateSha256'):
                raise ValueError('Persisted state integrity failed')
            if state['schemaVersion'] != 1 or state['sourceId'] != source['sourceId']:
                raise ValueError('Incompatible rate state')
            try:
                previous = state['observation']
                if previous:
                    identity = validate_observation(previous)
                    load_candidate(root / 'candidates', previous['candidateId'], identity)
                    transition = load_transition(root, state['lastTransitionId'])
                    if (transition['candidateId'] != previous['candidateId'] or transition['sourceId'] != source['sourceId']
                            or transition['attemptedAtSeconds'] != state['lastSuccessfulAttemptSeconds']
                            or transition['retrievedAtUtc'] != state['lastSuccessfulRetrievedAtUtc']):
                        raise ValueError('State points to another transition')
                last_attempt = state['lastAttemptSeconds']
                if last_attempt is not None:
                    if type(last_attempt) not in (int, float) or not math.isfinite(last_attempt) or last_attempt < 0:
                        raise ValueError('Invalid persisted attempt clock')
                    if now_seconds - last_attempt < source['fetchLimits']['minIntervalSeconds']:
                        return dict(failure, status='rate-limited', lastAttemptSeconds=last_attempt)
                capacity = Capacity(root, retention_limits if retention_limits is not None else DEFAULT_RETENTION)
                capacity.ensure_run_room()
                state.update(lastAttemptSeconds=now_seconds, staleEvidence=True,
                             lastStatus='in-progress', lastRetrievedAtUtc=retrieved_at_utc)
                atomic_state(state_path, state)
                result = observer(source, now_seconds=now_seconds, retrieved_at_utc=retrieved_at_utc,
                                  previous=previous, accepted=accepted, directory=root / 'candidates',
                                  capacity=capacity, **kwargs)
                completed = dict(state)
                if result.get('observation') is not None:
                    transition = persist_transition(root, result, previous, capacity)
                    completed.update(observation=result['observation'], lastTransitionId=transition['transitionId'],
                                     lastSuccessfulAttemptSeconds=now_seconds,
                                     lastSuccessfulRetrievedAtUtc=retrieved_at_utc)
                    result.update(transition=transition, transitionId=transition['transitionId'],
                                  runDiff=transition['diff'], parentCandidateId=transition['parentCandidateId'])
                completed.update(lastStatus=result['status'], staleEvidence=result['staleEvidence'])
                if result['status'] == 'failed':
                    completed['lastFailureType'] = result.get('failureType', 'ValueError')
                else:
                    completed.pop('lastFailureType', None)
                atomic_state(state_path, completed)
                return result
            except Exception as error:
                state.update(lastStatus='failed', staleEvidence=True, lastFailureType=type(error).__name__)
                try:
                    atomic_state(state_path, state)
                except OSError:
                    pass
                return dict(failure, failureType=type(error).__name__)
    except Exception as error:
        return dict(failure, failureType=type(error).__name__)
