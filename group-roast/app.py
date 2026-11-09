"""Web server: upload a group-chat export, get a summary and roasts back.

Run locally:
    pip install -r requirements.txt
    export ANTHROPIC_API_KEY=...
    python app.py            # http://localhost:8000
"""

from __future__ import annotations

import hmac
import json
import os
import queue
import threading
from collections.abc import Callable, Iterator
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context

from chat_parser import ChatParseError, build_transcript, compute_stats, load_upload, parse_chat
from roaster import RoastError, stream_roast

STATIC_DIR = Path(__file__).parent / "static"
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "50"))
MAX_TRANSCRIPT_CHARS = int(os.environ.get("MAX_TRANSCRIPT_CHARS", "300000"))
MAX_ROASTED_MEMBERS = int(os.environ.get("MAX_ROASTED_MEMBERS", "20"))
# Who may spend the API key: anyone who knows this code. Empty = open to all.
ACCESS_CODE = os.environ.get("ACCESS_CODE", "").strip()
# Safety net on spend: roasts per UTC day across all users. 0 = no limit.
DAILY_ROAST_LIMIT = int(os.environ.get("DAILY_ROAST_LIMIT", "30"))
# Send a keep-alive line this often, so proxies don't drop a quiet connection
# while Claude is thinking.
HEARTBEAT_SECONDS = float(os.environ.get("HEARTBEAT_SECONDS", "10"))

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

_usage_lock = threading.Lock()
_usage = {"day": "", "count": 0}


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/static/<path:path>")
def static_files(path: str):
    return send_from_directory(STATIC_DIR, path)


@app.get("/api/health")
def health():
    return jsonify(ok=True)


@app.get("/api/config")
def config():
    return jsonify(access_code_required=bool(ACCESS_CODE))


@app.errorhandler(413)
def too_large(_):
    return jsonify(error=f"הקובץ גדול מ-{MAX_UPLOAD_MB}MB. ייצאו את הצ'אט בלי מדיה."), 413


@app.post("/api/roast")
def roast():
    if ACCESS_CODE and not hmac.compare_digest(
        request.form.get("access_code", "").strip().encode(), ACCESS_CODE.encode()
    ):
        return jsonify(error="קוד הגישה שגוי.", code="bad_access_code"), 401

    language = request.form.get("language", "he")
    spice = request.form.get("spice", "medium")
    upload = request.files.get("file")
    pasted = request.form.get("text", "")

    try:
        if upload and upload.filename:
            text, hint = load_upload(upload.read(), upload.filename)
        elif pasted.strip():
            text, hint = pasted, None
        else:
            return jsonify(error="העלו קובץ צ'אט או הדביקו טקסט."), 400
        chat = parse_chat(text, hint)
    except ChatParseError as exc:
        return jsonify(error=str(exc)), 400

    if not _take_daily_slot():
        return jsonify(error="הגענו למכסת הצליות להיום. נסו שוב מחר."), 429

    stats = compute_stats(chat)
    transcript, included = build_transcript(chat, MAX_TRANSCRIPT_CHARS)
    roasted = [m["name"] for m in stats["members"][:MAX_ROASTED_MEMBERS]]

    def events():
        yield _line({
            "type": "stats",
            "stats": stats,
            "included_messages": included,
            "roasted_members": roasted,
        })
        try:
            roast_events = with_heartbeat(
                lambda: stream_roast(stats, transcript, included, roasted, language, spice),
                HEARTBEAT_SECONDS,
            )
            for event in roast_events:
                yield _line(event)
        except RoastError as exc:
            yield _line({"type": "error", "error": str(exc)})
        except Exception:  # never leak a stack trace into the page
            app.logger.exception("roast failed")
            yield _line({"type": "error", "error": "משהו השתבש. נסו שוב."})

    return Response(
        stream_with_context(events()),
        mimetype="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


def with_heartbeat(make_events: Callable[[], Iterator[dict]], interval: float) -> Iterator[dict]:
    """Run an event generator in a worker thread, yielding {"type": "ping"}
    whenever it has been quiet for `interval` seconds.

    If the consumer stops early (the browser disconnected), the worker closes
    the underlying generator at its next event, which closes the Claude stream.
    """
    q: queue.Queue = queue.Queue()
    stop = threading.Event()

    def worker():
        gen = make_events()
        try:
            for ev in gen:
                if stop.is_set():
                    break
                q.put(("event", ev))
        except BaseException as exc:  # handed to the consumer to re-raise
            q.put(("error", exc))
        finally:
            gen.close()
            q.put(("done", None))

    threading.Thread(target=worker, daemon=True).start()
    try:
        while True:
            try:
                kind, payload = q.get(timeout=interval)
            except queue.Empty:
                yield {"type": "ping"}
                continue
            if kind == "event":
                yield payload
            elif kind == "error":
                raise payload
            else:
                return
    finally:
        stop.set()


def _take_daily_slot() -> bool:
    if DAILY_ROAST_LIMIT <= 0:
        return True
    today = datetime.now(timezone.utc).date().isoformat()
    with _usage_lock:
        if _usage["day"] != today:
            _usage["day"], _usage["count"] = today, 0
        if _usage["count"] >= DAILY_ROAST_LIMIT:
            return False
        _usage["count"] += 1
        return True


def _line(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), debug=False, threaded=True)
