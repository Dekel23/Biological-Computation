"""Web server: upload a group-chat export, get a summary and roasts back.

Run locally:
    pip install -r requirements.txt
    export ANTHROPIC_API_KEY=...
    python app.py            # http://localhost:8000
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context

from chat_parser import ChatParseError, build_transcript, compute_stats, load_upload, parse_chat
from roaster import RoastError, stream_roast

STATIC_DIR = Path(__file__).parent / "static"
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "50"))
MAX_TRANSCRIPT_CHARS = int(os.environ.get("MAX_TRANSCRIPT_CHARS", "300000"))
MAX_ROASTED_MEMBERS = int(os.environ.get("MAX_ROASTED_MEMBERS", "20"))

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/static/<path:path>")
def static_files(path: str):
    return send_from_directory(STATIC_DIR, path)


@app.get("/api/health")
def health():
    return jsonify(ok=True)


@app.errorhandler(413)
def too_large(_):
    return jsonify(error=f"הקובץ גדול מ-{MAX_UPLOAD_MB}MB. ייצאו את הצ'אט בלי מדיה."), 413


@app.post("/api/roast")
def roast():
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
            for event in stream_roast(stats, transcript, included, roasted, language, spice):
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


def _line(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), debug=False, threaded=True)
