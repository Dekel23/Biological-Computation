"""Proactive outbound WhatsApp updates: weekly summary, budget alerts, daily update."""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import BudgetAlertLog, Category, Transaction, User, WhatsAppMessage
from services.calculator import compute_bottom_line
from services.insights import detect_subscriptions
from services.messages import category_name, money, month_name, t
from services.whatsapp_client import send_message

logger = logging.getLogger(__name__)

ALERT_THRESHOLDS = (100, 80)  # checked highest first so a jump past 100% sends a single alert


def _spend_between(db: Session, user: User, start: date, end: date) -> tuple[float, dict[int, float]]:
    cats = {c.id: c for c in db.scalars(select(Category))}
    total, by_cat = 0.0, defaultdict(float)
    for tx in db.scalars(select(Transaction).where(
        Transaction.user_id == user.id, Transaction.date >= start, Transaction.date <= end, Transaction.amount < 0
    )):
        cat = cats[tx.category_id]
        if cat.is_income or (cat.key == "cash" and tx.source == "bank"):
            continue
        total += -tx.amount
        by_cat[tx.category_id] += -tx.amount
    return total, by_cat


def build_weekly_summary(db: Session, user: User, today: date | None = None) -> str:
    today = today or date.today()
    lang, cur = user.language, user.currency
    start = today - timedelta(days=6)
    spent, by_cat = _spend_between(db, user, start, today)
    prev_spent, _ = _spend_between(db, user, start - timedelta(days=7), start - timedelta(days=1))

    if prev_spent and abs(spent - prev_spent) / prev_spent >= 0.05:
        pct = round(100 * abs(spent - prev_spent) / prev_spent)
        trend = t(lang, "trend_up" if spent > prev_spent else "trend_down", pct=pct)
    else:
        trend = t(lang, "trend_flat")

    cats = {c.id: c for c in db.scalars(select(Category))}
    top = sorted(by_cat.items(), key=lambda kv: kv[1], reverse=True)[:3]
    top_lines = "\n".join(
        t(lang, "top_line", i=i, icon=cats[cid].icon, category=category_name(cats[cid], lang), amount=money(v, cur))
        for i, (cid, v) in enumerate(top, start=1)
    )

    bl = compute_bottom_line(db, user, today=today)
    if bl.free_to_spend < 0:
        tip = t(lang, "tip_over")
    elif bl.forecast_free_to_spend < 0:
        tip = t(lang, "tip_tight", forecast=money(abs(bl.forecast_free_to_spend), cur))
    else:
        tip = t(lang, "tip_good", forecast=money(bl.forecast_free_to_spend, cur))

    hikes = detect_subscriptions(db, user, today=today)["price_hikes"]
    for hike in hikes[:2]:
        tip += "\n" + t(lang, "price_hike", merchant=hike["merchant"], old=money(hike["previous_amount"], cur, 2),
                        new=money(hike["last_amount"], cur, 2))

    return t(lang, "weekly_summary", start=start.strftime("%d/%m"), end=today.strftime("%d/%m"),
             spent=money(spent, cur), trend=trend, top=top_lines, free=money(bl.free_to_spend, cur),
             days_left=bl.days_left, daily=money(bl.daily_allowance, cur), tip=tip)


def build_balance_message(db: Session, user: User, lang: str | None = None) -> str:
    lang = lang or user.language
    cur = user.currency
    bl = compute_bottom_line(db, user)
    return t(lang, "balance", month=month_name(bl.month, lang), income=money(bl.total_income, cur),
             projected=t(lang, "projected") if bl.income_is_projected else "", fixed=money(bl.fixed_expenses, cur),
             variable=money(bl.variable_expenses, cur), free=money(bl.free_to_spend, cur), days_left=bl.days_left,
             daily=money(bl.daily_allowance, cur), forecast=money(bl.forecast_free_to_spend, cur))


def build_daily_update(db: Session, user: User, today: date | None = None) -> str:
    today = today or date.today()
    spent_today, _ = _spend_between(db, user, today, today)
    bl = compute_bottom_line(db, user, today=today)
    return t(user.language, "daily_update", today=money(spent_today, user.currency),
             month=month_name(bl.month, user.language), free=money(bl.free_to_spend, user.currency),
             daily=money(bl.daily_allowance, user.currency))


def check_budget_alerts(
    db: Session, user: User, today: date | None = None, lang: str | None = None
) -> list[WhatsAppMessage]:
    """Send at most one 80% and one 100% alert per budget per month.

    ``lang`` overrides the user's language, e.g. to answer in the language of the
    WhatsApp message that triggered the check.
    """
    if not user.budget_alerts_enabled:
        return []
    today = today or date.today()
    lang = lang or user.language
    bl = compute_bottom_line(db, user, today=today)
    cats = {c.key: c for c in db.scalars(select(Category))}
    sent_logs = {
        (row.category_id, row.threshold)
        for row in db.scalars(select(BudgetAlertLog).where(
            BudgetAlertLog.user_id == user.id, BudgetAlertLog.month == bl.month
        ))
    }
    out = []
    for ct in bl.categories:
        if not ct.budget or ct.budget_used_pct is None:
            continue
        cat = cats[ct.key]
        for threshold in ALERT_THRESHOLDS:
            if ct.budget_used_pct < threshold:
                continue
            if (cat.id, threshold) in sent_logs:
                break  # this level (and any lower one) was already announced
            db.add(BudgetAlertLog(user_id=user.id, category_id=cat.id, month=bl.month, threshold=threshold))
            # Crossing 100% implies 80% too; never send a stale 80% alert afterwards.
            if threshold == 100 and (cat.id, 80) not in sent_logs:
                db.add(BudgetAlertLog(user_id=user.id, category_id=cat.id, month=bl.month, threshold=80))
            body = t(lang, f"budget_alert_{threshold}", pct=round(ct.budget_used_pct),
                     icon=ct.icon, category=category_name(cat, lang),
                     spent=money(ct.amount, user.currency), limit=money(ct.budget, user.currency))
            out.append(send_message(db, user, body, kind="budget_alert", commit=False))
            break
    try:
        db.commit()
    except IntegrityError:
        # Another worker logged the same alert concurrently; it already notified the user.
        db.rollback()
        logger.info("Budget alert for user %s already sent by another worker", user.id)
        return []
    return out


# ---------------------------------------------------------------------------
# Scheduler entry points (operate on all users)
# ---------------------------------------------------------------------------
def send_weekly_summaries(db: Session) -> int:
    count = 0
    for user in db.scalars(select(User).where(User.weekly_summary_enabled.is_(True))):
        send_message(db, user, build_weekly_summary(db, user), kind="weekly_summary")
        count += 1
    return count


def send_daily_updates(db: Session) -> int:
    count = 0
    for user in db.scalars(select(User).where(User.daily_update_enabled.is_(True))):
        send_message(db, user, build_daily_update(db, user), kind="free_to_spend")
        count += 1
    return count


def run_budget_checks(db: Session) -> int:
    return sum(len(check_budget_alerts(db, user)) for user in db.scalars(select(User)))
