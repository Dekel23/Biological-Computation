"""SQLAlchemy ORM models.

Amounts are stored as signed floats rounded to two decimals: expenses are
negative and income is positive. All money is in the user's currency (ILS by
default).
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(32), unique=True, index=True)
    language: Mapped[str] = mapped_column(String(2), default="en")
    currency: Mapped[str] = mapped_column(String(3), default="ILS")
    expected_monthly_income: Mapped[float] = mapped_column(Float, default=0.0)
    weekly_summary_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    budget_alerts_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    daily_update_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    accounts: Mapped[list[BankAccount]] = relationship(back_populates="user", cascade="all, delete-orphan")
    transactions: Mapped[list[Transaction]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Category(Base):
    """Global category catalogue shared by all users."""

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name_en: Mapped[str] = mapped_column(String(60))
    name_he: Mapped[str] = mapped_column(String(60))
    icon: Mapped[str] = mapped_column(String(8))
    color: Mapped[str] = mapped_column(String(9))
    is_fixed: Mapped[bool] = mapped_column(Boolean, default=False)
    is_income: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class BankAccount(Base):
    __tablename__ = "bank_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    bank_name: Mapped[str] = mapped_column(String(80))
    account_mask: Mapped[str] = mapped_column(String(8))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    synced_until: Mapped[date | None] = mapped_column(Date)

    user: Mapped[User] = relationship(back_populates="accounts")


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (UniqueConstraint("user_id", "external_id", name="uq_tx_external"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("bank_accounts.id", ondelete="SET NULL"))
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), index=True)
    external_id: Mapped[str | None] = mapped_column(String(64))
    date: Mapped[date] = mapped_column(Date, index=True)
    amount: Mapped[float] = mapped_column(Float)
    merchant: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    mcc: Mapped[str | None] = mapped_column(String(4))
    # bank | cash | manual
    source: Mapped[str] = mapped_column(String(16), default="bank")
    # How the category was decided: user, user_rule, fuzzy_rule, keyword, mcc, default
    category_source: Mapped[str] = mapped_column(String(16), default="default")
    category_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="transactions")
    category: Mapped[Category] = relationship()


class MerchantRule(Base):
    """A categorisation rule learned from a user override."""

    __tablename__ = "merchant_rules"
    __table_args__ = (UniqueConstraint("user_id", "pattern", name="uq_rule_pattern"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    pattern: Mapped[str] = mapped_column(String(160))
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    hits: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    category: Mapped[Category] = relationship()


class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (UniqueConstraint("user_id", "category_id", name="uq_budget_category"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    monthly_limit: Mapped[float] = mapped_column(Float)

    category: Mapped[Category] = relationship()


class BudgetAlertLog(Base):
    """Remembers which threshold alerts were already sent for a month."""

    __tablename__ = "budget_alert_logs"
    __table_args__ = (UniqueConstraint("user_id", "category_id", "month", "threshold", name="uq_alert_once"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    month: Mapped[str] = mapped_column(String(7))  # YYYY-MM
    threshold: Mapped[int] = mapped_column(Integer)  # 80 or 100
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FixedExpense(Base):
    """A planned recurring commitment (rent, insurance, ...)."""

    __tablename__ = "fixed_expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    amount: Mapped[float] = mapped_column(Float)  # positive value
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    day_of_month: Mapped[int] = mapped_column(Integer, default=1)

    category: Mapped[Category] = relationship()


class SavingsGoal(Base):
    __tablename__ = "savings_goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    emoji: Mapped[str] = mapped_column(String(8), default="🎯")
    target_amount: Mapped[float] = mapped_column(Float)
    saved_amount: Mapped[float] = mapped_column(Float, default=0.0)
    deadline: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WhatsAppMessage(Base):
    __tablename__ = "whatsapp_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    direction: Mapped[str] = mapped_column(String(3))  # in | out
    # reply | weekly_summary | budget_alert | free_to_spend | inbound
    kind: Mapped[str] = mapped_column(String(20), default="reply")
    body: Mapped[str] = mapped_column(Text)
    # received | sent | simulated | failed
    status: Mapped[str] = mapped_column(String(12), default="simulated")
    transaction_id: Mapped[int | None] = mapped_column(ForeignKey("transactions.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
