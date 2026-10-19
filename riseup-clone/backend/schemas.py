"""Pydantic request/response schemas."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator


def as_utc(value: datetime | None) -> datetime | None:
    """SQLite drops tzinfo; stored values are UTC, so say so on the way out."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


UTCDateTime = Annotated[datetime, AfterValidator(as_utc)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class CategoryOut(ORM):
    id: int
    key: str
    name_en: str
    name_he: str
    icon: str
    color: str
    is_fixed: bool
    is_income: bool


class TransactionOut(ORM):
    id: int
    date: date
    amount: float
    merchant: str
    description: str | None
    mcc: str | None
    source: str
    category_source: str
    category_confidence: float
    category: CategoryOut
    account_id: int | None


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int
    income: float
    expenses: float


class TransactionCreate(BaseModel):
    date: date
    amount: float = Field(gt=0, description="Positive amount; direction is given by `kind`.")
    kind: Literal["expense", "income"] = "expense"
    merchant: str = Field(min_length=1, max_length=160)
    category_key: str | None = None
    description: str | None = Field(default=None, max_length=500)

    @field_validator("merchant")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("merchant must not be blank")
        return v


class TransactionCategoryUpdate(BaseModel):
    category_key: str
    learn: bool = True  # remember for this merchant and recategorise its history


class CategoryUpdateResult(BaseModel):
    transaction: TransactionOut
    learned: bool
    recategorized: int


class SettingsOut(ORM):
    name: str
    phone: str | None
    language: Literal["en", "he"]
    currency: str
    expected_monthly_income: float
    weekly_summary_enabled: bool
    budget_alerts_enabled: bool
    daily_update_enabled: bool


class SettingsUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    language: Literal["en", "he"] | None = None
    currency: Literal["ILS", "USD", "EUR", "GBP"] | None = None
    expected_monthly_income: float | None = Field(default=None, ge=0)
    weekly_summary_enabled: bool | None = None
    budget_alerts_enabled: bool | None = None
    daily_update_enabled: bool | None = None

    @field_validator("phone")
    @classmethod
    def _digits(cls, v: str | None) -> str | None:
        if v is None:
            return v
        digits = "".join(ch for ch in v if ch.isdigit())
        if digits.startswith("0"):  # local Israeli format 05x… → 9725x…
            digits = "972" + digits[1:]
        if not 8 <= len(digits) <= 15:
            raise ValueError("phone must have 8-15 digits")
        return digits


class BudgetIn(BaseModel):
    category_key: str
    monthly_limit: float = Field(gt=0)


class BudgetOut(BaseModel):
    id: int
    category: CategoryOut
    monthly_limit: float


class FixedExpenseIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    amount: float = Field(gt=0)
    category_key: str
    day_of_month: int = Field(default=1, ge=1, le=31)


class FixedExpenseOut(BaseModel):
    id: int
    name: str
    amount: float
    day_of_month: int
    category: CategoryOut


class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    emoji: str = Field(default="🎯", max_length=8)
    target_amount: float = Field(gt=0)
    saved_amount: float = Field(default=0, ge=0)
    deadline: date | None = None


class GoalUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    emoji: str | None = Field(default=None, max_length=8)
    target_amount: float | None = Field(default=None, gt=0)
    deadline: date | None = None


class GoalDeposit(BaseModel):
    amount: float = Field(description="Positive to deposit, negative to withdraw.")

    @field_validator("amount")
    @classmethod
    def _non_zero(cls, v: float) -> float:
        if v == 0:
            raise ValueError("amount must not be zero")
        return v


class WhatsAppMessageOut(ORM):
    id: int
    direction: str
    kind: str
    body: str
    status: str
    transaction_id: int | None
    created_at: UTCDateTime


class SimulateIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class SimulateOut(BaseModel):
    intent: str
    language: str
    amount: float | None
    messages: list[WhatsAppMessageOut]
    transaction: TransactionOut | None
