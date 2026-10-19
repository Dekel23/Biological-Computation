"""Dashboard calculations and user settings (budgets, fixed expenses, profile)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from deps import get_category, get_current_user, validate_month
from models import Budget, Category, FixedExpense, User
from schemas import (
    BudgetIn,
    BudgetOut,
    CategoryOut,
    FixedExpenseIn,
    FixedExpenseOut,
    SettingsOut,
    SettingsUpdate,
)
from services.calculator import compute_bottom_line, monthly_trend
from services.insights import detect_subscriptions, goals_overview

router = APIRouter(prefix="/api", tags=["dashboard"])
@router.get("/dashboard/summary")
def dashboard_summary(
    month: str | None = Query(default=None, description="YYYY-MM, defaults to the current month"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    bottom_line = compute_bottom_line(db, user, validate_month(month))
    subscriptions = detect_subscriptions(db, user)
    goals = goals_overview(db, user)
    return {
        "user": {"name": user.name, "currency": user.currency, "language": user.language},
        "bottom_line": bottom_line.as_dict(),
        "trend": monthly_trend(db, user, months=6),
        "highlights": {
            "subscriptions_monthly": subscriptions["subscriptions_monthly"],
            "recurring_monthly": subscriptions["total_monthly"],
            "price_hikes": subscriptions["price_hikes"][:3],
            "goals_required_monthly": goals["total_required_monthly"],
            "goals_affordable": goals["affordable"],
        },
    }


@router.get("/dashboard/bottom-line")
def bottom_line(month: str | None = None, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)) -> dict:
    return compute_bottom_line(db, user, validate_month(month)).as_dict()


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)) -> list[Category]:
    return list(db.scalars(select(Category).order_by(Category.sort_order)))


# -- settings ----------------------------------------------------------------
@router.get("/settings", response_model=SettingsOut)
def get_settings(user: User = Depends(get_current_user)) -> User:
    return user


@router.put("/settings", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)) -> User:
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "name" and value is None:
            continue
        setattr(user, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This phone number is already linked to another user")
    return user


# -- budgets -----------------------------------------------------------------
def _budget_out(b: Budget) -> BudgetOut:
    return BudgetOut(id=b.id, category=CategoryOut.model_validate(b.category), monthly_limit=b.monthly_limit)


@router.get("/budgets", response_model=list[BudgetOut])
def list_budgets(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[BudgetOut]:
    rows = db.scalars(select(Budget).join(Category).where(Budget.user_id == user.id).order_by(Category.sort_order))
    return [_budget_out(b) for b in rows]


@router.put("/budgets", response_model=BudgetOut)
def upsert_budget(payload: BudgetIn, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)) -> BudgetOut:
    category = get_category(db, payload.category_key)
    if category.is_income:
        raise HTTPException(status_code=422, detail="Budgets apply to expense categories only")
    budget = db.scalar(select(Budget).where(Budget.user_id == user.id, Budget.category_id == category.id))
    if budget:
        budget.monthly_limit = payload.monthly_limit
    else:
        budget = Budget(user_id=user.id, category_id=category.id, monthly_limit=payload.monthly_limit)
        db.add(budget)
    db.commit()
    db.refresh(budget)
    return _budget_out(budget)


@router.delete("/budgets/{budget_id}", status_code=204)
def delete_budget(budget_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    budget = db.get(Budget, budget_id)
    if budget is None or budget.user_id != user.id:
        raise HTTPException(status_code=404, detail="Budget not found")
    db.delete(budget)
    db.commit()
    return Response(status_code=204)


# -- fixed expenses ----------------------------------------------------------
def _fixed_out(fe: FixedExpense) -> FixedExpenseOut:
    return FixedExpenseOut(id=fe.id, name=fe.name, amount=fe.amount, day_of_month=fe.day_of_month,
                           category=CategoryOut.model_validate(fe.category))


@router.get("/fixed-expenses", response_model=list[FixedExpenseOut])
def list_fixed(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[FixedExpenseOut]:
    rows = db.scalars(select(FixedExpense).where(FixedExpense.user_id == user.id).order_by(FixedExpense.day_of_month))
    return [_fixed_out(fe) for fe in rows]


@router.post("/fixed-expenses", response_model=FixedExpenseOut, status_code=201)
def create_fixed(payload: FixedExpenseIn, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)) -> FixedExpenseOut:
    category = get_category(db, payload.category_key)
    if not category.is_fixed:
        raise HTTPException(status_code=422, detail="Choose a fixed-expense category (rent, bills, ...)")
    fe = FixedExpense(user_id=user.id, name=payload.name, amount=payload.amount, category_id=category.id,
                      day_of_month=payload.day_of_month)
    db.add(fe)
    db.commit()
    db.refresh(fe)
    return _fixed_out(fe)


@router.delete("/fixed-expenses/{fixed_id}", status_code=204)
def delete_fixed(fixed_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    fe = db.get(FixedExpense, fixed_id)
    if fe is None or fe.user_id != user.id:
        raise HTTPException(status_code=404, detail="Fixed expense not found")
    db.delete(fe)
    db.commit()
    return Response(status_code=204)
