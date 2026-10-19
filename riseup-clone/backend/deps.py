"""Shared FastAPI dependencies."""
from __future__ import annotations

import re

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import Category, User


def get_current_user(db: Session = Depends(get_db), x_user_id: int | None = Header(default=None)) -> User:
    """Personal single-household app: the user comes from ``X-User-Id`` or is the first user.

    Put the API behind your auth proxy (or swap this dependency for OAuth/JWT)
    before exposing it beyond localhost.
    """
    user = db.get(User, x_user_id) if x_user_id else db.scalar(select(User).order_by(User.id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def get_category(db: Session, key: str) -> Category:
    category = db.scalar(select(Category).where(Category.key == key))
    if category is None:
        raise HTTPException(status_code=422, detail=f"Unknown category '{key}'")
    return category


MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def validate_month(month: str | None) -> str | None:
    """Validate an optional ``YYYY-MM`` query value."""
    if month is not None and not MONTH_RE.match(month):
        raise HTTPException(status_code=422, detail="month must be YYYY-MM")
    return month
