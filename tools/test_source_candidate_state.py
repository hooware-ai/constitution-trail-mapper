"""Deterministic process/crash/disk controls for durable source attempt state."""
import copy
import json
import multiprocessing
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from source_candidate_state import run_serialized, load_transition
from source_candidates import digest
from test_source_candidates import SOURCE, Response, parser


def run(store, now=120, transport=None, retrieved_at='2026-10-09T00:00:00Z', **kwargs):
    return run_serialized(SOURCE, store=store, now_seconds=now, retrieved_at_utc=retrieved_at,
                          transport=transport or (lambda *args: Response(b'{"notices":{"a":"closed"}}')),
                          parser=parser, parser_version='1', schema_version=1,
                          accepted={'candidateId': 'accepted-never-replaced'}, **kwargs)


def parallel_worker(store, started, release, queue):
    def transport(*args):
        started.set()
        if not release.wait(5):
            raise TimeoutError()
        return Response(b'{"notices":{"a":"closed"}}')
    queue.put(run(store, transport=transport)['status'])


def crash_worker(store):
    def transport(*args):
        import os
        os._exit(7)
    run(store, transport=transport)


class StateTests(unittest.TestCase):
    def test_store_setup_errors_return_failure_without_source_work(self):
        for error in (PermissionError('private path detail'), OSError('disk detail')):
            with self.subTest(error=type(error).__name__), tempfile.TemporaryDirectory() as store:
                run(store)
                before = {str(p): p.read_bytes() for p in Path(store).rglob('*') if p.is_file()}
                transport, observer = Mock(), Mock()
                with patch('source_candidate_state.durable_directory', side_effect=error):
                    result = run(store, now=180, transport=transport, observer=observer)
                self.assertEqual(result, {
                    'schemaVersion': 1, 'sourceId': SOURCE['sourceId'], 'status': 'failed',
                    'staleEvidence': True, 'candidate': None,
                    'retrievedAtUtc': '2026-10-09T00:00:00Z',
                    'acceptedSnapshotId': 'accepted-never-replaced',
                    'failureType': type(error).__name__,
                })
                transport.assert_not_called()
                observer.assert_not_called()
                after = {str(p): p.read_bytes() for p in Path(store).rglob('*') if p.is_file()}
                self.assertEqual(before, after)

    def test_store_under_regular_file_returns_failure_without_fetch(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory) / 'not-a-directory'
            parent.write_bytes(b'keep existing file')
            transport, observer = Mock(), Mock()
            result = run(parent / 'store', transport=transport, observer=observer)
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['failureType'], 'NotADirectoryError')
            self.assertTrue(result['staleEvidence'])
            self.assertIsNone(result['candidate'])
            self.assertNotIn('observation', result)
            self.assertNotIn('transition', result)
            transport.assert_not_called()
            observer.assert_not_called()
            self.assertEqual(parent.read_bytes(), b'keep existing file')

    def test_candidate_directory_sync_failure_cannot_create_successful_reference(self):
        from source_candidates import fsync_directory
        synced = []
        def sync(directory):
            synced.append(Path(directory).name)
            if Path(directory).name == 'candidates':
                raise OSError('directory sync failed')
            fsync_directory(directory)
        with tempfile.TemporaryDirectory() as store:
            with patch('source_candidates.fsync_directory', side_effect=sync):
                failed = run(store)
            self.assertEqual(failed['status'], 'failed')
            state = json.loads(next(Path(store).glob('*.state.json')).read_bytes())
            self.assertIsNone(state['observation'])
            self.assertIsNone(state['lastTransitionId'])
            self.assertTrue(state['staleEvidence'])
            self.assertIn('candidates', synced)
            self.assertEqual(run(store, now=180)['status'], 'candidate')

    def test_corrupt_or_missing_transition_and_rate_metadata_block_fetch(self):
        for damage in ('missing', 'diff', 'clock'):
            with self.subTest(damage=damage), tempfile.TemporaryDirectory() as store:
                first = run(store)
                state_path = next(Path(store).glob('*.state.json'))
                state = json.loads(state_path.read_bytes())
                path = Path(store) / 'transitions' / (first['transitionId'] + '.json')
                if damage == 'missing':
                    path.unlink()
                elif damage == 'clock':
                    state['lastAttemptSeconds'] = 0
                    state_path.write_text(json.dumps(state))
                else:
                    transition = json.loads(path.read_bytes())
                    transition['diff']['added'] = []
                    path.write_text(json.dumps(transition))
                calls = []
                def transport(*args):
                    calls.append(args)
                    return Response(b'{"notices":{"a":"closed"}}')
                self.assertEqual(run(store, now=180, transport=transport)['status'], 'failed')
                self.assertEqual(calls, [])

    def test_hash_valid_transition_must_match_bound_snapshot_diff(self):
        with tempfile.TemporaryDirectory() as store:
            first = run(store)
            forged = copy.deepcopy(first['transition'])
            forged['diff']['added'] = []
            del forged['transitionId']
            forged['transitionId'] = digest(forged)
            (Path(store) / 'transitions' / (forged['transitionId'] + '.json')).write_text(json.dumps(forged))
            with self.assertRaises(ValueError):
                load_transition(Path(store), forged['transitionId'])

    def test_retention_caps_refuse_growth_without_pruning_or_advancing_observation(self):
        for limits, changed in (({'maxSnapshots': 1, 'maxTransitions': 5, 'maxBytes': 100000}, True),
                                ({'maxSnapshots': 5, 'maxTransitions': 1, 'maxBytes': 100000}, False)):
            with self.subTest(limits=limits), tempfile.TemporaryDirectory() as store:
                first = run(store, retention_limits=limits)
                self.assertEqual(first['status'], 'candidate')
                before = {str(p): p.read_bytes() for group in ('candidates', 'transitions')
                          for p in (Path(store) / group).glob('*.json')}
                calls = []
                def transport(*args):
                    calls.append(args)
                    return Response(b'{"notices":{"b":"new"}}' if changed else b'{"notices":{"a":"closed"}}')
                second = run(store, now=180, retention_limits=limits, transport=transport)
                self.assertEqual(second['status'], 'failed')
                self.assertTrue(second['staleEvidence'])
                if not changed:
                    self.assertEqual(calls, [])
                state = json.loads(next(Path(store).glob('*.state.json')).read_bytes())
                self.assertEqual(state['observation'], first['observation'])
                self.assertEqual(state['lastTransitionId'], first['transitionId'])
                after = {str(p): p.read_bytes() for group in ('candidates', 'transitions')
                         for p in (Path(store) / group).glob('*.json')}
                self.assertEqual(after, before)
        with tempfile.TemporaryDirectory() as store:
            self.assertEqual(run(store, retention_limits={'maxSnapshots': 5, 'maxTransitions': 5, 'maxBytes': 1})['status'], 'failed')
            self.assertEqual(list((Path(store) / 'candidates').glob('*.json')), [])

    def test_current_transition_survives_a_b_a_restart(self):
        with tempfile.TemporaryDirectory() as store:
            first = run(store)
            second = run(store, now=180, transport=lambda *args: Response(b'{"notices":{"b":"new"}}'))
            third = run(store, now=240, retrieved_at='2026-10-09T00:02:00Z')
            self.assertEqual(first['candidate'], third['candidate'])
            state = json.loads(next(Path(store).glob('*.state.json')).read_bytes())
            transition = json.loads((Path(store) / 'transitions' / (state['lastTransitionId'] + '.json')).read_bytes())
            self.assertEqual(transition, third['transition'])
            self.assertEqual(transition['candidateId'], first['candidate']['candidateId'])
            self.assertEqual(transition['parentCandidateId'], second['candidate']['candidateId'])
            self.assertEqual(transition['retrievedAtUtc'], '2026-10-09T00:02:00Z')
            self.assertEqual(transition['diff'], {'added': ['a'], 'removed': ['b'], 'changed': []})

    def test_missing_or_corrupt_candidate_blocks_unchanged_run(self):
        for damage in ('missing', 'corrupt'):
            with self.subTest(damage=damage), tempfile.TemporaryDirectory() as store:
                first = run(store)
                path = Path(store) / 'candidates' / (first['candidate']['candidateId'] + '.json')
                if damage == 'missing':
                    path.unlink()
                else:
                    candidate = json.loads(path.read_bytes())
                    candidate['retrievedAtUtc'] = '2000-01-01T00:00:00Z'
                    path.write_text(json.dumps(candidate))
                calls = []
                def transport(*args):
                    calls.append(args)
                    return Response(b'{"notices":{"a":"closed"}}')
                result = run(store, now=180, transport=transport)
                self.assertEqual(result['status'], 'failed')
                self.assertTrue(result['staleEvidence'])
                self.assertIsNone(result['candidate'])
                self.assertEqual(calls, [])

    def test_restart_failure_cooldown_and_clock_rollback(self):
        with tempfile.TemporaryDirectory() as store:
            first = run(store)
            self.assertEqual(first['status'], 'candidate')
            state_file = next(Path(store).glob('*.state.json'))
            before = json.loads(state_file.read_bytes())['observation']
            def fail(*args):
                raise TimeoutError('source failure with private text')
            result = run(store, now=180, transport=fail)
            self.assertEqual(result['status'], 'failed')
            state = json.loads(state_file.read_bytes())
            self.assertEqual(state['observation'], before)
            self.assertEqual(state['lastAttemptSeconds'], 180)
            self.assertTrue(state['staleEvidence'])
            for now in (181, 100, 239):
                self.assertEqual(run(store, now=now, transport=lambda *args: self.fail('rate limit fetched'))['status'], 'rate-limited')
            self.assertEqual(json.loads(state_file.read_bytes())['lastAttemptSeconds'], 180)
            self.assertEqual(run(store, now=240)['status'], 'no-change')
            self.assertNotIn('accepted-never-replaced', state_file.read_text())
            self.assertNotIn('private text', state_file.read_text())

    def test_processes_serialize_fetch_and_rate_reservation(self):
        context = multiprocessing.get_context('fork')
        with tempfile.TemporaryDirectory() as store:
            started, release, queue = context.Event(), context.Event(), context.Queue()
            process = context.Process(target=parallel_worker, args=(store, started, release, queue))
            process.start()
            try:
                self.assertTrue(started.wait(5))
                contender = context.Process(target=parallel_worker, args=(store, started, release, queue))
                contender.start()
                release.set()
                process.join(5)
                contender.join(5)
                self.assertEqual(process.exitcode, 0)
                self.assertEqual(contender.exitcode, 0)
                self.assertEqual(sorted([queue.get(timeout=2), queue.get(timeout=2)]), ['candidate', 'rate-limited'])
                self.assertEqual(len(list((Path(store) / 'candidates').glob('*.json'))), 1)
            finally:
                release.set()
                for child in (process, locals().get('contender')):
                    if child and child.is_alive():
                        child.terminate()
                        child.join(5)

    def test_process_crash_keeps_reservation_and_unlocks(self):
        context = multiprocessing.get_context('fork')
        with tempfile.TemporaryDirectory() as store:
            process = context.Process(target=crash_worker, args=(store,))
            process.start()
            process.join(5)
            self.assertEqual(process.exitcode, 7)
            result = run(store, now=121, transport=lambda *args: self.fail('crash reservation lost'))
            self.assertEqual(result['status'], 'rate-limited')
            state = json.loads(next(Path(store).glob('*.state.json')).read_bytes())
            self.assertEqual(state['lastStatus'], 'in-progress')
            self.assertTrue(state['staleEvidence'])
            self.assertIsNone(state['observation'])
            self.assertEqual(run(store, now=180)['status'], 'candidate')

    def test_corrupt_state_and_reservation_write_failure_block_fetch(self):
        with tempfile.TemporaryDirectory() as store:
            path = Path(store) / (digest(SOURCE['sourceId']) + '.state.json')
            path.write_text('broken')
            self.assertEqual(run(store, transport=lambda *args: self.fail('corrupt state fetched'))['status'], 'failed')
            self.assertEqual(path.read_text(), 'broken')
            path.unlink()
            with patch('source_candidate_state.os.replace', side_effect=OSError('disk full')):
                self.assertEqual(run(store, transport=lambda *args: self.fail('unreserved fetch'))['status'], 'failed')
            self.assertFalse(path.exists())
            self.assertEqual(list(Path(store).glob('tmp*')), [])

    def test_tampered_observation_blocks_conditional_fetch(self):
        with tempfile.TemporaryDirectory() as store:
            run(store)
            path = next(Path(store).glob('*.state.json'))
            state = json.loads(path.read_bytes())
            state['observation']['records']['a'] = digest('tampered')
            path.write_text(json.dumps(state))
            self.assertEqual(run(store, now=180, transport=lambda *args: self.fail('tampered state fetched'))['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
