"""Synthetic official-source shapes and exact URLs; no live research or network."""
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

from source_adapters import (COUNTY, SELECTION, TIGER, OVERPASS, OSM, Body,
                             observe_adapter, notice_parser, overpass_parser)
from source_candidate_state import run_serialized
from source_candidates import canonical, digest, https_transport

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = json.loads((ROOT / 'data/web-source-registry.json').read_bytes())


def source(source_id):
    return copy.deepcopy(next(entry for entry in REGISTRY['sources'] if entry['sourceId'] == source_id))


class Clock:
    def __init__(self):
        self.value = 0.0
        self.delays = []
    def __call__(self):
        return self.value
    def sleep(self, delay):
        self.delays.append(delay)
        self.value += delay


class SyntheticTransport:
    def __init__(self, layers=None):
        self.layers = layers or {}
        self.calls = []
        self.id_counts = {}
        self.partial = False
        self.change_after = False
        self.metadata_change = False
        self.extra = {}
        self.fail_url = None
    def __call__(self, url, headers, timeout):
        self.calls.append((url, headers, timeout))
        if self.fail_url and self.fail_url in url:
            raise TimeoutError()
        if url in self.extra:
            raw = self.extra[url]
        else:
            split = urlsplit(url)
            params = parse_qs(split.query)
            layer = url.split('?')[0].removesuffix('/query')
            features = self.layers[layer]
            if split.path.endswith('/query'):
                if params.get('returnIdsOnly') == ['true']:
                    count = self.id_counts.get(layer, 0) + 1
                    self.id_counts[layer] = count
                    ids = [f['attributes'].get('OBJECTID', f['attributes'].get('OBJECTID_1')) for f in features]
                    if self.change_after and count % 2 == 0:
                        ids.append(999)
                    raw = canonical({'objectIds': ids})
                else:
                    ids = set(map(int, params['objectIds'][0].split(',')))
                    chosen = [f for f in features if f['attributes'].get('OBJECTID', f['attributes'].get('OBJECTID_1')) in ids]
                    raw = canonical({'features': chosen, 'spatialReference': {'wkid': 4326},
                                     'exceededTransferLimit': self.partial})
            else:
                edited = 2000 if self.metadata_change and self.id_counts.get(layer, 0) >= 2 else 1000
                raw = canonical({'name': 'Synthetic official layer', 'geometryType': 'esriGeometryPolyline',
                                 'fields': [{'name': 'OBJECTID'}], 'editingInfo': {'lastEditDate': edited}})
        if isinstance(raw, dict):
            raw = canonical(raw)
        response = Body(raw)
        response.headers = {'ETag': '"' + digest(raw.hex()) + '"'}
        if headers.get('If-None-Match') == response.headers['ETag']:
            response = Body(b'')
            response.status = 304
        return response


def feature(object_id, id_field='OBJECTID'):
    return {'attributes': {id_field: object_id, 'NAME': 'Synthetic public source', 'status': '1'},
            'geometry': {'paths': [[[-89.0, 40.5], [-89.01, 40.5]]]}}


def county_fixture():
    manifest = {'licensedSourceUrl': COUNTY + '8', 'licensedItemId': 'a2a54b1f94704061abc90686fbc5c220',
                'licenseEvidenceUrl': 'https://www.arcgis.com/sharing/rest/content/items/a2a54b1f94704061abc90686fbc5c220?f=json',
                'features': [{'selectionLayerId': 54, 'objectId': 1}, {'selectionLayerId': 16, 'objectId': 2}]}
    transport = SyntheticTransport({COUNTY + '8': [feature(1), feature(2)],
                                    SELECTION + '54': [feature(1)], SELECTION + '16': [feature(2)]})
    transport.extra[manifest['licenseEvidenceUrl']] = canonical({'licenseInfo': 'CC BY 4.0', 'modified': 1000})
    return manifest, transport


def observe(source, manifest, transport, previous=None, directory=None):
    clock = Clock()
    return observe_adapter(source, manifest=manifest, transport=transport,
                           previous=previous, directory=directory, monotonic=clock, sleeper=clock.sleep,
                           retrieved_at_utc='2026-10-09T00:00:00Z', now_seconds=120,
                           accepted={'candidateId': 'accepted'})


