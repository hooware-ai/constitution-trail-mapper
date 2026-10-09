"""Deterministic synthetic scheduled-run foundation: no network or production writes."""
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import source_candidates
from source_candidates import digest, observe, read_bounded, validate_source

SOURCE = {"sourceId": "synthetic", "url": "https://example.invalid/notices",
          "geographicScope": "synthetic", "license": "synthetic only",
          "termsUrl": "https://example.invalid/terms", "expectedUpdateCadence": "unknown",
          "reviewOwner": "fixture", "limitations": "not route admission",
          "manifestPath": "synthetic.manifest.json", "reviewedOn": "2026-10-09",
          "fetchLimits": {"timeoutSeconds": 1, "maxBytes": 1024, "minIntervalSeconds": 60}}


class Response(io.BytesIO):
    status = 200
    headers = {"ETag": '"v1"', "Last-Modified": "Thu, 08 Oct 2026 00:00:00 GMT"}


def parser(raw):
    value = json.loads(raw)
    if value.get("partial"):
        raise ValueError("Partial source")
    return {"records": {k: digest(v) for k, v in value["notices"].items()}}


class CandidatesTests(unittest.TestCase):
    def test_provenance_is_checked_after_publication_reread(self):
        original = source_candidates.immutable_write
        def corrupt_after_write(directory, candidate, capacity=None):
            path = original(directory, candidate, capacity)
            value = json.loads(path.read_bytes())
            value['retrievedAtUtc'] = '2000-01-01T00:00:00Z'
            path.write_text(json.dumps(value))
            return path
        with tempfile.TemporaryDirectory() as directory:
            with patch('source_candidates.immutable_write', side_effect=corrupt_after_write):
                result = self.run_source(directory=directory)
            self.assertEqual(result['status'], 'failed')
            self.assertIsNone(result['candidate'])
            self.assertNotIn('observation', result)

    def run_source(self, raw=b'{"notices":{"a":"closed"}}', **kwargs):
        return observe(SOURCE, transport=lambda *args: Response(raw), parser=parser,
                       parser_version=kwargs.pop("parser_version", "1"), schema_version=1,
                       retrieved_at_utc="2026-10-09T00:00:00Z", now_seconds=120, **kwargs)

    def test_change_nochange_disappearance_and_accepted_preservation(self):
        accepted = {"candidateId": "review-owned"}
        before = copy.deepcopy(accepted)
        with tempfile.TemporaryDirectory() as directory:
            first = self.run_source(accepted=accepted, directory=directory)
            previous = first["observation"]
            same = self.run_source(previous=previous, accepted=accepted, directory=directory)
            self.assertEqual(same["status"], "no-change")
            changed = self.run_source(b'{"notices":{}}', previous=previous, accepted=accepted, directory=directory)
            self.assertEqual(changed["candidate"]["diff"]["removed"], ["a"])
            self.assertTrue(changed["candidate"]["requiresReview"])
            self.assertEqual(len(list(Path(directory).glob('*.json'))), 2)
            for raw in (b'broken', b'{"partial":true}', b'x' * 1025):
                failure = self.run_source(raw, previous=previous, accepted=accepted, directory=directory)
                self.assertTrue(failure["staleEvidence"])
                self.assertIsNone(failure["candidate"])
            self.assertEqual(accepted, before)
            self.assertEqual(len(list(Path(directory).glob('*.json'))), 2)

    def test_conditional_and_parser_change(self):
        previous = self.run_source()["observation"]
        calls = []
        def transport(url, headers, timeout):
            calls.append(headers)
            response = Response()
            response.status = 304
            return response
        args = dict(transport=transport, parser=parser, schema_version=1,
                    retrieved_at_utc="2026-10-09T00:00:00Z", now_seconds=120)
        result = observe(SOURCE, previous=previous, parser_version="1", **args)
        self.assertEqual(result["status"], "no-change")
        self.assertEqual(calls[0]["If-None-Match"], '"v1"')
        self.assertEqual(observe(SOURCE, parser_version="1", **args)["status"], "failed")
        changed = self.run_source(previous=previous, parser_version="2")
        self.assertEqual(changed["status"], "candidate")
        observe(SOURCE, previous=previous, parser_version="2", **args)
        self.assertNotIn("If-None-Match", calls[-1])

    def test_rate_timeout_and_limits(self):
        self.assertEqual(self.run_source(last_attempt_seconds=119)["status"], "rate-limited")
        def timeout(*args):
            raise TimeoutError()
        self.assertTrue(observe(SOURCE, transport=timeout, parser=parser, parser_version="1",
                                schema_version=1, retrieved_at_utc="2026-10-09T00:00:00Z", now_seconds=120)["staleEvidence"])
        ticks = iter([0, 2])
        with self.assertRaises(TimeoutError):
            read_bounded(Response(b'x'), SOURCE["fetchLimits"], 1, lambda: next(ticks))
        for value in (0, -1, True, float('nan')):
            invalid = copy.deepcopy(SOURCE)
            invalid["fetchLimits"]["timeoutSeconds"] = value
            with self.assertRaises(ValueError):
                validate_source(invalid)

    def test_changed_record_http_failure_and_stream_failure(self):
        previous = self.run_source()["observation"]
        changed = self.run_source(b'{"notices":{"a":"changed","b":"new"}}', previous=previous)
        self.assertEqual(changed["candidate"]["diff"], {"added": ["b"], "removed": [], "changed": ["a"]})
        class Broken(Response):
            def read1(self, size):
                raise OSError("partial stream")
        for response in (Broken(), Response()):
            if not isinstance(response, Broken):
                response.status = 503
            result = observe(SOURCE, transport=lambda *args: response, parser=parser,
                             parser_version="1", schema_version=1, retrieved_at_utc="2026-10-09T00:00:00Z",
                             now_seconds=120, previous=previous)
            self.assertEqual(result["status"], "failed")
            self.assertNotIn("observation", result)

    def test_content_length_truncation_and_validator_integrity(self):
        previous = self.run_source()['observation']
        for headers in ({'Content-Length': '99'}, {'ETag': 'bad\r\nheader'}):
            def transport(*args):
                response = Response(b'{"notices":{}}')
                response.headers = headers
                return response
            result = observe(SOURCE, transport=transport, parser=parser, parser_version='1',
                             schema_version=1, retrieved_at_utc='2026-10-09T00:00:00Z', now_seconds=120,
                             previous=previous)
            self.assertEqual(result['status'], 'failed')
        previous['records']['a'] = digest('corrupt')
        result = self.run_source(previous=previous)
        self.assertEqual(result['status'], 'failed')

    def test_completed_http_body_does_not_access_closed_socket_and_late_304_fails(self):
        raw = b'{"notices":{}}'
        class ClosingBody(Response):
            headers = {'Content-Length': str(len(raw))}
            def set_read_timeout(self, value):
                if self.tell() == len(raw):
                    raise OSError('socket already closed at EOF')
        self.assertEqual(read_bounded(ClosingBody(raw), SOURCE['fetchLimits'], 2, lambda: 0), raw)
        previous = self.run_source()['observation']
        clock = [0]
        def delayed(*args):
            clock[0] = 2
            response = Response()
            response.status = 304
            return response
        result = observe(SOURCE, transport=delayed, parser=parser, parser_version='1', schema_version=1,
                         retrieved_at_utc='2026-10-09T00:00:00Z', now_seconds=120,
                         previous=previous, monotonic=lambda: clock[0])
        self.assertEqual(result['failureType'], 'TimeoutError')

    def test_recurring_content_keeps_first_snapshot_and_reports_current_diff(self):
        with tempfile.TemporaryDirectory() as directory:
            first = self.run_source(directory=directory)
            second = self.run_source(b'{"notices":{"b":"new"}}', previous=first['observation'], directory=directory)
            returned = self.run_source(previous=second['observation'], directory=directory)
            self.assertEqual(returned['candidate'], first['candidate'])
            self.assertEqual(returned['runDiff'], {'added': ['a'], 'removed': ['b'], 'changed': []})
            self.assertEqual(len(list(Path(directory).glob('*.json'))), 2)
            path = Path(directory) / (first['candidate']['candidateId'] + '.json')
            broken = json.loads(path.read_bytes())
            broken['requiresReview'] = False
            path.write_text(json.dumps(broken))
            self.assertEqual(self.run_source(directory=directory)['status'], 'failed')

    def test_registry_is_review_only_and_references_existing_manifests(self):
        root = Path(__file__).resolve().parent.parent
        registry = json.loads((root / "data/web-source-registry.json").read_text())
        self.assertFalse(registry["productionEnabled"])
        for source in registry["sources"]:
            validate_source(source)
            self.assertFalse(source["executionApproved"])
            self.assertTrue((root / source["manifestPath"]).is_file())

    def test_immutable_first_observation_and_registry_change(self):
        with tempfile.TemporaryDirectory() as directory:
            first = self.run_source(directory=directory)
            path = next(Path(directory).glob('*.json'))
            original = path.read_bytes()
            self.run_source(directory=directory)
            self.assertEqual(path.read_bytes(), original)
            self.assertNotIn('closed', path.read_text())
            source = copy.deepcopy(SOURCE)
            source['limitations'] = 'new review constraint'
            result = observe(source, transport=lambda *args: Response(b'{"notices":{"a":"closed"}}'),
                             parser=parser, parser_version='1', schema_version=1,
                             retrieved_at_utc='2026-10-09T00:00:00Z', now_seconds=120, previous=first['observation'])
            self.assertEqual(result['status'], 'candidate')


if __name__ == '__main__':
    unittest.main()
