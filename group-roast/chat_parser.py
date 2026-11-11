"""Parse group-chat exports (WhatsApp .txt/.zip, Telegram JSON) and compute stats.

Everything here is local and deterministic - no network calls. The stats feed
both the web page (charts, awards) and the prompt sent to Claude.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta

# Invisible direction marks WhatsApp sprinkles around names and system lines.
_INVISIBLE = re.compile("[‎‏‪-‮⁦-⁩﻿]")

# One WhatsApp line header, covering the common Android and iOS layouts:
#   31/12/2023, 21:15 - Name: text           (Android, 24h)
#   12/31/23, 9:15 PM - Name: text            (Android, 12h)
#   [31.12.2023, 21:15:42] Name: text         (iOS)
_LINE = re.compile(
    r"^\[?(?P<date>\d{1,4}[./-]\d{1,2}[./-]\d{1,4}),?\s+"
    r"(?P<time>\d{1,2}:\d{2}(?::\d{2})?)"
    r"(?:[\s  ]*(?P<ampm>[AaPp]\.?\s?[Mm]\.?|לפנה[\"״]צ|אחה[\"״]צ))?"
    r"\]?\s*(?:[-–]\s*)?(?P<rest>.*)$"
)
_AUTHOR = re.compile(r"^(?P<author>[^:\n]{1,60}?):\s(?P<text>.*)$", re.S)

_MEDIA = re.compile(
    r"^<?\s*(media omitted|המדיה (?:לא נכללה|הושמטה)|מדיה הושמטה)\s*>?$"
    r"|^(image|video|audio|sticker|gif|document|contact card|photo) omitted$"
    r"|^(תמונה|סרטון|וידאו|הקלטה|קובץ שמע|סטיקר|מדבקה|gif|מסמך|איש קשר)\s+(הושמט|הושמטה)$"
    r"|^<attached: .+>$"
    r"|\((file attached|קובץ מצורף)\)$",
    re.I,
)
_DELETED = re.compile(
    r"^(this message was deleted|you deleted this message|"
    r"ההודעה (?:הזו )?נמחקה|הודעה זו נמחקה|מחקת את ההודעה הזו)\.?$",
    re.I,
)
_EDITED = re.compile(r"\s*<(?:this message was edited|ההודעה נערכה)>\s*$", re.I)
_LINK = re.compile(r"https?://\S+", re.I)
_LAUGH = re.compile(r"(ח{3,}|(?:ha){2,}|(?:חה){2,}|lol|lmao|😂|🤣|💀)", re.I)
_EMOJI = re.compile(
    "[\U0001F300-\U0001F5FF\U0001F600-\U0001F64F\U0001F680-\U0001F6FF"
    "\U0001F900-\U0001F9FF\U0001FA70-\U0001FAFF☀-⛿✀-➿]"
)
_WORD = re.compile(r"[\w֐-׿']+", re.U)

# A new "conversation" starts after this much silence in the group.
CONVERSATION_GAP = timedelta(hours=3)


@dataclass
class Message:
    timestamp: datetime | None
    author: str
    text: str
    is_media: bool = False
    is_deleted: bool = False


@dataclass
class ParsedChat:
    messages: list[Message]
    source: str  # "whatsapp" | "telegram"
    group_name: str | None = None
    warnings: list[str] = field(default_factory=list)


class ChatParseError(ValueError):
    """Raised when the upload doesn't look like a chat export we understand."""


# --------------------------------------------------------------------------- #
# Loading the upload
# --------------------------------------------------------------------------- #

MAX_UNZIPPED_BYTES = 50 * 1024 * 1024


def load_upload(data: bytes, filename: str | None) -> tuple[str, str | None]:
    """Return (chat text, group-name hint) from an uploaded file's bytes."""
    name = filename or ""
    if name.lower().endswith(".zip") or data[:4] == b"PK\x03\x04":
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile as exc:
            raise ChatParseError("קובץ ה-ZIP פגום או לא נקרא.") from exc
        candidates = [
            i for i in zf.infolist()
            if i.filename.lower().endswith((".txt", ".json")) and not i.is_dir()
        ]
        if not candidates:
            raise ChatParseError("לא נמצא קובץ צ'אט (txt) בתוך ה-ZIP.")
        # iOS names it _chat.txt; otherwise take the biggest text file.
        candidates.sort(key=lambda i: (i.filename.endswith("_chat.txt"), i.file_size), reverse=True)
        info = candidates[0]
        if info.file_size > MAX_UNZIPPED_BYTES:
            raise ChatParseError("קובץ הצ'אט בתוך ה-ZIP גדול מדי.")
        data = zf.read(info)
        hint = _group_name_from_filename(name) or _group_name_from_filename(info.filename)
    else:
        hint = _group_name_from_filename(name)
    return decode_text(data), hint