class AdapterTests(unittest.TestCase):
    def test_county_complete_conditional_change_and_disappearance(self):
        manifest, transport = county_fixture()
        with tempfile.TemporaryDirectory() as directory:
            first = observe(source('county-trails'), manifest, transport, directory=directory)
            self.assertEqual(first['status'], 'candidate', first)
            self.assertIn('licensed:54:1', first['candidate']['records'])
            self.assertIn('operational-16:16:2', first['candidate']['records'])
            self.assertTrue(first['candidate']['identity']['componentHashes'])
            self.assertIsNone(first['candidate']['sourcePublishedAtUtc'])
            self.assertEqual(first['candidate']['identity']['sourceTimes']['licensed-metadata']['metadata']['modifiedAtUtc'], '1970-01-01T00:00:01Z')
            same = observe(source('county-trails'), manifest, transport, first['observation'], directory)
            self.assertEqual(same['status'], 'no-change', same)
            self.assertTrue(any('If-None-Match' in headers for _, headers, _ in transport.calls))
            transport.layers[COUNTY + '8'][0]['attributes']['status'] = 'restricted'
            changed = observe(source('county-trails'), manifest, transport, same['observation'], directory)
            self.assertIn('licensed:54:1', changed['runDiff']['changed'])
            transport.layers[COUNTY + '8'].pop()
            disappeared = observe(source('county-trails'), manifest, transport, changed['observation'], directory)
            self.assertIn('licensed:16:2', disappeared['runDiff']['removed'])
            self.assertEqual(disappeared['acceptedSnapshotId'], 'accepted')
            self.assertTrue(disappeared['candidate']['requiresReview'])

    def test_partial_midrun_failure_and_changed_snapshot_publish_nothing(self):
        for failure in ('partial', 'change_after', 'metadata_change', 'timeout'):
            manifest, transport = county_fixture()
            if failure == 'timeout':
                transport.fail_url = SELECTION + '16'
            else:
                setattr(transport, failure, True)
            with tempfile.TemporaryDirectory() as directory:
                result = observe(source('county-trails'), manifest, transport, directory=directory)
                self.assertEqual(result['status'], 'failed', (failure, result))
                self.assertTrue(result['staleEvidence'])
                self.assertNotIn('observation', result)
                self.assertEqual(list(Path(directory).glob('*.json')), [])

    def test_tiger_batch_completeness_and_bounds(self):
        selection = source('tiger-access-roads')
        selection['fetchLimits']['batchSize'] = 2
        manifest = {'sourceInput': {'boundingBoxWgs84': [-89.2, 40.4, -88.9, 40.6]}}
        transport = SyntheticTransport({TIGER: [feature(3), feature(1), feature(2)]})
        result = observe(selection, manifest, transport)
        self.assertEqual(result['status'], 'candidate', result)
        self.assertEqual([key for key in result['candidate']['records'] if key.startswith('tiger:')], ['tiger:1', 'tiger:2', 'tiger:3'])
        urls = [url for url, _, _ in transport.calls]
        self.assertTrue(any('resultOffset' not in url and 'objectIds=1%2C2' in url for url in urls))
        self.assertTrue(any('geometry=-89.2%2C40.4%2C-88.9%2C40.6' in url for url in urls))
        for limit, value in (('maxRequestsPerRun', 1), ('maxFeatures', 1), ('maxBytes', 2), ('timeoutSeconds', 1)):
            constrained = copy.deepcopy(selection)
            constrained['fetchLimits'][limit] = value
            self.assertEqual(observe(constrained, manifest, transport)['status'], 'failed')

    def test_address_fields_are_pinned_and_not_retained(self):
        manifest = json.loads((ROOT / 'data/web-address-index.manifest.json').read_bytes())
        transport = SyntheticTransport({COUNTY + '0': [feature(1, 'OBJECTID_1')]})
        result = observe(source('county-addresses'), manifest, transport)
        self.assertEqual(result['status'], 'candidate', result)
        for url, _, _ in transport.calls:
            if 'outFields=' in url:
                self.assertNotIn('outFields=%2A', url)
                self.assertIn('OBJECTID_1', url)
        self.assertNotIn('Synthetic public source', json.dumps(result))

    def test_osm_way_changes_and_partial_xml(self):
        selection = source('osm-reviewed-paths')
        manifest = {'features': [{'wayId': 1}]}
        transport = SyntheticTransport()
        url = OSM + '1/full'
        xml = b'<osm><node id="9" lon="-89" lat="40.5"/><node id="10" lon="-89.01" lat="40.5"/><way id="1" version="1" timestamp="2026-10-09T00:00:00Z"><nd ref="9"/><nd ref="10"/><tag k="bicycle" v="yes"/></way></osm>'
        transport.extra[url] = xml
        first = observe(selection, manifest, transport)
        self.assertEqual(first['status'], 'candidate', first)
        self.assertEqual(transport.calls[0][1]['Accept'], 'application/xml')
        transport.extra[url] = xml.replace(b'v="yes"', b'v="no"')
        changed = observe(selection, manifest, transport, first['observation'])
        self.assertIn('way-1:verified-osm:way:1', changed['runDiff']['changed'])
        transport.extra[url] = xml.replace(b'<node id="10" lon="-89.01" lat="40.5"/>', b'')
        self.assertEqual(observe(selection, manifest, transport)['status'], 'failed')

    def test_overpass_complete_empty_is_reviewable_but_remark_is_failure(self):
        manifest = {'sourceInput': {'boundingBoxWgs84': [-89.2, 40.4, -88.9, 40.6]}}
        def transport(url, headers, timeout):
            self.assertTrue(url.startswith(OVERPASS + '?data='))
            return Body(canonical({'osm3s': {'timestamp_osm_base': '2026-10-09T00:00:00Z'}, 'elements': []}))
        self.assertEqual(observe(source('osm-service-roads'), manifest, transport)['status'], 'candidate')
        with self.assertRaises(ValueError):
            overpass_parser(canonical({'remark': 'timeout', 'elements': []}))

    def test_official_notice_changes_do_not_interpret_access_and_errors_stay_stale(self):
        selection = source('notice-uptown-initial')
        manifest = json.loads((ROOT / selection['manifestPath']).read_bytes())
        transport = SyntheticTransport()
        transport.extra[selection['url']] = b'<html><head><title>Parkinson Street trail detour</title><meta property="article:published_time" content="2026-09-14T00:00:00Z"></head><body><main>The trail closes north of Vernon while a sidewalk is built. Later a detour starts at Phoenix.</main></body></html>'
        first = observe(selection, manifest, transport)
        self.assertEqual(first['status'], 'candidate', first)
        self.assertEqual(first['candidate']['identity']['sourceTimes']['notice']['notice']['publishedAtUtc'], '2026-09-14T00:00:00Z')
        transport.extra[selection['url']] = transport.extra[selection['url']].replace(b'Later a detour', b'A disappeared notice is not reopening. Later a detour')
        changed = observe(selection, manifest, transport, first['observation'])
        self.assertEqual(changed['runDiff']['changed'], ['notice:uptown-initial'])
        self.assertNotIn('Vernon', json.dumps(changed))
        for raw in (b'<html><title>Access denied</title></html>', b'<html><title>Not found</title><main>No notice is available here any more even though this is HTTP 200</main></html>'):
            transport.extra[selection['url']] = raw
            failed = observe(selection, manifest, transport, first['observation'])
            self.assertEqual(failed['status'], 'failed')
            self.assertEqual(failed['acceptedSnapshotId'], 'accepted')

    def test_serialized_adapter_failure_retains_all_last_successful_components(self):
        manifest, transport = county_fixture()
        with tempfile.TemporaryDirectory() as store:
            clock = Clock()
            kwargs = dict(store=store, observer=observe_adapter, transport=transport, manifest=manifest,
                          retrieved_at_utc='2026-10-09T00:00:00Z', monotonic=clock, sleeper=clock.sleep)
            first = run_serialized(source('county-trails'), now_seconds=120, **kwargs)
            self.assertEqual(first['status'], 'candidate')
            transport.layers[COUNTY + '8'][0]['attributes']['status'] = 'changed'
            transport.fail_url = SELECTION + '16'
            failed = run_serialized(source('county-trails'), now_seconds=86520, **kwargs)
            self.assertEqual(failed['status'], 'failed')
            state = json.loads(next(Path(store).glob('*.state.json')).read_bytes())
            self.assertEqual(state['observation'], first['observation'])
            self.assertTrue(state['staleEvidence'])
            self.assertEqual(len(list((Path(store) / 'candidates').glob('*.json'))), 1)

    def test_builtin_live_transport_is_disabled_by_registry(self):
        manifest, _ = county_fixture()
        result = observe(source('county-trails'), manifest, https_transport)
        self.assertEqual(result['status'], 'failed')
        self.assertTrue(result['staleEvidence'])

    def test_city_gis_notice_disappearance_is_reviewable_not_reopening(self):
        selection = source('notice-city-gis-road-closures')
        manifest = json.loads((ROOT / selection['manifestPath']).read_bytes())
        transport = SyntheticTransport()
        transport.extra[selection['url']] = canonical({'features': [feature(841)]})
        first = observe(selection, manifest, transport)
        self.assertEqual(first['status'], 'candidate', first)
        transport.extra[selection['url']] = canonical({'features': []})
        missing = observe(selection, manifest, transport, first['observation'])
        self.assertEqual(missing['runDiff']['removed'], ['notice:road-closure:841'])
        self.assertTrue(missing['candidate']['requiresReview'])
        self.assertEqual(missing['acceptedSnapshotId'], 'accepted')
        for value in ({'features': [], 'exceededTransferLimit': True}, {'features': [feature(123)]}):
            transport.extra[selection['url']] = canonical(value)
            self.assertEqual(observe(selection, manifest, transport)['status'], 'failed')

    def test_adapter_version_and_source_changes_suppress_conditional_requests(self):
        manifest, transport = county_fixture()
        selection = source('county-trails')
        first = observe(selection, manifest, transport)
        transport.calls = []
        clock = Clock()
        result = observe_adapter(selection, manifest=manifest, transport=transport,
                                 previous=first['observation'], parser_version='adapter-2',
                                 monotonic=clock, sleeper=clock.sleep,
                                 retrieved_at_utc='2026-10-09T00:00:00Z', now_seconds=120)
        self.assertEqual(result['status'], 'candidate', result)
        self.assertTrue(all('If-None-Match' not in headers for _, headers, _ in transport.calls))
        selection['url'] = 'https://example.invalid/unreviewed'
        self.assertEqual(observe(selection, manifest, transport)['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
