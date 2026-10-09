"""Deterministic process/crash/disk controls for durable source attempt state."""
import copy
import json
import multiprocessing
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from source_candidate_state import run_serialized
from source_candidates import digest
from test_source_candidates import SOURCE, Response, parser


def run(store, now=120, transport=None):
    return run_serialized(SOURCE, store=store, now_seconds=now, retrieved_at_utc='2026-10-09T00:00:00Z',
                          transport=transport or (lambda *args: Response(b'{"notices":{"a":"closed"}}')),
                          parser=parser, parser_version='1', schema_version=1,
                          accepted={'candidateId': 'accepted-never-replaced'})


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