def decode_text(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16", "cp1255"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _group_name_from_filename(name: str) -> str | None:
    base = re.sub(r"\.(txt|zip|json)$", "", name.rsplit("/", 1)[-1], flags=re.I)
    for pattern in (r"^WhatsApp Chat (?:with|-)\s*(.+)$", r"^צ['׳]אט WhatsApp עם\s*(.+)$"):
        m = re.match(pattern, base, re.I)
        if m:
            return m.group(1).strip() or None
    return None


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #

def parse_chat(text: str, group_name_hint: str | None = None) -> ParsedChat:
    stripped = text.lstrip("﻿ \n\r\t")
    if stripped.startswith("{"):
        try:
            return _parse_telegram(json.loads(stripped), group_name_hint)
        except json.JSONDecodeError:
            pass  # fall through - maybe it's a text export that starts with "{"
    chat = _parse_whatsapp(text, group_name_hint)
    if not chat.messages:
        raise ChatParseError(
            "לא הצלחנו לזהות הודעות בקובץ. ודאו שזה ייצוא צ'אט של WhatsApp "
            "(קובץ txt או zip) או ייצוא JSON של Telegram."
        )
    return chat


def _parse_whatsapp(text: str, group_name_hint: str | None) -> ParsedChat:
    # (date, time, ampm, rest, body starts with an LRM mark)
    raw: list[list] = []
    for line in text.splitlines():
        clean = _INVISIBLE.sub("", line)
        m = _LINE.match(clean)
        if m and m.group("rest") is not None:
            # iOS marks system lines ("Group: \u200eDana added Avi") and media
            # placeholders with a left-to-right mark right after the colon.
            lrm = re.search(r":\s\u200e", line) is not None
            raw.append([m.group("date"), m.group("time"), m.group("ampm"), m.group("rest"), lrm])
        elif raw:
            raw[-1][3] += "\n" + clean  # continuation of a multi-line message

    date_order = _detect_date_order(r[0] for r in raw)
    messages: list[Message] = []
    for date_s, time_s, ampm, rest, lrm in raw:
        am = _AUTHOR.match(rest)
        if not am:
            continue  # system line: "X added Y", "Messages are end-to-end encrypted", ...
        author = am.group("author").strip()
        if not author or '"' in author or "\u201c" in author:
            continue
        body = _EDITED.sub("", am.group("text")).strip()
        msg = _make_message(_parse_dt(date_s, time_s, ampm, date_order), author, body)
        if lrm and not msg.is_media and not msg.is_deleted:
            continue  # iOS system line
        messages.append(msg)
    return ParsedChat(messages=messages, source="whatsapp", group_name=group_name_hint)


def _make_message(ts: datetime | None, author: str, body: str) -> Message:
    is_media = bool(_MEDIA.search(body))
    is_deleted = bool(_DELETED.match(body))
    return Message(ts, author, body, is_media=is_media, is_deleted=is_deleted)


def _detect_date_order(dates) -> str:
    """Return 'ymd', 'dmy' or 'mdy' based on the values seen in the file."""
    first_over_12 = second_over_12 = False
    for d in dates:
        parts = re.split(r"[./-]", d)
        if len(parts) != 3:
            continue
        if len(parts[0]) == 4:
            return "ymd"
        a, b = int(parts[0]), int(parts[1])
        first_over_12 |= a > 12
        second_over_12 |= b > 12
    if second_over_12 and not first_over_12:
        return "mdy"
    return "dmy"  # also the default when ambiguous (Israel / most of the world)


def _parse_dt(date_s: str, time_s: str, ampm: str | None, order: str) -> datetime | None:
    try:
        p = [int(x) for x in re.split(r"[./-]", date_s)]
        if order == "ymd":
            y, mo, d = p
        elif order == "mdy":
            mo, d, y = p
        else:
            d, mo, y = p
        if y < 100:
            y += 2000
        tp = [int(x) for x in time_s.split(":")]
        hour, minute = tp[0], tp[1]
        second = tp[2] if len(tp) > 2 else 0
        if ampm:
            pm = ampm.lower().startswith("p") or ampm.startswith("אחה")
            if pm and hour < 12:
                hour += 12
            elif not pm and hour == 12:
                hour = 0
        return datetime(y, mo, d, hour, minute, second)
    except (ValueError, IndexError):
        return None


def _parse_telegram(data: dict, group_name_hint: str | None) -> ParsedChat:
    if not isinstance(data, dict) or not isinstance(data.get("messages"), list):
        raise ChatParseError("קובץ ה-JSON לא נראה כמו ייצוא של Telegram.")
    messages: list[Message] = []
    for m in data["messages"]:
        if not isinstance(m, dict) or m.get("type") != "message":
            continue
        author = str(m.get("from") or "").strip()
        if not author:
            continue
        text = m.get("text", "")
        if isinstance(text, list):
            text = "".join(t if isinstance(t, str) else str(t.get("text", "")) for t in text)
        text = str(text).strip()
        ts = None
        try:
            ts = datetime.fromisoformat(str(m.get("date", "")))
        except ValueError:
            pass
        is_media = any(k in m for k in ("photo", "file", "media_type", "sticker_emoji"))
        if is_media and not text:
            text = "<מדיה>"
        messages.append(Message(ts, author, text, is_media=is_media))
    if not messages:
        raise ChatParseError("לא נמצאו הודעות בקובץ ה-JSON של Telegram.")
    return ParsedChat(messages=messages, source="telegram", group_name=data.get("name") or group_name_hint)


# --------------------------------------------------------------------------- #
# Stats
# --------------------------------------------------------------------------- #

def compute_stats(chat: ParsedChat) -> dict:
    msgs = chat.messages
    per: dict[str, dict] = defaultdict(lambda: {
        "messages": 0, "words": 0, "media": 0, "deleted": 0, "links": 0,
        "laughs": 0, "questions": 0, "night": 0, "emojis": Counter(),
        "hours": Counter(), "starters": 0, "longest": 0, "rants": 0,
    })
    total_emojis: Counter = Counter()
    hours: Counter = Counter()
    days: Counter = Counter()
    weekdays: Counter = Counter()

    prev_ts: datetime | None = None
    for m in msgs:
        s = per[m.author]
        s["messages"] += 1
        if m.is_media:
            s["media"] += 1
        if m.is_deleted:
            s["deleted"] += 1
        if not m.is_media and not m.is_deleted:
            words = _WORD.findall(_LINK.sub("", m.text))
            s["words"] += len(words)
            s["longest"] = max(s["longest"], len(words))
            s["links"] += len(_LINK.findall(m.text))
            if _LAUGH.search(m.text):
                s["laughs"] += 1
            if "?" in m.text:
                s["questions"] += 1
            if len(words) >= 60:
                s["rants"] += 1
            em = _EMOJI.findall(m.text)
            s["emojis"].update(em)
            total_emojis.update(em)
        if m.timestamp:
            h = m.timestamp.hour
            s["hours"][h] += 1
            hours[h] += 1
            days[m.timestamp.date()] += 1
            weekdays[m.timestamp.weekday()] += 1
            if 0 <= h < 5:
                s["night"] += 1
            if prev_ts is None or m.timestamp - prev_ts >= CONVERSATION_GAP:
                s["starters"] += 1
            prev_ts = m.timestamp

    total = len(msgs)
    members = []
    for name, s in per.items():
        text_msgs = s["messages"] - s["media"] - s["deleted"]
        members.append({
            "name": name,
            "messages": s["messages"],
            "share": round(100 * s["messages"] / total, 1) if total else 0,
            "words": s["words"],
            "avg_words": round(s["words"] / text_msgs, 1) if text_msgs else 0,
            "longest_message_words": s["longest"],
            "long_rants": s["rants"],
            "media": s["media"],
            "deleted": s["deleted"],
            "links": s["links"],
            "laughs": s["laughs"],
            "questions": s["questions"],
            "night_messages": s["night"],
            "conversation_starters": s["starters"],
            "top_emojis": [e for e, _ in s["emojis"].most_common(3)],
            "peak_hour": s["hours"].most_common(1)[0][0] if s["hours"] else None,
        })
    members.sort(key=lambda x: x["messages"], reverse=True)

    timestamps = [m.timestamp for m in msgs if m.timestamp]
    busiest_day = days.most_common(1)[0] if days else None
    return {
        "group_name": chat.group_name,
        "source": chat.source,
        "total_messages": total,
        "member_count": len(members),
        "first_date": min(timestamps).date().isoformat() if timestamps else None,
        "last_date": max(timestamps).date().isoformat() if timestamps else None,
        "active_days": len(days),
        "busiest_day": {"date": busiest_day[0].isoformat(), "messages": busiest_day[1]} if busiest_day else None,
        "peak_hour": hours.most_common(1)[0][0] if hours else None,
        "hours": [hours.get(h, 0) for h in range(24)],
        "weekdays": [weekdays.get(d, 0) for d in range(7)],  # Monday = 0
        "top_emojis": [{"emoji": e, "count": c} for e, c in total_emojis.most_common(8)],
        "media_total": sum(m["media"] for m in members),
        "members": members,
        "awards": _compute_awards(members),
    }


def _compute_awards(members: list[dict]) -> list[dict]:
    """Hard-number awards. Claude writes the funny ones; these are just facts."""
    active = [m for m in members if m["messages"] >= 5] or members
    defs = [
        ("chatterbox", "מכונת ההודעות", "messages", "הודעות"),
        ("night_owl", "ינשוף הלילה", "night_messages", "הודעות בין 00:00 ל-05:00"),
        ("photographer", "הפפראצי", "media", "תמונות/מדיה"),
        ("laugher", "הקהל המצחקק", "laughs", "הודעות עם צחוק"),
        ("starter", "מצית השיחות", "conversation_starters", "שיחות שפתח/ה"),
        ("essayist", "כותב/ת המגילות", "avg_words", "מילים בממוצע להודעה"),
        ("regretter", "המתחרט/ת הסדרתי/ת", "deleted", "הודעות שנמחקו"),
        ("curious", "שאלת המיליון", "questions", "שאלות"),
    ]
    awards = []
    for key, title, field_name, unit in defs:
        best = max(active, key=lambda m: m[field_name], default=None)
        if best and best[field_name] > 0:
            awards.append({"key": key, "title": title, "winner": best["name"],
                           "value": best[field_name], "unit": unit})
    return awards


def drop_unverified_quotes(roast: dict, chat: ParsedChat) -> None:
    """Blank any quote that isn't really in that member's own messages."""
    def norm(s: str) -> str:
        s = re.sub("[\"\u201c\u201d\u201e\u00ab\u00bb]", "", _INVISIBLE.sub("", s))
        return " ".join(s.split()).casefold()

    said: dict[str, list[str]] = defaultdict(list)
    for m in chat.messages:
        if not m.is_media and not m.is_deleted:
            said[m.author].append(norm(m.text))
    for member in roast.get("members", []):
        quote = norm(member.get("quote") or "")
        if quote and not any(quote in text for text in said.get(member.get("name"), [])):
            member["quote"] = ""


# --------------------------------------------------------------------------- #
# Transcript for the model
# --------------------------------------------------------------------------- #

def build_transcript(chat: ParsedChat, max_chars: int) -> tuple[str, int]:
    """Compact transcript of the most recent messages that fit in max_chars.

    Returns (transcript, number of messages included). Stats always cover the
    whole chat; only the text Claude reads is limited.
    """
    lines: list[str] = []
    used = 0
    for m in reversed(chat.messages):
        if m.is_media:
            body = "<מדיה>"
        elif m.is_deleted:
            body = "<הודעה שנמחקה>"
        else:
            body = m.text.replace("\r", "").replace("\n", " ⏎ ")
        stamp = m.timestamp.strftime("%d/%m/%y %H:%M") if m.timestamp else "--"
        line = f"[{stamp}] {m.author}: {body}"
        if used + len(line) + 1 > max_chars and lines:
            break
        lines.append(line)
        used += len(line) + 1
    lines.reverse()
    return "\n".join(lines), len(lines)
