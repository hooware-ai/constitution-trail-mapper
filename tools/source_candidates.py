"""Offline-first source observation; candidates never admit data or mutate approvals."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


def utc_timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Expected UTC source time")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset().total_seconds() != 0:
        raise ValueError("Expected UTC source time")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def validate_source(source):
    for key in ("sourceId", "url", "geographicScope", "license", "termsUrl",
                "expectedUpdateCadence", "reviewOwner", "limitations", "manifestPath"):
        if not source.get(key):
            raise ValueError(f"Missing registry field: {key}")
    url = urllib.parse.urlsplit(source["url"])
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.fragment:
        raise ValueError("Source requires an exact HTTPS URL without credentials")
    limits = source["fetchLimits"]
    for key in ("timeoutSeconds", "maxBytes", "minIntervalSeconds"):
        value = limits[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"Invalid fetch limit: {key}")
    if limits["maxBytes"] != int(limits["maxBytes"]):
        raise ValueError("maxBytes must be integral")
    for key in ("maxRequestsPerRun", "maxFeatures", "batchSize"):
        if key in limits and (type(limits[key]) is not int or limits[key] <= 0):
            raise ValueError(f"Invalid fetch limit: {key}")
    if "minRequestIntervalSeconds" in limits:
        interval = limits["minRequestIntervalSeconds"]
        if type(interval) not in (int, float) or not math.isfinite(interval) or interval < 0:
            raise ValueError("Invalid request interval")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Redirect requires source review")


def https_transport(url, headers, timeout):
    """Explicitly injected only after execution approval; no retries or redirects."""
    opener = urllib.request.build_opener(NoRedirect())
    try:
        response = opener.open(urllib.request.Request(url, headers=headers), timeout=timeout)
        # urllib's HTTPS response exposes the underlying socket through its raw
        # buffered stream. Fail closed if an alternate handler cannot bound reads.
        response.set_read_timeout = lambda remaining: response.fp.raw._sock.settimeout(remaining)
        return response
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return error
        raise


def read_bounded(response, limits, deadline, monotonic=time.monotonic):
    chunks, total = [], 0
    length = response.headers.get("Content-Length")
    if length is not None and (not str(length).isdigit() or int(length) > limits["maxBytes"]):
        raise ValueError("Invalid or oversized source response length")
    while True:
        if monotonic() >= deadline:
            raise TimeoutError("Fetch deadline exceeded")
        # A completed HTTPResponse may already have closed its buffered socket.
        if length is not None and total == int(length):
            return b"".join(chunks)
        if hasattr(response, "set_read_timeout"):
            response.set_read_timeout(deadline - monotonic())
        # read1 does not wait to fill a large buffer when a peer drips data.
        reader = getattr(response, "read1", response.read)
        chunk = reader(min(65536, int(limits["maxBytes"]) + 1 - total))
        if monotonic() >= deadline:
            raise TimeoutError("Fetch deadline exceeded")
        if not chunk:
            if length is not None and (not str(length).isdigit() or total != int(length)):
                raise ValueError("Incomplete source response")
            return b"".join(chunks)
        total += len(chunk)
        if total > limits["maxBytes"]:
            raise ValueError("Response exceeds byte limit")
        chunks.append(chunk)


def fsync_directory(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable_directory(directory):
    directory = Path(directory)
    if not directory.exists():
        durable_directory(directory.parent)
        directory.mkdir(exist_ok=True)
        fsync_directory(directory.parent)


def record_diff(records, baseline):
    return {"added": sorted(records.keys() - baseline.keys()),
            "removed": sorted(baseline.keys() - records.keys()),
            "changed": sorted(k for k in records.keys() & baseline.keys() if records[k] != baseline[k])}


def validate_candidate(candidate):
    identity = candidate["identity"]
    if (candidate["schemaVersion"] != 1 or candidate["requiresReview"] is not True
            or candidate["sourceId"] != identity["sourceId"]
            or candidate["candidateId"] != digest(identity)
            or digest(candidate["records"]) != identity["parsedSha256"]):
        raise ValueError("Candidate integrity failed")
    provenance = {k: v for k, v in candidate.items() if k != "provenanceSha256"}
    if digest(provenance) != candidate.get("provenanceSha256"):
        raise ValueError("Candidate provenance integrity failed")
    utc_timestamp(candidate["retrievedAtUtc"])
    if candidate["sourcePublishedAtUtc"] is not None:
        utc_timestamp(candidate["sourcePublishedAtUtc"])
    diff = candidate["diff"]
    if set(diff) != {"added", "removed", "changed"}:
        raise ValueError("Invalid candidate diff")
    for values in diff.values():
        if not isinstance(values, list) or values != sorted(set(values)):
            raise ValueError("Invalid candidate diff order")


def read_document(path, document_id, id_key, validate):
    if not isinstance(document_id, str) or not re.fullmatch(r"[0-9a-f]{64}", document_id):
        raise ValueError("Invalid persisted document ID")
    document = json.loads(Path(path).read_bytes())
    validate(document)
    if document[id_key] != document_id:
        raise ValueError("Persisted document differs from filename")
    return document


def load_candidate(directory, candidate_id, identity=None):
    candidate = read_document(Path(directory) / (candidate_id + ".json"),
                              candidate_id, "candidateId", validate_candidate)
    if identity is not None and candidate["identity"] != identity:
        raise ValueError("Candidate differs from observation")
    return candidate


def immutable_document(directory, document, id_key, validate, capacity=None):
    """Publish complete immutable bytes and durably sync the containing directory."""
    validate(document)
    directory = Path(directory)
    durable_directory(directory)
    document_id = document[id_key]
    target = directory / (document_id + ".json")
    if target.exists():
        read_document(target, document_id, id_key, validate)
        fsync_directory(directory)
        return target
    payload = canonical(document) + b"\n"
    if capacity is not None:
        capacity(directory, target, len(payload))
    import tempfile
    fd, name = tempfile.mkstemp(dir=directory)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(name, target)
        except FileExistsError:
            read_document(target, document_id, id_key, validate)
    finally:
        os.unlink(name)
        # This flushes the published link and temporary-name removal. A failed
        # directory sync never returns a successful candidate to durable state.
        fsync_directory(directory)
    return target


def immutable_write(directory, snapshot, capacity=None):
    return immutable_document(directory, snapshot, "candidateId", validate_candidate, capacity)


def validate_observation(observation):
    identity = {key: observation[key] for key in
                ("sourceId", "sourceUrl", "registrySha256", "contentSha256",
                 "parsedSha256", "parserVersion", "sourceSchemaVersion")}
    for key in ("componentHashes", "sourceTimes"):
        if key in observation:
            identity[key] = observation[key]
    if (digest(observation["records"]) != identity["parsedSha256"]
            or digest(identity) != observation["candidateId"]):
        raise ValueError("Observation integrity failed")
    if "componentHashes" in observation:
        components = observation.get("components")
        if not isinstance(components, dict) or set(components) != set(identity["componentHashes"]):
            raise ValueError("Aggregate component key set differs from identity")
        for key, component in components.items():
            validate_observation(component)
            if (component["sourceId"] != observation["sourceId"] + ":" + key
                    or component["contentSha256"] != identity["componentHashes"][key]):
                raise ValueError("Aggregate component integrity failed")
    return identity


def validator(value):
    if value is None:
        return None
    if (not isinstance(value, str) or len(value) > 1024
            or any(ord(char) < 32 or ord(char) > 126 for char in value)):
        raise ValueError("Invalid conditional validator")
    return value


def observe(source, *, transport, parser, parser_version, schema_version,
            retrieved_at_utc, now_seconds, previous=None, accepted=None,
            last_attempt_seconds=None, directory=None, budget=None, monotonic=time.monotonic, capacity=None):
    """Return status/candidate/observation. Caller persists rate state even on failure.

    parser returns {records: {stable ID: SHA256}, sourcePublishedAtUtc: optional}.
    No raw body, location, history, arbitrary attributes or response headers persist.
    previous is the last successful observation; accepted is review-owned and read-only.
    """
    validate_source(source)
    result = {"schemaVersion": 1, "sourceId": source["sourceId"],
              "retrievedAtUtc": retrieved_at_utc, "attemptedAtSeconds": now_seconds,
              "acceptedSnapshotId": (accepted or {}).get("candidateId"),
              "staleEvidence": False, "candidate": None}
    if last_attempt_seconds is not None and now_seconds - last_attempt_seconds < source["fetchLimits"]["minIntervalSeconds"]:
        return dict(result, status="rate-limited", staleEvidence=True)
    try:
        utc_timestamp(retrieved_at_utc)
        if transport is https_transport and source.get("executionApproved") is not True:
            raise PermissionError("Production source execution is disabled")
        if previous:
            validate_observation(previous)
            if directory is not None:
                load_candidate(directory, previous["candidateId"], validate_observation(previous))
            if previous["sourceId"] != source["sourceId"]:
                raise ValueError("Observation belongs to another source")
        headers = {"Accept": source.get("accept", "application/json"),
                   "User-Agent": "ConstitutionTrailMapperSourceReview/1.0"}
        if (previous and previous.get("sourceUrl") == source["url"]
                and previous.get("parserVersion") == parser_version
                and previous.get("sourceSchemaVersion") == schema_version
                and previous.get("registrySha256") == digest(source)):
            for key, header in (("etag", "If-None-Match"), ("lastModified", "If-Modified-Since")):
                if previous.get(key):
                    headers[header] = validator(previous[key])
        deadline = (budget["deadline"] if budget is not None else
                    monotonic() + source["fetchLimits"]["timeoutSeconds"])
        timeout = min(source["fetchLimits"]["timeoutSeconds"], deadline - monotonic())
        if timeout <= 0:
            raise TimeoutError("Fetch deadline exceeded")
        with transport(source["url"], headers, timeout) as response:
            if monotonic() >= deadline:
                raise TimeoutError("Fetch deadline exceeded")
            status = response.status if hasattr(response, "status") else response.code
            if status == 304:
                if not previous or previous.get("sourceUrl") != source["url"]:
                    raise ValueError("304 has no verified baseline")
                # Cached raw evidence cannot be reparsed by this minimal-evidence store.
                if (previous["parserVersion"] != parser_version
                        or previous["sourceSchemaVersion"] != schema_version
                        or previous.get("registrySha256") != digest(source)):
                    raise ValueError("Parser/schema changed: unconditional fetch required")
                return dict(result, status="no-change", observation=previous)
            if status != 200:
                raise ValueError("Unexpected source status")
            limits = dict(source["fetchLimits"])
            if budget is not None:
                limits["maxBytes"] = min(limits["maxBytes"], budget["remainingBytes"])
            raw = read_bounded(response, limits, deadline, monotonic)
            if budget is not None:
                budget["remainingBytes"] -= len(raw)
            parsed = parser(raw)
            published = parsed.get("sourcePublishedAtUtc")
            if published is not None:
                published = utc_timestamp(published)
            records = parsed["records"]
            if not isinstance(records, dict) or any(not isinstance(k, str) or not isinstance(v, str) or not re.fullmatch(r"[0-9a-f]{64}", v) for k, v in records.items()):
                raise ValueError("Parser must return stable IDs and SHA256 hashes")
            identity = {"sourceId": source["sourceId"], "sourceUrl": source["url"],
                        "registrySha256": digest(source), "contentSha256": hashlib.sha256(raw).hexdigest(),
                        "parsedSha256": digest(records), "parserVersion": parser_version,
                        "sourceSchemaVersion": schema_version}
            for key in ("componentHashes", "sourceTimes"):
                if key in parsed:
                    identity[key] = parsed[key]
            observation = dict(identity, records=records,
                               etag=validator(response.headers.get("ETag")),
                               lastModified=validator(response.headers.get("Last-Modified")))
            baseline = (previous or {}).get("records", {})
            diff = record_diff(records, baseline)
            candidate = {"schemaVersion": 1, "candidateId": digest(identity), "identity": identity,
                         "sourceId": source["sourceId"], "retrievedAtUtc": retrieved_at_utc,
                         "sourcePublishedAtUtc": published,
                         "reviewedOn": source.get("reviewedOn"), "manifestPath": source["manifestPath"],
                         "parentCandidateId": (previous or {}).get("candidateId"),
                         "records": records, "diff": diff, "requiresReview": True}
            candidate["provenanceSha256"] = digest(candidate)
            observation["candidateId"] = candidate["candidateId"]
            if previous and previous.get("candidateId") == candidate["candidateId"]:
                return dict(result, status="no-change", observation=observation)
            if directory is not None:
                immutable_write(directory, candidate, capacity)
                candidate = load_candidate(directory, candidate["candidateId"], identity)
            return dict(result, status="candidate", candidate=candidate, observation=observation,
                        runDiff=diff, parentCandidateId=(previous or {}).get("candidateId"))
    except Exception as error:
        # No source exception text or body persists (may contain sensitive input).
        return dict(result, status="failed", staleEvidence=True, failureType=type(error).__name__)
