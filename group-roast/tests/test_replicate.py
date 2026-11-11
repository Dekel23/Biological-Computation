import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import replicate  # noqa: E402
from replicate.exceptions import ReplicateError  # noqa: E402

import roaster  # noqa: E402
from chat_parser import build_transcript, compute_stats, parse_chat  # noqa: E402

ANSWER = {
    "group_nickname": "Test", "one_liner": "x", "summary": "a\n\nb", "topics": ["t"],
    "memorable_moments": [{"title": "m", "description": "d"}],
    "members": [{"name": " נועה ", "nickname": "n", "roast": "r", "quote": ""}],
    "awards": [{"title": "A", "winner": "נועה", "reason": "r"}],
    "closing_line": "bye",
}


class FakePrediction:
    """Mimics replicate's Prediction: output grows on each reload()."""

    def __init__(self, text, fail=False):
        self.pieces = [text[i:i + 40] for i in range(0, len(text), 40)]
        self.shown = 0
        self.status = "starting"
        self.output = None
        self.error = "boom" if fail else None
        self.fail = fail
        self.canceled = False

    def reload(self):
        self.shown = min(len(self.pieces), self.shown + 1)
        self.output = self.pieces[: self.shown]
        if self.shown == len(self.pieces):
            self.status = "failed" if self.fail else "succeeded"
        else:
            self.status = "processing"

    def cancel(self):
        self.canceled = True
        self.status = "canceled"


class FakePredictions:
    def __init__(self, owner):
        self.owner = owner

    def create(self, model, input):
        FakeClient.calls.append((model, dict(input)))
        if FakeClient.reject_max_tokens and "max_tokens" in input:
            raise ReplicateError(status=422, detail="input: max_tokens is not allowed")
        text = "Here you go:\n```json\n" + json.dumps(ANSWER, ensure_ascii=False) + "\n```"
        FakeClient.last = FakePrediction(text, fail=FakeClient.fail)
        return FakeClient.last


class FakeClient:
    calls = []
    reject_max_tokens = False
    fail = False
    last = None

    def __init__(self, *a, **kw):
        self.predictions = FakePredictions(self)


@pytest.fixture
def chat_args():
    chat = parse_chat((ROOT / "sample_chat.txt").read_text(encoding="utf-8"))
    stats = compute_stats(chat)
    transcript, included = build_transcript(chat, 300000)
    return stats, transcript, included, [m["name"] for m in stats["members"]]


@pytest.fixture(autouse=True)
def replicate_env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "replicate")
    monkeypatch.setenv("REPLICATE_API_TOKEN", "r8_test")
    monkeypatch.setattr(replicate, "Client", FakeClient)
    monkeypatch.setattr(roaster, "REPLICATE_POLL_SECONDS", 0)
    FakeClient.calls = []
    FakeClient.reject_max_tokens = False
    FakeClient.fail = False


def test_provider_selection(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert roaster.provider() == "replicate"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk")
    assert roaster.provider() == "anthropic"
    monkeypatch.setenv("LLM_PROVIDER", "replicate")
    assert roaster.provider() == "replicate"


def test_replicate_roast(chat_args):
    events = list(roaster.stream_roast(*chat_args, "he", "savage"))
    assert events[0] == {"type": "progress", "phase": "thinking"}
    result = events[-1]
    assert result["type"] == "result"
    roast = result["roast"]
    assert roast["members"][0]["name"] == "נועה"  # snapped back to the chat's spelling
    assert roast["model"] == roaster.REPLICATE_MODEL
    ref, sent = FakeClient.calls[0]
    assert ref == roaster.REPLICATE_MODEL
    assert set(sent) == {"prompt", "system_prompt", "max_tokens"}
    assert "<chat>" in sent["prompt"] and "Reply with only one JSON object" in sent["prompt"]


def test_retries_without_max_tokens(chat_args):
    FakeClient.reject_max_tokens = True
    events = list(roaster.stream_roast(*chat_args))
    assert events[-1]["type"] == "result"
    assert "max_tokens" not in FakeClient.calls[-1][1]


def test_bad_token_message(chat_args, monkeypatch):
    def boom(self, model, input):
        raise ReplicateError(status=401, detail="Unauthenticated")
    monkeypatch.setattr(FakePredictions, "create", boom)
    with pytest.raises(roaster.RoastError, match="Replicate"):
        list(roaster.stream_roast(*chat_args))


def test_model_failure(chat_args):
    FakeClient.fail = True
    with pytest.raises(roaster.RoastError, match="boom"):
        list(roaster.stream_roast(*chat_args))


def test_cancels_when_page_goes_away(chat_args):
    gen = roaster.stream_roast(*chat_args)
    assert next(gen)["phase"] == "thinking"
    next(gen)  # first progress after one poll
    gen.close()  # what the server does when the browser disconnects
    assert FakeClient.last.canceled


def test_broken_json(chat_args, monkeypatch):
    def broken(self, model, input):
        FakeClient.last = FakePrediction('{"members": [')
        return FakeClient.last
    monkeypatch.setattr(FakePredictions, "create", broken)
    with pytest.raises(roaster.RoastError):
        list(roaster.stream_roast(*chat_args))
