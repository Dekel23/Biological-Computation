"""Background jobs for proactive updates and periodic bank sync.

Times are in ``APP_TIMEZONE`` (default Asia/Jerusalem). The Israeli week starts
on Sunday, so the weekly summary goes out Sunday morning.
"""
from __future__ import annotations

import logging
import os
from collections.abc import Callable

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import SessionLocal
from models import User
from services.bank_sync import sync_user
from services.notifications import run_budget_checks, send_daily_updates, send_weekly_summaries

logger = logging.getLogger(__name__)
TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Jerusalem")


def _with_session(job: Callable[[Session], object], name: str) -> Callable[[], None]:
    def run() -> None:
        db = SessionLocal()
        try:
            result = job(db)
            logger.info("Job %s finished: %s", name, result)
        except Exception:  # keep the scheduler alive whatever a job does
            logger.exception("Job %s failed", name)
            db.rollback()
        finally:
            db.close()

    return run


def _sync_all(db: Session) -> int:
    return sum(r.created for user in db.scalars(select(User)) for r in sync_user(db, user))


def create_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone=TIMEZONE)
    jobs = [
        ("weekly_summary", send_weekly_summaries, CronTrigger(day_of_week="sun", hour=9, minute=0, timezone=TIMEZONE)),
        ("daily_update", send_daily_updates, CronTrigger(hour=20, minute=30, timezone=TIMEZONE)),
        ("bank_sync", _sync_all, IntervalTrigger(hours=6)),
        ("budget_alerts", run_budget_checks, IntervalTrigger(hours=1)),
    ]
    for job_id, job, trigger in jobs:
        scheduler.add_job(_with_session(job, job_id), trigger, id=job_id, name=job_id)
    return scheduler
