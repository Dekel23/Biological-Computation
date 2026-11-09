import io
import json
import sys
import zipfile
from datetime import datetime
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from chat_parser import (  # noqa: E402
    ChatParseError,
    build_transcript,
    compute_stats,
    load_upload,
    parse_chat,
)


def test_sample_chat_android_hebrew():
    text = (ROOT / "sample_chat.txt").read_text(encoding="utf-8")
    chat = parse_chat(text)
    authors = {m.author for m in chat.messages}
    assert authors == {"נועה", "איתי", "מאיה", "עומר", "דניאל"}
    # System lines (encryption notice, "created group") are skipped.
    assert all("מוצפנות" not in m.text for m in chat.messages)

    stats = compute_stats(chat)
    by = {m["name"]: m for m in stats["members"]}
    assert stats["total_messages"] == len(chat.messages)
    assert by["דניאל"]["media"] == 4
    assert by["דניאל"]["deleted"] == 1
    assert by["עומר"]["night_messages"] == 5
    assert stats["first_date"] == "2025-03-01"
    assert stats["last_date"] == "2025-03-22"
    assert sum(stats["hours"]) == stats["total_messages"]
    assert {a["key"] for a in stats["awards"]} >= {"chatterbox", "night_owl", "photographer"}


def test_multiline_message_is_joined():
    text = "01/02/2024, 10:00 - Dana: first line\nsecond line\n01/02/2024, 10:01 - Avi: hi"
    chat = parse_chat(text)
    assert [m.text for m in chat.messages] == ["first line\nsecond line", "hi"]


def test_ios_format_with_lrm_and_system_lines():
    text = (
        "‎[12/31/23, 9:15:42 PM] Family: ‎Messages and calls are end-to-end encrypted.\n"
        "[12/31/23, 9:16:00 PM] Dana: Happy new year!\n"
        "[12/31/23, 9:17:00 PM] Avi: ‎image omitted\n"
        "‎[12/31/23, 9:18:00 PM] Family: ‎Dana added Avi\n"
    )
    chat = parse_chat(text)
    assert [m.author for m in chat.messages] == ["Dana", "Avi"]
    assert chat.messages[0].timestamp == datetime(2023, 12, 31, 21, 16, 0)
    assert chat.messages[1].is_media


def test_month_first_detection():
    text = "3/14/24, 08:00 - A: pi day\n3/15/24, 08:00 - B: ok"
    chat = parse_chat(text)
    assert chat.messages[0].timestamp == datetime(2024, 3, 14, 8, 0)


def test_twelve_hour_am():
    text = "1/1/24, 12:05 AM - A: midnight\n1/1/24, 12:05 PM - A: noon"
    chat = parse_chat(text)
    assert [m.timestamp.hour for m in chat.messages] == [0, 12]


def test_telegram_json():
    data = {
        "name": "Crew",
        "messages": [
            {"type": "service", "actor": "Dana", "action": "create_group"},
            {"type": "message", "from": "Dana", "date": "2024-05-01T23:30:00", "text": "hey"},
            {"type": "message", "from": "Avi", "date": "2024-05-01T23:31:00",
             "text": ["look ", {"type": "link", "text": "https://x.y"}]},
            {"type": "message", "from": "Avi", "date": "2024-05-01T23:32:00", "photo": "p.jpg", "text": ""},
        ],
    }
    chat = parse_chat(json.dumps(data))
    assert chat.source == "telegram"
    assert chat.group_name == "Crew"
    assert [m.text for m in chat.messages][:2] == ["hey", "look https://x.y"]
    assert chat.messages[2].is_media


def test_zip_upload_prefers_chat_txt():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("_chat.txt", "[1/1/24, 10:00:00] A: hi\n")
        zf.writestr("notes.txt", "x" * 1000)
    text, hint = load_upload(buf.getvalue(), "WhatsApp Chat - The Gang.zip")
    assert text.startswith("[1/1/24")
    assert hint == "The Gang"


def test_garbage_raises():
    with pytest.raises(ChatParseError):
        parse_chat("just some text\nwith no chat lines")


def test_transcript_keeps_most_recent_within_budget():
    lines = [f"01/01/2024, 10:{i:02d} - A: message {i}" for i in range(50)]
    chat = parse_chat("\n".join(lines))
    transcript, included = build_transcript(chat, max_chars=300)
    assert 0 < included < 50
    assert transcript.endswith("message 49")
    assert len(transcript) <= 300
