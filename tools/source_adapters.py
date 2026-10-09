"""Bounded official-source adapters. No network, scheduler or admission on import."""
from datetime import datetime, timezone
from html.parser import HTMLParser
import io
import json
import math
import time
import urllib.parse
import xml.etree.ElementTree as ET

from source_candidates import canonical, digest, observe, utc_timestamp, validate_observation

COUNTY = 'https://www.mcgisweb.org/mcgc/rest/services/OpenData/OpenData/MapServer/'
SELECTION = 'https://www.mcgisweb.org/mcgc/rest/services/Recreation/Trails/MapServer/'
TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/8'
OVERPASS = 'https://overpass-api.de/api/interpreter'
OSM = 'https://api.openstreetmap.org/api/0.6/way/'
BBOX = [-89.2, 40.4, -88.9, 40.6]
CLASSES = ['S1400', 'S1640', 'S1710', 'S1730', 'S1780', 'S1820']


def json_value(raw):
    def unique(pairs):
        value = {}
        for key, entry in pairs:
            if key in value:
                raise ValueError('Duplicate JSON key')
            value[key] = entry
        return value
    value = json.loads(raw, object_pairs_hook=unique,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
    if not isinstance(value, dict) or value.get('error') or value.get('remark'):
        raise ValueError('Incomplete source response')
    return value


def source_time(milliseconds):
    if milliseconds is None:
        return None
    if type(milliseconds) not in (int, float) or not math.isfinite(milliseconds):
        raise ValueError('Invalid source edit time')
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat().replace('+00:00', 'Z')


def ids_value(raw):
    value = json_value(raw)
    ids = value['objectIds']
    if (value.get('exceededTransferLimit') or not isinstance(ids, list)
            or any(type(k) is not int or k < 0 for k in ids) or len(set(ids)) != len(ids)):
        raise ValueError('Incomplete or invalid ID snapshot')
    return sorted(ids)


def ids_parser(raw):
    return {'records': {str(k): digest(k) for k in ids_value(raw)}}


def metadata_parser(raw):
    value = json_value(raw)
    # Entire metadata is hashed so schema/domains/terms drift is reviewable.
    return {'records': {'metadata': digest(value)},
            'sourceTimes': {'metadata': {'modifiedAtUtc': source_time(
                (value.get('editingInfo') or {}).get('lastEditDate'))}}}


def license_parser(raw):
    value = json_value(raw)
    return {'records': {'license': digest(value)},
            'sourceTimes': {'license': {'modifiedAtUtc': source_time(value.get('modified'))}}}


def query_url(layer, selection, **extra):
    return layer + '/query?' + urllib.parse.urlencode(dict(selection, f='json', **extra))


class Body(io.BytesIO):
    status = 200
    headers = {}


class ComponentFailure(Exception):
    def __init__(self, component, failure_type):
        self.component, self.failure_type = component, failure_type


class Components:
    def __init__(self, source, transport, previous, retrieved_at, now_seconds, clock, sleeper,
                 parser_version, schema_version):
        self.source, self.transport = source, transport
        self.previous = (previous or {}).get('components', {})
        if previous:
            if set(self.previous) != set(previous.get('componentHashes', {})):
                raise ValueError('Aggregate component key set is incomplete')
            for key, component in self.previous.items():
                validate_observation(component)
                if previous.get('componentHashes', {}).get(key) != component['contentSha256']:
                    raise ValueError('Component differs from aggregate identity')
        self.observations, self.records, self.times = {}, {}, {}
        self.retrieved_at, self.now_seconds = retrieved_at, now_seconds
        self.clock, self.sleeper, self.last_started = clock, sleeper, None
        self.parser_version, self.schema_version = parser_version, schema_version
        self.budget = {'deadline': clock() + source['fetchLimits']['timeoutSeconds'],
                       'remainingBytes': source['fetchLimits']['maxBytes']}

    def get(self, name, url, parser, accept='application/json'):
        limits = self.source['fetchLimits']
        if len(self.observations) >= limits['maxRequestsPerRun'] or name in self.observations:
            raise ValueError('Request budget or component name violated')
        if self.last_started is not None:
            delay = limits['minRequestIntervalSeconds'] - (self.clock() - self.last_started)
            if delay > 0:
                if self.clock() + delay >= self.budget['deadline']:
                    raise TimeoutError('Request interval exceeds run budget')
                self.sleeper(delay)
            if self.clock() - self.last_started + 1e-6 < limits['minRequestIntervalSeconds']:
                raise TimeoutError('Request interval was not honored')
        self.last_started = self.clock()
        leaf = dict(self.source, sourceId=self.source['sourceId'] + ':' + name, url=url, accept=accept)
        result = observe(leaf, transport=self.transport, parser=parser, parser_version=self.parser_version,
                         schema_version=self.schema_version, retrieved_at_utc=self.retrieved_at, now_seconds=self.now_seconds,
                         previous=self.previous.get(name), budget=self.budget, monotonic=self.clock)
        if result['status'] not in ('candidate', 'no-change'):
            raise ComponentFailure(name, result.get('failureType', 'ValueError'))
        observation = result['observation']
        self.observations[name] = observation
        self.records.update({name + ':' + key: value for key, value in observation['records'].items()})
        if 'sourceTimes' in observation:
            self.times[name] = observation['sourceTimes']
        return observation['records']


def arcgis_layer(parts, name, layer, selection, id_field='OBJECTID', aliases=None,
                 out_fields='*', allowed_ids=None):
    """ID snapshot/bounded ID batches/repeated snapshot; no offset race or partial set."""
    metadata = parts.get(name + '-metadata', layer + '?f=json', metadata_parser)
    ids = parts.get(name + '-before', query_url(layer, selection, returnIdsOnly='true'), ids_parser)
    expected = sorted(map(int, ids))
    if allowed_ids is not None and not set(expected).issubset(allowed_ids):
        raise ValueError('Source selection exceeds manifest scope')
    if len(expected) > parts.source['fetchLimits']['maxFeatures']:
        raise ValueError('Feature budget exceeded')
    size = parts.source['fetchLimits']['batchSize']
    for offset in range(0, len(expected), size):
        batch = expected[offset:offset + size]
        def parse(raw, batch=batch):
            value = json_value(raw)
            features = value['features']
            sr = value.get('spatialReference', {})
            if (value.get('exceededTransferLimit') or not isinstance(features, list)
                    or sr.get('latestWkid', sr.get('wkid')) != 4326):
                raise ValueError('Incomplete or non-WGS84 feature query')
            records, actual = {}, []
            for feature in features:
                object_id = feature['attributes'][id_field]
                if type(object_id) is not int or object_id not in batch or object_id in actual:
                    raise ValueError('Invalid or duplicate feature')
                # Values are transient; only hashes persist, including access/status changes.
                canonical(feature)
                actual.append(object_id)
                record_id = aliases.get(object_id, str(object_id)) if aliases else str(object_id)
                records[record_id] = digest(feature)
            if sorted(actual) != batch:
                raise ValueError('Batch is incomplete')
            return {'records': records}
        # objectIds takes the batch; the ID query already pins the geographic/attribute selection.
        url = query_url(layer, {}, objectIds=','.join(map(str, batch)), outFields=out_fields,
                        returnGeometry='true', outSR='4326')
        records = parts.get(name + '-page-' + str(offset), url, parse)
        # Pagination components carry transient offsets, aggregate feature IDs do not.
        for key in records:
            del parts.records[name + '-page-' + str(offset) + ':' + key]
        parts.records.update({name + ':' + key: value for key, value in records.items()})
    after = parts.get(name + '-after', query_url(layer, selection, returnIdsOnly='true'), ids_parser)
    if after != ids:
        raise ValueError('Source selection changed during fetch')
    if parts.get(name + '-metadata-after', layer + '?f=json', metadata_parser) != metadata:
        raise ValueError('Source schema/edit metadata changed during fetch')
    # Snapshot ID sets are completeness checks, not duplicate feature records.
    for prefix in (name + '-before:', name + '-after:'):
        parts.records = {k: v for k, v in parts.records.items() if not k.startswith(prefix)}


def osm_way_parser(way_id):
    def parse(raw):
        if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
            raise ValueError('XML entities are unsupported')
        root = ET.fromstring(raw)
        if root.tag != 'osm' or len(root.findall('way')) != 1:
            raise ValueError('Incomplete OSM way response')
        way = root.find('way')
        if int(way.attrib['id']) != way_id:
            raise ValueError('Unexpected OSM way')
        nodes = {}
        for node in root.findall('node'):
            node_id = node.attrib['id']
            if node_id in nodes:
                raise ValueError('Duplicate OSM node')
            point = [float(node.attrib['lon']), float(node.attrib['lat'])]
            if any(not math.isfinite(x) for x in point) or abs(point[0]) > 180 or abs(point[1]) > 90:
                raise ValueError('Invalid OSM geometry')
            nodes[node_id] = point
        tags = {}
        for tag in way.findall('tag'):
            key = tag.attrib['k']
            if key in tags:
                raise ValueError('Duplicate OSM tag')
            tags[key] = tag.attrib['v']
        paths = [nodes[nd.attrib['ref']] for nd in way.findall('nd')]
        if len(paths) < 2 or int(way.attrib['version']) <= 0:
            raise ValueError('Incomplete OSM geometry/version')
        modified = utc_timestamp(way.attrib['timestamp'])
        value = dict(version=int(way.attrib['version']), paths=paths, tags=tags)
        return {'records': {f'verified-osm:way:{way_id}': digest(value)},
                'sourceTimes': {str(way_id): {'modifiedAtUtc': modified}}}
    return parse


def overpass_parser(raw):
    value = json_value(raw)
    timestamp = utc_timestamp(value['osm3s']['timestamp_osm_base'])
    records = {}
    for way in value['elements']:
        if way.get('type') != 'way' or type(way.get('id')) is not int or way['id'] <= 0:
            raise ValueError('Invalid or duplicate Overpass way')
        # Do not filter prohibited ways out: tag changes themselves require review.
        if way.get('tags', {}).get('highway') != 'service':
            raise ValueError('Unexpected Overpass selection')
        if not isinstance(way.get('geometry'), list) or len(way['geometry']) < 2:
            raise ValueError('Incomplete Overpass geometry')
        record_id = f'osm:way:{way["id"]}'
        if record_id in records:
            raise ValueError('Duplicate Overpass way')
        records[record_id] = digest({'tags': way['tags'], 'geometry': way['geometry']})
    return {'records': records, 'sourceTimes': {'osmBase': {'snapshotAtUtc': timestamp}}}


class NoticeHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.text, self.title, self.published = [], [], [], None
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta' and attrs.get('property') == 'article:published_time':
            published = datetime.fromisoformat(attrs['content'].replace('Z', '+00:00'))
            if published.tzinfo is not None:
                self.published = published.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
        if tag not in ('meta', 'link', 'img', 'br', 'hr', 'input', 'source', 'wbr', 'area', 'base', 'embed', 'param', 'track', 'col'):
            self.stack.append(tag)
    def handle_endtag(self, tag):
        if tag in self.stack:
            self.stack = self.stack[:len(self.stack) - 1 - self.stack[::-1].index(tag)]
    def handle_data(self, data):
        if any(tag in self.stack for tag in ('script', 'style', 'nav', 'footer', 'header')):
            return
        text = ' '.join(data.split())
        if 'title' in self.stack:
            self.title.append(text)
        if 'main' in self.stack or 'article' in self.stack:
            self.text.append(text)


def notice_parser(source):
    def parse(raw):
        page = NoticeHTML()
        page.feed(raw.decode('utf-8-sig'))
        title, body = ' '.join(page.title), ' '.join(page.text)
        if (not title or len(body) < 40 or any(token in title.lower() for token in
                ('access denied', 'not found', 'captcha', 'just a moment'))
                or not any(token.lower() in (title + ' ' + body).lower()
                           for token in source['noticeKeywords'])):
            raise ValueError('Notice article/layout not verified')
        return {'records': {source['noticeId']: digest({'title': title, 'body': body})},
                'sourceTimes': {'notice': {'publishedAtUtc': page.published}}}
    return parse


def arcgis_notice_parser(source):
    def parse(raw):
        value = json_value(raw)
        if value.get('exceededTransferLimit') or not isinstance(value.get('features'), list):
            raise ValueError('Incomplete notice query')
        records = {}
        for feature in value['features']:
            object_id = feature['attributes']['OBJECTID']
            record_id = 'road-closure:' + str(object_id)
            if type(object_id) is not int or object_id not in source['noticeObjectIds'] or record_id in records:
                raise ValueError('Unreviewed or duplicate notice object')
            records[record_id] = digest(feature)
        return {'records': records}
    return parse


def observe_adapter(source, *, transport, manifest, retrieved_at_utc, now_seconds,
                    previous=None, accepted=None, directory=None, monotonic=time.monotonic,
                    sleeper=time.sleep, parser_version='adapter-1', schema_version=1, capacity=None):
    """Whole-run candidate; any failed component discards all new observations.

    Reads approved-source shapes with synthetic/replayed transport by default at
    call sites. Caller must separately authorize real transport; no approval implied.
    """
    failure = dict(schemaVersion=1, sourceId=source['sourceId'], status='failed',
                   staleEvidence=True, candidate=None, requiresReview=True,
                   retrievedAtUtc=retrieved_at_utc,
                   acceptedSnapshotId=(accepted or {}).get('candidateId'))
    try:
        effective = dict(source, adapterManifestSha256=digest(manifest),
                         adapterParserVersion=parser_version, adapterSchemaVersion=schema_version)
        if previous:
            validate_observation(previous)
        roots = {'county-trails': COUNTY + '8?f=json', 'county-addresses': COUNTY + '0?f=json',
                 'tiger-access-roads': TIGER + '?f=json', 'osm-reviewed-paths': OSM,
                 'osm-service-roads': OVERPASS}
        if source['adapter'] in roots and source['url'] != roots[source['adapter']]:
            raise ValueError('Registry endpoint differs from established source')
        parts = Components(effective, transport, previous, retrieved_at_utc, now_seconds, monotonic,
                           sleeper, parser_version, schema_version)
        adapter = source['adapter']
        if adapter == 'county-trails':
            if manifest['licensedSourceUrl'] != COUNTY + '8':
                raise ValueError('Unreviewed county layer')
            item_url = manifest['licenseEvidenceUrl']
            expected_item = 'https://www.arcgis.com/sharing/rest/content/items/' + manifest['licensedItemId'] + '?f=json'
            if item_url != expected_item or manifest['licensedItemId'] != 'a2a54b1f94704061abc90686fbc5c220':
                raise ValueError('Unreviewed licence evidence endpoint')
            parts.get('license', item_url, license_parser)
            aliases = {e['objectId']: f'{e["selectionLayerId"]}:{e["objectId"]}' for e in manifest['features']}
            if len(aliases) != len(manifest['features']):
                raise ValueError('Duplicate manifest IDs')
            selection = {'objectIds': ','.join(map(str, sorted(aliases)))}
            fields = 'OBJECTID,FACILITYID,NAME,LENGTH,SURFTYPE,loc,facilitytype,activitytype,systemname'
            arcgis_layer(parts, 'licensed', COUNTY + '8', selection, aliases=aliases,
                         allowed_ids=set(aliases), out_fields=fields)
            for layer_id in (54, 16):
                ids = sorted(e['objectId'] for e in manifest['features'] if e['selectionLayerId'] == layer_id)
                arcgis_layer(parts, 'operational-' + str(layer_id), SELECTION + str(layer_id),
                             {'objectIds': ','.join(map(str, ids))}, aliases=aliases,
                             allowed_ids=set(ids), out_fields=fields + ',status')
        elif adapter == 'county-addresses':
            if manifest['source']['service']['url'] != COUNTY + '0':
                raise ValueError('Unreviewed address layer')
            fields = ','.join(manifest['source']['service']['fields'])
            if fields != 'OBJECTID_1,ADDRESS,Building,Unit,Post_Comm,Post_Code,Inc_Muni,County,State':
                raise ValueError('Unreviewed address fields')
            arcgis_layer(parts, 'addresses', COUNTY + '0', {'where': '1=1'},
                         id_field='OBJECTID_1', out_fields=fields)
        elif adapter == 'tiger-access-roads':
            selection = dict(where="MTFCC IN ('" + "','".join(CLASSES) + "')",
                             geometry=','.join(map(str, BBOX)), geometryType='esriGeometryEnvelope',
                             inSR='4326', spatialRel='esriSpatialRelIntersects')
            if manifest['sourceInput']['boundingBoxWgs84'] != BBOX:
                raise ValueError('Unreviewed access-road bounds')
            arcgis_layer(parts, 'tiger', TIGER, selection,
                         out_fields='OBJECTID,OID,NAME,BASENAME,MTFCC,RTTYP')
        elif adapter == 'osm-reviewed-paths':
            for entry in sorted(manifest['features'], key=lambda entry: entry['wayId']):
                way_id = entry['wayId']
                if type(way_id) is not int or way_id <= 0:
                    raise ValueError('Invalid reviewed way')
                parts.get('way-' + str(way_id), OSM + str(way_id) + '/full',
                          osm_way_parser(way_id), accept='application/xml')
        elif adapter == 'osm-service-roads':
            if manifest['sourceInput']['boundingBoxWgs84'] != BBOX:
                raise ValueError('Unreviewed access-road bounds')
            query = '[out:json][timeout:15];way["highway"="service"](40.4,-89.2,40.6,-88.9);out tags geom;'
            parts.get('service', OVERPASS + '?data=' + urllib.parse.quote(query, safe=''), overpass_parser)
        elif adapter in ('official-notice', 'arcgis-notice'):
            entries = [entry for entry in manifest['sources'] if entry['sourceId'] == source['sourceId']]
            if len(entries) != 1 or entries[0]['url'] != source['url']:
                raise ValueError('Unreviewed notice endpoint')
            if adapter == 'official-notice':
                parts.get('notice', source['url'], notice_parser(source), accept='text/html')
            else:
                parts.get('notice', source['url'], arcgis_notice_parser(source))
        else:
            raise ValueError('Unknown source adapter')
        envelope = {'records': parts.records,
                    'componentHashes': {k: v['contentSha256'] for k, v in parts.observations.items()},
                    'sourceTimes': parts.times}
        body = canonical(envelope)
        result = observe(effective, transport=lambda *args: Body(body),
                         parser=lambda raw: json.loads(raw), parser_version='aggregate-' + parser_version,
                         schema_version=schema_version,
                         retrieved_at_utc=retrieved_at_utc, now_seconds=now_seconds,
                         previous=previous, accepted=accepted, directory=directory,
                         monotonic=monotonic, capacity=capacity)
        if 'observation' in result:
            result['observation']['components'] = parts.observations
        return result
    except Exception as error:
        if isinstance(error, ComponentFailure):
            return dict(failure, failureType=error.failure_type, failedComponent=error.component)
        return dict(failure, failureType=type(error).__name__)
