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


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Redirect requires source review")


def https_transport(url, headers, timeout):
    """Explicitly injected only after execution approval; no retries or redirects."""
    opener = urllib.request.build_opener(NoRedirect())
    try:
        return opener.open(urllib.request.Request(url, headers=headers), timeout=timeout)
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return error
        raise


def read_bounded(response, limits, deadline, monotonic=time.monotonic):
    chunks, total = [], 0
    while True:
        if monotonic() >= deadline:
            raise TimeoutError("Fetch deadline exceeded")
        chunk = response.read(min(65536, int(limits["maxBytes"]) + 1 - total))
        if monotonic() >= deadline:
            raise TimeoutError("Fetch deadline exceeded")
        if not chunk:
            return b"".join(chunks)
        total += len(chunk)
        if total > limits["maxBytes"]:
            raise ValueError("Response exceeds byte limit")
        chunks.append(chunk)


def immutable_write(directory, snapshot):
    """Publish a complete file with no replace; reject any hash-path collision."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (snapshot["candidateId"] + ".json")
    payload = canonical(snapshot) + b"\n"
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
            existing = json.loads(target.read_bytes())
            # Retrieval time may differ; immutable first observation wins.
            if existing["identity"] != snapshot["identity"]:
                raise ValueError("Candidate identity collision")
    finally:
        os.unlink(name)
    return target


def observe(source, *, transport, parser, parser_version, schema_version,
            retrieved_at_utc, now_seconds, previous=None, accepted=None,
            last_attempt_seconds=None, directory=None):
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
    headers = {"Accept": "application/json"}
    if (previous and previous.get("sourceUrl") == source["url"]
            and previous.get("parserVersion") == parser_version
            and previous.get("sourceSchemaVersion") == schema_version
            and previous.get("registrySha256") == digest(source)):
        for key, header in (("etag", "If-None-Match"), ("lastModified", "If-Modified-Since")):
            if previous.get(key):
                headers[header] = previous[key]
    try:
        deadline = time.monotonic() + source["fetchLimits"]["timeoutSeconds"]
        with transport(source["url"], headers, source["fetchLimits"]["timeoutSeconds"]) as response:
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
            raw = read_bounded(response, source["fetchLimits"], deadline)
            parsed = parser(raw)
            records = parsed["records"]
            if not isinstance(records, dict) or any(not isinstance(k, str) or not isinstance(v, str) or not re.fullmatch(r"[0-9a-f]{64}", v) for k, v in records.items()):
                raise ValueError("Parser must return stable IDs and SHA256 hashes")
            identity = {"sourceId": source["sourceId"], "sourceUrl": source["url"],
                        "registrySha256": digest(source), "contentSha256": hashlib.sha256(raw).hexdigest(),
                        "parsedSha256": digest(records), "parserVersion": parser_version,
                        "sourceSchemaVersion": schema_version}
            observation = dict(identity, records=records,
                               etag=response.headers.get("ETag"), lastModified=response.headers.get("Last-Modified"))
            baseline = (previous or {}).get("records", {})
            diff = {"added": sorted(records.keys() - baseline.keys()),
                    "removed": sorted(baseline.keys() - records.keys()),
                    "changed": sorted(k for k in records.keys() & baseline.keys() if records[k] != baseline[k])}
            candidate = {"schemaVersion": 1, "candidateId": digest(identity), "identity": identity,
                         "sourceId": source["sourceId"], "retrievedAtUtc": retrieved_at_utc,
                         "sourcePublishedAtUtc": parsed.get("sourcePublishedAtUtc"),
                         "reviewedOn": source.get("reviewedOn"), "manifestPath": source["manifestPath"],
                         "parentCandidateId": (previous or {}).get("candidateId"),
                         "records": records, "diff": diff, "requiresReview": True}
            observation["candidateId"] = candidate["candidateId"]
            if previous and previous.get("candidateId") == candidate["candidateId"]:
                return dict(result, status="no-change", observation=observation)
            if directory is not None:
                immutable_write(directory, candidate)
            return dict(result, status="candidate", candidate=candidate, observation=observation)
    except Exception as error:
        # No source exception text or body persists (may contain sensitive input).
        return dict(result, status="failed", staleEvidence=True, failureType=type(error).__name__)
