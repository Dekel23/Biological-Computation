"""Outbound WhatsApp transport.

When ``WHATSAPP_TOKEN`` and ``WHATSAPP_PHONE_NUMBER_ID`` are set, messages are
delivered through the Meta WhatsApp Cloud API. Otherwise the client runs in
simulation mode: every message is stored in the ``whatsapp_messages`` table
(visible in the app's chat simulator) and logged, but nothing leaves the box.
"""
from __future__ import annotations

import logging
import os

import httpx
from sqlalchemy.orm import Session

from models import User, WhatsAppMessage

logger = logging.getLogger(__name__)

GRAPH_API_VERSION = os.getenv("WHATSAPP_API_VERSION", "v21.0")


def is_live() -> bool:
    return bool(os.getenv("WHATSAPP_TOKEN") and os.getenv("WHATSAPP_PHONE_NUMBER_ID"))


def _deliver(phone: str, body: str) -> bool:
    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{os.environ['WHATSAPP_PHONE_NUMBER_ID']}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": phone,
        "type": "text",
        "text": {"preview_url": False, "body": body[:4096]},
    }
    try:
        response = httpx.post(
            url, json=payload, timeout=10.0,
            headers={"Authorization": f"Bearer {os.environ['WHATSAPP_TOKEN']}"},
        )
        response.raise_for_status()
        return True
    except httpx.HTTPError as exc:
        logger.error("WhatsApp delivery to %s failed: %s", phone, exc)
        return False


def send_message(
    db: Session, user: User, body: str, kind: str = "reply", transaction_id: int | None = None, commit: bool = True
) -> WhatsAppMessage:
    if is_live() and user.phone:
        status = "sent" if _deliver(user.phone, body) else "failed"
    else:
        status = "simulated"
        logger.info("[WhatsApp simulated → %s] (%s) %s", user.phone, kind, body.replace("\n", " | "))
    message = WhatsAppMessage(
        user_id=user.id, direction="out", kind=kind, body=body, status=status, transaction_id=transaction_id
    )
    db.add(message)
    if commit:
        db.commit()
    return message


def record_inbound(db: Session, user: User, body: str) -> WhatsAppMessage:
    message = WhatsAppMessage(user_id=user.id, direction="in", kind="inbound", body=body, status="received")
    db.add(message)
    db.flush()
    return message
