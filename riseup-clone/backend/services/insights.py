"""Value-add insights: Subscription Radar and Savings Goal projections.

Subscription Radar
    Finds recurring charges in the transaction history without any manual
    setup: transactions are grouped by normalised merchant, the gaps between
    charges must be consistent (weekly / monthly / quarterly / yearly) and the
    amounts stable. It reports each recurring charge's monthly & yearly cost,
    the next expected charge date and price increases.

Savings Goals
    For each goal, how much must be saved per month to hit the deadline, and
    whether this month's forecast surplus can cover it.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta
from statistics import mean, median, pstdev

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Category, SavingsGoal, Transaction, User
from services.calculator import compute_bottom_line
from services.categorizer import merchant_key

CADENCES = [  # name, min_days, max_days
    ("weekly", 6, 8),
    ("monthly", 26, 35),
    ("quarterly", 84, 98),
    ("yearly", 350, 380),
]
EXCLUDED_CATEGORIES = {"cash", "transfers"}


def _cadence(interval: float) -> str | None:
    for name, low, high in CADENCES:
        if low <= interval <= high:
            return name
    return None


def detect_subscriptions(db: Session, user: User, lookback_days: int = 200, today: date | None = None) -> dict:
    today = today or date.today()
    cats = {c.id: c for c in db.scalars(select(Category))}
    rows = db.scalars(
        select(Transaction).where(
            Transaction.user_id == user.id,
            Transaction.amount < 0,
            Transaction.date >= today - timedelta(days=lookback_days),
        ).order_by(Transaction.date)
    )
    groups: dict[str, list[Transaction]] = defaultdict(list)
    for tx in rows:
        if cats[tx.category_id].key in EXCLUDED_CATEGORIES:
            continue
        key = merchant_key(tx.merchant)
        if key:
            groups[key].append(tx)

    found = []
    for key, txs in groups.items():
        # Collapse multiple charges on the same day (split payments) into one.
        by_day: dict[date, float] = defaultdict(float)
        for tx in txs:
            by_day[tx.date] += -tx.amount
        days = sorted(by_day)
        if len(days) < 2:
            continue
        intervals = [(b - a).days for a, b in zip(days, days[1:])]
        med_interval = median(intervals)
        cadence = _cadence(med_interval)
        # Two charges a year apart are enough for a yearly plan; anything more frequent
        # needs three to rule out coincidences.
        if cadence is None or (cadence != "yearly" and len(days) < 3):
            continue
        if any(abs(i - med_interval) > max(3, 0.2 * med_interval) for i in intervals):
            continue
        amounts = [by_day[d] for d in days]
        earlier = amounts[:-1]
        base = median(earlier)
        # Stable amounts (bills may vary a little), allowing one price change at the end.
        variation = pstdev(earlier) / mean(earlier) if mean(earlier) else 0.0
        if variation > 0.2:
            continue
        last_amount = amounts[-1]
        change_pct = round(100 * (last_amount - base) / base, 1) if base else 0.0
        if abs(change_pct) > 60:  # probably not the same product
            continue
        fixed_price = variation < 0.02
        # A "price change" only makes sense for fixed-price plans, not metered bills.
        if not fixed_price or abs(change_pct) < 3:
            change_pct = 0.0
        last_date = days[-1]
        active = (today - last_date).days <= med_interval * 1.5
        monthly_cost = last_amount * 30.44 / med_interval
        cat = cats[txs[-1].category_id]
        found.append({
            "merchant": txs[-1].merchant,
            "merchant_key": key,
            "category_key": cat.key,
            "category_icon": cat.icon,
            "category_name_en": cat.name_en,
            "category_name_he": cat.name_he,
            "is_fixed_category": cat.is_fixed,
            "cadence": cadence,
            "interval_days": round(med_interval, 1),
            "occurrences": len(days),
            "last_amount": round(last_amount, 2),
            "previous_amount": round(base, 2),
            "price_change_pct": change_pct,
            "fixed_price": fixed_price,
            "last_date": last_date.isoformat(),
            "next_expected": (last_date + timedelta(days=round(med_interval))).isoformat(),
            "monthly_cost": round(monthly_cost, 2),
            "yearly_cost": round(monthly_cost * 12, 2),
            "active": active,
        })

    found.sort(key=lambda s: s["monthly_cost"], reverse=True)
    active = [s for s in found if s["active"]]
    subs = [s for s in active if s["category_key"] == "subscriptions"]
    return {
        "items": found,
        "total_monthly": round(sum(s["monthly_cost"] for s in active), 2),
        "total_yearly": round(sum(s["yearly_cost"] for s in active), 2),
        "subscriptions_monthly": round(sum(s["monthly_cost"] for s in subs), 2),
        "subscriptions_yearly": round(sum(s["yearly_cost"] for s in subs), 2),
        "price_hikes": [s for s in active if s["price_change_pct"] > 0],
    }


def _months_until(deadline: date, today: date) -> int:
    months = (deadline.year - today.year) * 12 + (deadline.month - today.month)
    if deadline.day > today.day:
        months += 1
    return max(1, months)


def goals_overview(db: Session, user: User, today: date | None = None) -> dict:
    today = today or date.today()
    goals = list(db.scalars(select(SavingsGoal).where(SavingsGoal.user_id == user.id).order_by(SavingsGoal.id)))
    forecast_surplus = max(0.0, compute_bottom_line(db, user, today=today).forecast_free_to_spend)

    items, total_required = [], 0.0
    for g in goals:
        remaining = max(0.0, g.target_amount - g.saved_amount)
        pct = round(100 * g.saved_amount / g.target_amount, 1) if g.target_amount else 0.0
        if remaining == 0:
            months_left, required, status = 0, 0.0, "done"
        elif g.deadline is None:
            months_left, required, status = None, 0.0, "no_deadline"
        elif g.deadline < today:
            months_left, required, status = 0, remaining, "overdue"
        else:
            months_left = _months_until(g.deadline, today)
            required = math.ceil(remaining / months_left)
            status = "pending"
        total_required += required
        items.append({
            "id": g.id, "name": g.name, "emoji": g.emoji, "target_amount": g.target_amount,
            "saved_amount": g.saved_amount, "remaining": round(remaining, 2), "progress_pct": min(pct, 100.0),
            "deadline": g.deadline.isoformat() if g.deadline else None, "months_left": months_left,
            "required_monthly": required, "status": status,
        })

    affordable = forecast_surplus >= total_required
    for item in items:
        if item["status"] == "pending":
            item["status"] = "on_track" if affordable else "at_risk"
    return {
        "items": items,
        "total_required_monthly": round(total_required, 2),
        "forecast_surplus": round(forecast_surplus, 2),
        "affordable": affordable,
        # Suggest moving what the forecast says will be left over (capped at what's needed).
        "suggested_transfer": round(min(forecast_surplus, total_required), 2),
    }
