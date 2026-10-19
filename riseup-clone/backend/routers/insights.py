"""Subscription Radar and Savings Goals endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user
from models import SavingsGoal, User
from schemas import GoalDeposit, GoalIn, GoalUpdate
from services.insights import detect_subscriptions, goals_overview

router = APIRouter(prefix="/api", tags=["insights"])


@router.get("/insights/subscriptions")
def subscriptions(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return detect_subscriptions(db, user)


@router.get("/goals")
def list_goals(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return goals_overview(db, user)


def _own_goal(db: Session, user: User, goal_id: int) -> SavingsGoal:
    goal = db.get(SavingsGoal, goal_id)
    if goal is None or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal


@router.post("/goals", status_code=201)
def create_goal(payload: GoalIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    db.add(SavingsGoal(user_id=user.id, **payload.model_dump()))
    db.commit()
    return goals_overview(db, user)


@router.patch("/goals/{goal_id}")
def update_goal(goal_id: int, payload: GoalUpdate, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)) -> dict:
    goal = _own_goal(db, user, goal_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is None and field != "deadline":
            continue
        setattr(goal, field, value)
    db.commit()
    return goals_overview(db, user)


@router.post("/goals/{goal_id}/deposit")
def deposit(goal_id: int, payload: GoalDeposit, db: Session = Depends(get_db),
            user: User = Depends(get_current_user)) -> dict:
    goal = _own_goal(db, user, goal_id)
    new_amount = round(goal.saved_amount + payload.amount, 2)
    if new_amount < 0:
        raise HTTPException(status_code=422, detail="Cannot withdraw more than is saved")
    goal.saved_amount = new_amount
    db.commit()
    return goals_overview(db, user)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    db.delete(_own_goal(db, user, goal_id))
    db.commit()
    return Response(status_code=204)
