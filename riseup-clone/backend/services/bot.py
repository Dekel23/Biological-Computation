"""Inbound WhatsApp conversation handler."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Budget, Category, Transaction, User, WhatsAppMessage
from services.calculator import compute_bottom_line
from services.categorizer import Categorizer, match_keyword, normalize
from services.insights import goals_overview
from services.messages import category_name, money, month_name, t
from services.nlp_parser import ParsedMessage, parse_message
from services.notifications import build_balance_message, build_weekly_summary, check_budget_alerts
from services.whatsapp_client import record_inbound, send_message


@dataclass
class BotResult:
    parsed: ParsedMessage
    reply: WhatsAppMessage
    transaction: Transaction | None = None
    alerts: list[WhatsAppMessage] | None = None


def find_category(db: Session, text: str | None, want_income: bool = False) -> Category | None:
    """Resolve a category from free text: explicit names first, then keywords."""
    if not text:
        return None
    norm = normalize(text)
    cats = list(db.scalars(select(Category).where(Category.is_income.is_(want_income))))
    for cat in sorted(cats, key=lambda c: -len(c.name_en)):
        for name in (cat.name_en, cat.name_he, cat.key.replace("_", " ")):
            n = normalize(name)
            if n and (n == norm or f" {n} " in f" {norm} "):
                return cat
    key = match_keyword(text, lambda k: any(c.key == k for c in cats))
    return next((c for c in cats if c.key == key), None)


def _free(db: Session, user: User) -> str:
    return money(compute_bottom_line(db, user).free_to_spend, user.currency)


def _log_transaction(db: Session, user: User, parsed: ParsedMessage, income: bool) -> Transaction:
    categorizer = Categorizer(db, user.id)
    amount = parsed.amount if income else -parsed.amount
    merchant = parsed.merchant or parsed.description or ("WhatsApp income" if income else "Cash expense")
    tx = Transaction(
        user_id=user.id, date=parsed.tx_date or date.today(), amount=amount, merchant=merchant[:160],
        description=parsed.raw, source="cash" if not income else "manual",
    )
    result = categorizer.categorize(merchant, amount, None, parsed.description)
    if result.source == "default":
        explicit = find_category(db, parsed.description, want_income=income)
        if explicit:
            result_key, source, confidence = explicit.key, "keyword", 0.8
        else:
            result_key, source, confidence = result.category_key, result.source, result.confidence
    else:
        result_key, source, confidence = result.category_key, result.source, result.confidence
    tx.category_id = categorizer.category_id(result_key)
    tx.category_source, tx.category_confidence = source, confidence
    db.add(tx)
    db.flush()
    return tx


def handle_inbound(db: Session, user: User, text: str) -> BotResult:
    parsed = parse_message(text, default_language=user.language)
    lang, cur = parsed.language, user.currency
    inbound = record_inbound(db, user, text)
    tx: Transaction | None = None
    alerts: list[WhatsAppMessage] = []

    if parsed.intent in ("expense", "income"):
        income = parsed.intent == "income"
        tx = _log_transaction(db, user, parsed, income)
        inbound.transaction_id = tx.id
        db.commit()
        cat = tx.category
        when = t(lang, "yesterday") if parsed.tx_date and parsed.tx_date < date.today() else ""
        merchant = f" · {parsed.merchant}" if parsed.merchant and normalize(parsed.merchant) != normalize(
            category_name(cat, lang)) else ""
        key = "income_logged" if income else "expense_logged"
        body = t(lang, key, amount=money(parsed.amount, cur, 2 if parsed.amount % 1 else 0), icon=cat.icon,
                 category=category_name(cat, lang), merchant=merchant, when=when, free=_free(db, user))
        reply = send_message(db, user, body, kind="reply", transaction_id=tx.id)
        if not income:
            alerts = check_budget_alerts(db, user, lang=lang)
        return BotResult(parsed, reply, tx, alerts)

    if parsed.intent == "set_budget":
        cat = find_category(db, parsed.description)
        if cat is None:
            body = t(lang, "budget_unknown_category")
        else:
            budget = db.scalar(select(Budget).where(Budget.user_id == user.id, Budget.category_id == cat.id))
            if budget:
                budget.monthly_limit = parsed.amount
            else:
                db.add(Budget(user_id=user.id, category_id=cat.id, monthly_limit=parsed.amount))
            db.commit()
            body = t(lang, "budget_set", icon=cat.icon, category=category_name(cat, lang),
                     amount=money(parsed.amount, cur))
    elif parsed.intent == "balance":
        body = build_balance_message(db, user, lang)
    elif parsed.intent == "summary":
        original = user.language
        user.language = lang  # render in the language the user wrote in, without persisting it
        try:
            body = build_weekly_summary(db, user)
        finally:
            user.language = original
    elif parsed.intent == "budget":
        bl = compute_bottom_line(db, user)
        lines = [t(lang, "budget_header", month=month_name(bl.month, lang))]
        for ct in bl.categories:
            if ct.budget:
                pct = ct.budget_used_pct or 0
                flag = "🔴" if pct >= 100 else "🟠" if pct >= 80 else "🟢"
                lines.append(t(lang, "budget_line", flag=flag, icon=ct.icon,
                               category=ct.name_he if lang == "he" else ct.name_en,
                               spent=money(ct.amount, cur), limit=money(ct.budget, cur), pct=round(pct)))
        body = "\n".join(lines) if len(lines) > 1 else t(lang, "no_budgets")
    elif parsed.intent == "goals":
        overview = goals_overview(db, user)
        if not overview["items"]:
            body = t(lang, "no_goals")
        else:
            lines = [t(lang, "goals_header")]
            for g in overview["items"]:
                need = t(lang, "goal_need", monthly=money(g["required_monthly"], cur)) if g["required_monthly"] else ""
                lines.append(t(lang, "goal_line", emoji=g["emoji"], name=g["name"], saved=money(g["saved_amount"], cur),
                               target=money(g["target_amount"], cur), pct=round(g["progress_pct"]), need=need))
            body = "\n".join(lines)
    elif parsed.intent == "undo":
        last = db.scalar(
            select(Transaction).join(WhatsAppMessage, WhatsAppMessage.transaction_id == Transaction.id)
            .where(Transaction.user_id == user.id, WhatsAppMessage.direction == "in")
            .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        )
        if last is None:
            body = t(lang, "undo_nothing")
        else:
            description = dict(amount=money(abs(last.amount), cur, 2 if abs(last.amount) % 1 else 0),
                               category=category_name(last.category, lang), merchant=last.merchant)
            db.delete(last)
            db.commit()
            body = t(lang, "undo_done", free=_free(db, user), **description)
    elif parsed.intent == "help":
        body = t(lang, "help", name=user.name)
    else:
        body = t(lang, "unknown")

    db.commit()
    reply = send_message(db, user, body, kind="reply")
    return BotResult(parsed, reply, tx, alerts)
