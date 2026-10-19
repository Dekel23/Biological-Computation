"""Bottom Line ("Free to Spend") calculator.

    free_to_spend = total_income - fixed_expenses - variable_expenses

* ``total_income``  – income received this month, or the user's expected monthly
  income if the salary has not landed yet (``income_is_projected``).
* ``fixed_expenses`` – per fixed category, the larger of what was actually
  charged and what is planned (FixedExpense rows). Commitments still to be
  charged are therefore already reserved.
* ``variable_expenses`` – everything else spent this month. Cash uses an
  "envelope" rule so it is not double counted: an ATM withdrawal is money
  leaving the account, a cash expense logged via WhatsApp is how that cash
  was spent, so the month counts ``max(withdrawn, logged_cash)``.

On top of the bottom line the calculator projects an end-of-month forecast
from the current daily spending pace, a daily allowance, budget usage and the
chart series used by the dashboard.
"""
from __future__ import annotations

import calendar
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Budget, Category, FixedExpense, Transaction, User


def month_bounds(month: str | None) -> tuple[date, date]:
    """'YYYY-MM' (default: current month) → (first_day, last_day)."""
    if month:
        year, mon = (int(part) for part in month.split("-"))
    else:
        today = date.today()
        year, mon = today.year, today.month
    last = calendar.monthrange(year, mon)[1]
    return date(year, mon, 1), date(year, mon, last)


