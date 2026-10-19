"""WhatsApp bot: Meta Cloud API webhook, in-app simulator and proactive updates.

* ``GET  /api/whatsapp/webhook``   – Meta subscription verification handshake.
* ``POST /api/whatsapp/webhook``   – inbound messages in Meta's webhook format.
  When ``WHATSAPP_APP_SECRET`` is set the ``X-Hub-Signature-256`` header is verified.
* ``POST /api/whatsapp/simulate``  – send a message as the user from the app's chat simulator.
* ``POST /api/whatsapp/proactive/{kind}`` – trigger an outbound update now
  (the scheduler sends them automatically on its own timetable).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user
from models import Transaction, User, WhatsAppMessage
from schemas import SimulateIn, SimulateOut, TransactionOut, WhatsAppMessageOut
from services.bot import handle_inbound
from services.messages import t
from services.notifications import build_balance_message, build_weekly_summary, check_budget_alerts
from services.whatsapp_client import is_live, send_message

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])

VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "riseup-dev-verify-token")


@router.get("/status")
def status() -> dict:
    return {"mode": "live" if is_live() else "simulated"}


@router.get("/webhook", response_class=PlainTextResponse)
def verify_webhook(
    hub_mode: str = Query(alias="hub.mode"),
    hub_verify_token: str = Query(alias="hub.verify_token"),
    hub_challenge: str = Query(alias="hub.challenge"),
) -> str:
    if hub_mode == "subscribe" and hmac.compare_digest(hub_verify_token, VERIFY_TOKEN):
        return hub_challenge
    raise HTTPException(status_code=403, detail="Verification failed")


def _verify_signature(raw: bytes, header: str | None) -> None:
    secret = os.getenv("WHATSAPP_APP_SECRET")
    if not secret:
        return
    expected = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not header or not hmac.compare_digest(expected, header):
        raise HTTPException(status_code=401, detail="Invalid signature")


def _normalize_phone(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    return "972" + digits[1:] if digits.startswith("0") else digits


@router.post("/webhook")
async def receive_webhook(request: Request, db: Session = Depends(get_db)) -> dict:
    raw = await request.body()
    _verify_signature(raw, request.headers.get("X-Hub-Signature-256"))
    try:
        payload = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    processed, ignored = await run_in_threadpool(_process_payload, db, payload)
    # Meta retries on non-2xx, so always acknowledge once the payload was understood.
    return {"status": "ok", "processed": processed, "ignored": ignored}


def _process_payload(db: Session, payload: dict) -> tuple[int, int]:
    processed = ignored = 0
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for msg in value.get("messages", []):
                phone = _normalize_phone(msg.get("from", ""))
                user = db.scalar(select(User).where(User.phone == phone))
                if user is None:
                    logger.warning("Inbound WhatsApp from unknown number %s ignored", phone)
                    ignored += 1
                    continue
                if msg.get("type") == "text":
                    handle_inbound(db, user, msg.get("text", {}).get("body", ""))
                else:  # images, voice notes, stickers... answer with the help menu
                    send_message(db, user, t(user.language, "help", name=user.name))
                processed += 1
    return processed, ignored


@router.post("/simulate", response_model=SimulateOut)
def simulate(payload: SimulateIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> SimulateOut:
    result = handle_inbound(db, user, payload.text)
    inbound = db.scalar(
        select(WhatsAppMessage).where(WhatsAppMessage.user_id == user.id, WhatsAppMessage.direction == "in")
        .order_by(WhatsAppMessage.id.desc())
    )
    messages = [m for m in [inbound, result.reply, *(result.alerts or [])] if m is not None]
    tx = db.get(Transaction, result.transaction.id) if result.transaction else None
    return SimulateOut(
        intent=result.parsed.intent, language=result.parsed.language, amount=result.parsed.amount,
        messages=[WhatsAppMessageOut.model_validate(m) for m in messages],
        transaction=TransactionOut.model_validate(tx) if tx else None,
    )


@router.get("/messages", response_model=list[WhatsAppMessageOut])
def messages(limit: int = Query(default=100, ge=1, le=500), db: Session = Depends(get_db),
             user: User = Depends(get_current_user)) -> list[WhatsAppMessage]:
    rows = db.scalars(
        select(WhatsAppMessage).where(WhatsAppMessage.user_id == user.id)
        .order_by(WhatsAppMessage.id.desc()).limit(limit)
    ).all()
    return list(reversed(rows))


@router.delete("/messages", status_code=204)
def clear_messages(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    db.execute(delete(WhatsAppMessage).where(WhatsAppMessage.user_id == user.id))
    db.commit()
    return Response(status_code=204)


@router.post("/proactive/{kind}", response_model=list[WhatsAppMessageOut])
def send_proactive(kind: Literal["weekly_summary", "free_to_spend", "budget_alerts"],
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[WhatsAppMessage]:
    if kind == "weekly_summary":
        return [send_message(db, user, build_weekly_summary(db, user), kind="weekly_summary")]
    if kind == "free_to_spend":
        return [send_message(db, user, build_balance_message(db, user), kind="free_to_spend")]
    return check_budget_alerts(db, user)
