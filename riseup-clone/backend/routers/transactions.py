"""Transactions list/edit and mock Open Banking sync."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from database import get_db
from deps import get_category, get_current_user, validate_month
from models import BankAccount, Category, Transaction, User
from schemas import (
    as_utc,
    CategoryUpdateResult,
    TransactionCategoryUpdate,
    TransactionCreate,
    TransactionOut,
    TransactionPage,
)
from services.bank_sync import sync_user
from services.calculator import month_bounds
from services.categorizer import Categorizer
from services.notifications import check_budget_alerts

router = APIRouter(prefix="/api", tags=["transactions"])


@router.get("/transactions", response_model=TransactionPage)
def list_transactions(
    month: str | None = Query(default=None, description="YYYY-MM; omit for the current month"),
    category: str | None = Query(default=None, description="category key"),
    q: str | None = Query(default=None, max_length=100, description="search merchant / description"),
    source: str | None = Query(default=None, pattern="^(bank|cash|manual)$"),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TransactionPage:
    first, last = month_bounds(validate_month(month))
    conditions = [Transaction.user_id == user.id, Transaction.date >= first, Transaction.date <= last]
    if category:
        conditions.append(Transaction.category_id == get_category(db, category).id)
    if source:
        conditions.append(Transaction.source == source)
    if q:
        like = f"%{q.strip()}%"
        conditions.append(or_(Transaction.merchant.ilike(like), Transaction.description.ilike(like)))

    total, income, expenses = db.execute(
        select(
            func.count(Transaction.id),
            func.coalesce(func.sum(Transaction.amount).filter(Transaction.amount > 0), 0.0),
            func.coalesce(func.sum(Transaction.amount).filter(Transaction.amount < 0), 0.0),
        ).where(*conditions)
    ).one()
    items = db.scalars(
        select(Transaction).options(joinedload(Transaction.category)).where(*conditions)
        .order_by(Transaction.date.desc(), Transaction.id.desc()).limit(limit).offset(offset)
    ).all()
    return TransactionPage(items=items, total=total, income=round(income, 2), expenses=round(-expenses, 2))


@router.post("/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(payload: TransactionCreate, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)) -> Transaction:
    amount = payload.amount if payload.kind == "income" else -payload.amount
    tx = Transaction(user_id=user.id, date=payload.date, amount=round(amount, 2), merchant=payload.merchant,
                     description=payload.description, source="manual")
    categorizer = Categorizer(db, user.id)
    if payload.category_key:
        category = get_category(db, payload.category_key)
        if category.is_income != (amount > 0):
            raise HTTPException(status_code=422, detail="Category does not match income/expense")
        tx.category_id, tx.category_source, tx.category_confidence = category.id, "user", 1.0
    else:
        categorizer.apply(tx)
    db.add(tx)
    db.commit()
    db.refresh(tx)
    if amount < 0:
        check_budget_alerts(db, user)
    return tx


@router.patch("/transactions/{tx_id}/category", response_model=CategoryUpdateResult)
def update_category(tx_id: int, payload: TransactionCategoryUpdate, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)) -> CategoryUpdateResult:
    tx = db.get(Transaction, tx_id)
    if tx is None or tx.user_id != user.id:
        raise HTTPException(status_code=404, detail="Transaction not found")
    category = get_category(db, payload.category_key)
    if category.is_income != (tx.amount > 0):
        raise HTTPException(status_code=422, detail="Category does not match income/expense")

    tx.category_id, tx.category_source, tx.category_confidence = category.id, "user", 1.0
    recategorized = 0
    if payload.learn:
        recategorized = Categorizer(db, user.id).learn(tx.merchant, category.key, apply_to_existing=True)
    db.commit()
    db.refresh(tx)
    check_budget_alerts(db, user)
    return CategoryUpdateResult(transaction=TransactionOut.model_validate(tx), learned=payload.learn,
                                recategorized=recategorized)


@router.delete("/transactions/{tx_id}", status_code=204)
def delete_transaction(tx_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    tx = db.get(Transaction, tx_id)
    if tx is None or tx.user_id != user.id:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx.source == "bank":
        raise HTTPException(status_code=409, detail="Bank transactions are read-only")
    db.delete(tx)
    db.commit()
    return Response(status_code=204)


# -- mock open banking ---------------------------------------------------------
@router.get("/bank/accounts")
def list_accounts(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    rows = db.scalars(select(BankAccount).where(BankAccount.user_id == user.id).order_by(BankAccount.id))
    return [{"id": a.id, "bank_name": a.bank_name, "account_mask": a.account_mask,
             "last_synced_at": as_utc(a.last_synced_at), "synced_until": a.synced_until} for a in rows]


@router.post("/bank/sync")
def sync_bank(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    results = sync_user(db, user, notify=True)
    return {"accounts": [r.as_dict() for r in results], "created": sum(r.created for r in results)}


@router.get("/categories/stats")
def categorization_stats(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """How transactions were categorised – handy to watch the engine learn."""
    rows = db.execute(
        select(Transaction.category_source, func.count(Transaction.id))
        .where(Transaction.user_id == user.id).group_by(Transaction.category_source)
    ).all()
    uncategorised = db.scalar(
        select(func.count(Transaction.id)).join(Category)
        .where(Transaction.user_id == user.id, Category.key.in_(["other", "other_income"]))
    )
    return {"by_source": {source: count for source, count in rows}, "uncategorized": uncategorised}