def shift_month(first_day: date, delta: int) -> date:
    index = first_day.year * 12 + first_day.month - 1 + delta
    return date(index // 12, index % 12 + 1, 1)


@dataclass
class CategoryTotal:
    key: str
    name_en: str
    name_he: str
    icon: str
    color: str
    is_fixed: bool
    amount: float
    planned: float = 0.0
    budget: float | None = None
    budget_used_pct: float | None = None


@dataclass
class BottomLine:
    month: str
    currency: str
    total_income: float
    actual_income: float
    income_is_projected: bool
    fixed_expenses: float
    fixed_actual: float
    fixed_pending: float
    variable_expenses: float
    unallocated_cash: float
    free_to_spend: float
    days_in_month: int
    days_left: int
    daily_allowance: float
    forecast_variable: float
    forecast_free_to_spend: float
    status: str  # great | ok | tight | over
    categories: list[CategoryTotal] = field(default_factory=list)
    daily_series: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


def _r(value: float) -> float:
    return round(value + 0.0, 2)


def compute_bottom_line(db: Session, user: User, month: str | None = None, today: date | None = None) -> BottomLine:
    first, last = month_bounds(month)
    today = today or date.today()
    is_current = first <= today <= last
    is_future = today < first
    effective_day = last if not is_current and not is_future else (today if is_current else first - timedelta(days=1))

    cats = {c.id: c for c in db.scalars(select(Category))}
    txs = list(db.scalars(
        select(Transaction).where(
            Transaction.user_id == user.id, Transaction.date >= first, Transaction.date <= last
        )
    ))
    planned = list(db.scalars(select(FixedExpense).where(FixedExpense.user_id == user.id)))
    budgets = {b.category_id: b.monthly_limit for b in db.scalars(select(Budget).where(Budget.user_id == user.id))}

    actual_income = 0.0
    spent_by_cat: dict[int, float] = defaultdict(float)
    withdrawn_cash = 0.0
    logged_cash = 0.0
    daily_variable: dict[date, float] = defaultdict(float)
    daily_withdrawn: dict[date, float] = defaultdict(float)
    daily_logged_cash: dict[date, float] = defaultdict(float)

    for tx in txs:
        cat = cats[tx.category_id]
        if tx.amount > 0:
            if cat.is_income:
                actual_income += tx.amount
            else:
                # A refund in an expense category reduces that category's spend.
                spent_by_cat[tx.category_id] -= tx.amount
            continue
        spend = -tx.amount
        if cat.key == "cash" and tx.source == "bank":
            withdrawn_cash += spend
            daily_withdrawn[tx.date] += spend
            continue
        spent_by_cat[tx.category_id] += spend
        if tx.source == "cash":
            logged_cash += spend
            daily_logged_cash[tx.date] += spend
        if not cat.is_fixed:
            daily_variable[tx.date] += spend

    planned_by_cat: dict[int, float] = defaultdict(float)
    for fe in planned:
        planned_by_cat[fe.category_id] += fe.amount

    fixed_actual = sum(v for cid, v in spent_by_cat.items() if cats[cid].is_fixed)
    fixed_total = 0.0
    for cid in set(planned_by_cat) | {cid for cid in spent_by_cat if cats[cid].is_fixed}:
        # For past months only what was actually charged counts.
        plan = planned_by_cat.get(cid, 0.0) if (is_current or is_future) else 0.0
        fixed_total += max(spent_by_cat.get(cid, 0.0), plan)

    variable_categorised = sum(v for cid, v in spent_by_cat.items() if not cats[cid].is_fixed)
    unallocated_cash = max(0.0, withdrawn_cash - logged_cash)
    variable_total = variable_categorised + unallocated_cash

    expected = user.expected_monthly_income or 0.0
    income_is_projected = (is_current or is_future) and expected > actual_income
    total_income = expected if income_is_projected else actual_income

    free = total_income - fixed_total - variable_total

    days_in_month = last.day
    if is_current:
        days_left = (last - today).days + 1
        elapsed = today.day
    elif is_future:
        days_left, elapsed = days_in_month, 0
    else:
        days_left, elapsed = 0, days_in_month
    daily_allowance = free / days_left if days_left and free > 0 else 0.0

    # Forecast: continue the month's average daily variable pace for remaining days.
    if is_current and elapsed:
        pace = variable_total / elapsed
        forecast_variable = variable_total + pace * (days_left - 1)
    else:
        forecast_variable = variable_total
    forecast_free = total_income - fixed_total - forecast_variable

    if free < 0:
        status = "over"
    elif total_income and forecast_free < 0:
        status = "tight"
    elif total_income and forecast_free < 0.1 * total_income:
        status = "ok"
    else:
        status = "great"

    category_totals: list[CategoryTotal] = []
    if unallocated_cash:
        spent_by_cat[next(cid for cid, c in cats.items() if c.key == "cash")] += unallocated_cash
    for cid in set(spent_by_cat) | set(planned_by_cat) | set(budgets):
        cat = cats[cid]
        if cat.is_income:
            continue
        amount = spent_by_cat.get(cid, 0.0)
        limit = budgets.get(cid)
        category_totals.append(CategoryTotal(
            key=cat.key, name_en=cat.name_en, name_he=cat.name_he, icon=cat.icon, color=cat.color,
            is_fixed=cat.is_fixed, amount=_r(amount), planned=_r(planned_by_cat.get(cid, 0.0)),
            budget=limit, budget_used_pct=round(100 * amount / limit, 1) if limit else None,
        ))
    category_totals.sort(key=lambda c: c.amount, reverse=True)

    # Cumulative variable spend per day vs. an even "ideal" pace that would end the
    # month exactly at zero free-to-spend.
    variable_budget = max(0.0, total_income - fixed_total)
    series, running, cum_withdrawn, cum_logged = [], 0.0, 0.0, 0.0
    for day_no in range(1, days_in_month + 1):
        day = date(first.year, first.month, day_no)
        point = {"day": day_no, "date": day.isoformat(),
                 "ideal": _r(variable_budget * day_no / days_in_month), "actual": None}
        if day <= effective_day:
            running += daily_variable.get(day, 0.0)
            cum_withdrawn += daily_withdrawn.get(day, 0.0)
            cum_logged += daily_logged_cash.get(day, 0.0)
            point["actual"] = _r(running + max(0.0, cum_withdrawn - cum_logged))
        series.append(point)

    return BottomLine(
        month=f"{first.year:04d}-{first.month:02d}", currency=user.currency,
        total_income=_r(total_income), actual_income=_r(actual_income), income_is_projected=income_is_projected,
        fixed_expenses=_r(fixed_total), fixed_actual=_r(fixed_actual), fixed_pending=_r(fixed_total - fixed_actual),
        variable_expenses=_r(variable_total), unallocated_cash=_r(unallocated_cash), free_to_spend=_r(free),
        days_in_month=days_in_month, days_left=days_left, daily_allowance=_r(daily_allowance),
        forecast_variable=_r(forecast_variable), forecast_free_to_spend=_r(forecast_free), status=status,
        categories=category_totals, daily_series=series,
    )


def monthly_trend(db: Session, user: User, months: int = 6, today: date | None = None) -> list[dict]:
    """Income vs. expenses for the last ``months`` months (oldest first)."""
    today = today or date.today()
    current_first = date(today.year, today.month, 1)
    out = []
    for delta in range(-(months - 1), 1):
        first = shift_month(current_first, delta)
        bl = compute_bottom_line(db, user, f"{first.year:04d}-{first.month:02d}", today=today)
        out.append({
            "month": bl.month,
            "income": bl.actual_income,
            "expenses": _r(bl.fixed_actual + bl.variable_expenses),
            "net": _r(bl.actual_income - bl.fixed_actual - bl.variable_expenses),
        })
    return out
