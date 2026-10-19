"""Category catalogue and demo data bootstrap."""
from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models import BankAccount, Budget, Category, FixedExpense, SavingsGoal, User

logger = logging.getLogger(__name__)

# key, English, Hebrew, icon, colour, is_fixed, is_income
DEFAULT_CATEGORIES: list[tuple[str, str, str, str, str, bool, bool]] = [
    ("salary", "Salary", "משכורת", "💼", "#16a34a", False, True),
    ("other_income", "Other income", "הכנסה אחרת", "💰", "#22c55e", False, True),
    ("rent", "Rent", "שכר דירה", "🏠", "#7c3aed", True, False),
    ("utilities", "Bills & utilities", "חשבונות", "💡", "#8b5cf6", True, False),
    ("insurance", "Insurance", "ביטוחים", "🛡️", "#6366f1", True, False),
    ("loans", "Loans", "הלוואות", "🏦", "#4f46e5", True, False),
    ("subscriptions", "Subscriptions", "מנויים", "🔁", "#a855f7", True, False),
    ("groceries", "Groceries", "סופרמרקט", "🛒", "#0ea5e9", False, False),
    ("restaurants", "Eating out", "אוכל בחוץ", "🍽️", "#f97316", False, False),
    ("coffee", "Coffee", "קפה", "☕", "#b45309", False, False),
    ("transport", "Transport", "תחבורה", "🚌", "#0891b2", False, False),
    ("fuel", "Fuel", "דלק", "⛽", "#0e7490", False, False),
    ("health", "Health", "בריאות", "💊", "#e11d48", False, False),
    ("shopping", "Shopping", "קניות", "🛍️", "#db2777", False, False),
    ("entertainment", "Entertainment", "בילויים", "🎬", "#f59e0b", False, False),
    ("education", "Education", "לימודים", "🎓", "#14b8a6", False, False),
    ("kids", "Kids", "ילדים", "🧸", "#ec4899", False, False),
    ("transfers", "Transfers", "העברות", "↔️", "#64748b", False, False),
    ("cash", "Cash withdrawal", "משיכת מזומן", "🏧", "#78716c", False, False),
    ("other", "Other", "אחר", "📦", "#94a3b8", False, False),
]


def seed_categories(db: Session) -> None:
    existing = {c.key: c for c in db.scalars(select(Category))}
    for order, (key, en, he, icon, color, is_fixed, is_income) in enumerate(DEFAULT_CATEGORIES):
        cat = existing.get(key)
        if cat is None:
            db.add(Category(key=key, name_en=en, name_he=he, icon=icon, color=color,
                            is_fixed=is_fixed, is_income=is_income, sort_order=order))
        else:  # keep the catalogue in sync with code on upgrades
            cat.name_en, cat.name_he, cat.icon, cat.color = en, he, icon, color
            cat.is_fixed, cat.is_income, cat.sort_order = is_fixed, is_income, order
    db.commit()


def seed_demo(db: Session, history_days: int = 185) -> User | None:
    """Create the demo user with accounts, budgets, goals and synced history.

    Idempotent: does nothing when a user already exists.
    """
    if db.scalar(select(func.count(User.id))):
        return None

    from services.bank_sync import sync_account  # local import avoids a cycle

    cats = {c.key: c for c in db.scalars(select(Category))}
    user = User(name="Dana", phone="972501234567", language="en", currency="ILS",
                expected_monthly_income=14500, weekly_summary_enabled=True,
                budget_alerts_enabled=True, daily_update_enabled=False)
    db.add(user)
    db.flush()

    db.add_all([
        BankAccount(user_id=user.id, bank_name="Bank Hapoalim (mock)", account_mask="4821"),
        BankAccount(user_id=user.id, bank_name="Isracard (mock)", account_mask="7710"),
    ])
    db.add_all([
        FixedExpense(user_id=user.id, name="Rent", amount=4800, category_id=cats["rent"].id, day_of_month=1),
        FixedExpense(user_id=user.id, name="Electricity, water & phone", amount=650,
                     category_id=cats["utilities"].id, day_of_month=15),
        FixedExpense(user_id=user.id, name="Health & car insurance", amount=420,
                     category_id=cats["insurance"].id, day_of_month=5),
        FixedExpense(user_id=user.id, name="Streaming & gym", amount=290,
                     category_id=cats["subscriptions"].id, day_of_month=3),
    ])
    db.add_all([
        Budget(user_id=user.id, category_id=cats["groceries"].id, monthly_limit=2200),
        Budget(user_id=user.id, category_id=cats["restaurants"].id, monthly_limit=900),
        Budget(user_id=user.id, category_id=cats["coffee"].id, monthly_limit=250),
        Budget(user_id=user.id, category_id=cats["shopping"].id, monthly_limit=800),
        Budget(user_id=user.id, category_id=cats["entertainment"].id, monthly_limit=400),
    ])
    today = date.today()
    db.add_all([
        SavingsGoal(user_id=user.id, name="Emergency fund", emoji="🛟", target_amount=30000,
                    saved_amount=11200, deadline=today + timedelta(days=365)),
        SavingsGoal(user_id=user.id, name="Trip to Japan", emoji="🗾", target_amount=18000,
                    saved_amount=4500, deadline=today + timedelta(days=240)),
    ])
    db.commit()

    for account in user.accounts:
        sync_account(db, account, since=today - timedelta(days=history_days), until=today, notify=False)
    logger.info("Seeded demo user %s with %d days of history", user.name, history_days)
    return user
