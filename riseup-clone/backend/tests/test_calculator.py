from datetime import date

from models import FixedExpense, Transaction
from services.calculator import compute_bottom_line, month_bounds
from tests.conftest import cat

TODAY = date(2026, 3, 11)  # 21 days left in March including today


def add(db, user, key, amount, day=5, source="bank", merchant="x"):
    tx = Transaction(user_id=user.id, date=date(2026, 3, day), amount=amount, merchant=merchant,
                     category_id=cat(db, key).id, source=source)
    db.add(tx)
    db.commit()
    return tx


def test_month_bounds():
    assert month_bounds("2024-02") == (date(2024, 2, 1), date(2024, 2, 29))


def test_free_to_spend_formula(db, user):
    user.expected_monthly_income = 0
    add(db, user, "salary", 12000, day=10)
    add(db, user, "rent", -4000, day=1)
    add(db, user, "groceries", -1000)
    add(db, user, "coffee", -100)
    bl = compute_bottom_line(db, user, "2026-03", today=TODAY)
    assert bl.total_income == 12000
    assert bl.fixed_expenses == 4000
    assert bl.variable_expenses == 1100
    assert bl.free_to_spend == 12000 - 4000 - 1100
    assert bl.days_left == 21
    assert bl.daily_allowance == round(6900 / 21, 2)


def test_expected_income_and_planned_fixed_are_reserved(db, user):
    db.add(FixedExpense(user_id=user.id, name="Rent", amount=4000, category_id=cat(db, "rent").id))
    db.add(FixedExpense(user_id=user.id, name="Insurance", amount=300, category_id=cat(db, "insurance").id))
    db.commit()
    add(db, user, "insurance", -320)  # charged a bit more than planned
    bl = compute_bottom_line(db, user, "2026-03", today=TODAY)
    assert bl.income_is_projected and bl.total_income == 10000
    assert bl.fixed_expenses == 4000 + 320
    assert bl.fixed_pending == 4000


def test_cash_envelope_is_not_double_counted(db, user):
    add(db, user, "cash", -500, merchant="ATM")
    add(db, user, "coffee", -30, source="cash")
    add(db, user, "restaurants", -70, source="cash")
    bl = compute_bottom_line(db, user, "2026-03", today=TODAY)
    assert bl.variable_expenses == 500
    assert bl.unallocated_cash == 400
    add(db, user, "groceries", -600, source="cash")  # spent more cash than withdrawn
    bl = compute_bottom_line(db, user, "2026-03", today=TODAY)
    assert bl.variable_expenses == 700
    assert bl.unallocated_cash == 0
    assert bl.daily_series[TODAY.day - 1]["actual"] == 700


def test_refund_reduces_category_spend(db, user):
    add(db, user, "shopping", -300)
    add(db, user, "shopping", 100)
    bl = compute_bottom_line(db, user, "2026-03", today=TODAY)
    assert bl.variable_expenses == 200
    assert bl.actual_income == 0


def test_forecast_uses_spending_pace(db, user):
    add(db, user, "groceries", -1100, day=3)  # 100/day over 11 elapsed days
    bl = compute_bottom_line(db, user, "2026-03", today=TODAY)
    assert bl.forecast_variable == 1100 + 100 * 20
    assert bl.status == "great"
