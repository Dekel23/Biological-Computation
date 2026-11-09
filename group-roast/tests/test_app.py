import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import app as appmod  # noqa: E402

SAMPLE = (ROOT / "sample_chat.txt").read_text(encoding="utf-8")


def _fake_roast(*args, **kwargs):
    yield {"type": "progress", "phase": "thinking"}
    yield {"type": "result", "roast": {"members": []}}


def _events(resp):
    return [json.loads(line) for line in resp.get_data(as_text=True).splitlines() if line.strip()]


def test_access_code_required(monkeypatch):
    monkeypatch.setattr(appmod, "ACCESS_CODE", "secret")
    monkeypatch.setattr(appmod, "stream_roast", _fake_roast)
    client = appmod.app.test_client()

    assert client.get("/api/config").get_json()["access_code_required"] is True
    bad = client.post("/api/roast", data={"text": SAMPLE, "access_code": "nope"})
    assert bad.status_code == 401
    good = client.post("/api/roast", data={"text": SAMPLE, "access_code": "secret"})
    assert good.status_code == 200
    assert [e["type"] for e in _events(good)] == ["stats", "progress", "result"]


def test_no_access_code_is_open(monkeypatch):
    monkeypatch.setattr(appmod, "ACCESS_CODE", "")
    monkeypatch.setattr(appmod, "stream_roast", _fake_roast)
    client = appmod.app.test_client()
    assert client.get("/api/config").get_json()["access_code_required"] is False
    assert client.post("/api/roast", data={"text": SAMPLE}).status_code == 200


def test_daily_limit(monkeypatch):
    monkeypatch.setattr(appmod, "ACCESS_CODE", "")
    monkeypatch.setattr(appmod, "DAILY_ROAST_LIMIT", 2)
    monkeypatch.setattr(appmod, "_usage", {"day": "", "count": 0})
    monkeypatch.setattr(appmod, "stream_roast", _fake_roast)
    client = appmod.app.test_client()
    codes = [client.post("/api/roast", data={"text": SAMPLE}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_heartbeat_pings_while_quiet():
    def slow():
        time.sleep(0.35)
        yield {"type": "result"}

    events = list(appmod.with_heartbeat(slow, interval=0.1))
    assert events[-1] == {"type": "result"}
    assert events.count({"type": "ping"}) >= 2


def test_heartbeat_reraises_errors():
    def broken():
        yield {"type": "progress"}
        raise ValueError("boom")

    gen = appmod.with_heartbeat(broken, interval=1)
    assert next(gen) == {"type": "progress"}
    try:
        next(gen)
    except ValueError as exc:
        assert str(exc) == "boom"
    else:
        raise AssertionError("expected ValueError")
