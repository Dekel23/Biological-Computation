"""Mock Open Banking provider + sync service.

``MockOpenBankingProvider`` mimics a read-only Open Banking (PSD2 / Israeli
Open Banking standard) account-information API: it can *only* list
transactions for a date range; there is no way to move money. Output is
deterministic per (account, day), so repeated syncs return the same
transactions and are de-duplicated by ``external_id``.
"""
from __future__ import annotations

import logging
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import BankAccount, Transaction, User
from services.categorizer import Categorizer

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BankTransaction:
    external_id: str
    date: date
    amount: float  # negative = debit
    merchant: str
    mcc: str | None
    description: str | None = None


# (merchant, mcc, min, max, weight) — a mix of Hebrew and English descriptors as
# they appear on Israeli card statements. Some merchants intentionally have no
# keyword so the MCC fallback / user learning paths get exercised.
CARD_MERCHANTS: list[tuple[str, str | None, float, float, int]] = [
    ("שופרסל דיל", "5411", 70, 340, 7),
    ("RAMI LEVY SHIVUK HASHIKMA", "5411", 110, 420, 4),
    ("ויקטורי סניף 14", "5411", 60, 300, 4),
    ("AM PM DIZENGOFF", "5499", 15, 90, 5),
    ("ארומה תל אביב", "5814", 14, 48, 8),
    ("COFIX 223", "5814", 6, 22, 6),
    ("LANDWER CAFE", "5812", 45, 140, 3),
    ("WOLT", "5812", 55, 160, 6),
    ("תן ביס", "5814", 35, 80, 4),
    ("MOSES RESTAURANT", "5812", 120, 340, 2),
    ("ג'ירף נורדאו", "5812", 90, 260, 2),
    ("GOLDA ICE CREAM", "5814", 18, 45, 2),
    ("RAV KAV ONLINE", "4111", 30, 100, 4),
    ("GETT TAXI", "4121", 25, 85, 3),
    ("פנגו חניה", "7523", 8, 30, 3),
    ("פז YELLOW", "5541", 180, 330, 3),
    ("SONOL", "5542", 150, 300, 2),
    ("סופר-פארם", "5912", 25, 210, 4),
    ("MACCABI HEALTHCARE", "8011", 20, 120, 1),
    ("ZARA AZRIELI", "5651", 120, 480, 2),
    ("ALIEXPRESS", "5999", 25, 160, 3),
    ("AMAZON MKTPLACE", "5999", 60, 320, 2),
    ("ACE חומרי בניין", "5200", 40, 260, 1),
    ("סינמה סיטי גלילות", "7832", 45, 140, 2),
    ("STEAM PURCHASE", "5818", 30, 120, 1),
    ("צומת ספרים", "5942", 50, 130, 1),
    ("חנות הפרחים של רינה", "5992", 60, 180, 1),
    ("MINI MARKET HAYARKON", None, 12, 70, 2),
]

# (day_of_month, merchant, mcc, base_amount, jitter)
CARD_SUBSCRIPTIONS: list[tuple[int, str, str, float, float]] = [
    (3, "NETFLIX.COM", "4899", 54.9, 0),
    (7, "SPOTIFY P1A2B3", "5815", 23.9, 0),
    (12, "APPLE.COM/BILL", "5818", 11.9, 0),
    (1, "HOLMES PLACE", "7997", 199.0, 0),
]

ACCOUNT_RECURRING: list[tuple[int, str, str | None, float, float]] = [
    (1, "שכר דירה - העברה", "6513", -4800.0, 0),
    (5, "הראל ביטוח", "6300", -265.0, 0),
    (5, "AYALON CAR INSURANCE", "6300", -158.0, 0),
    (10, "משכורת - חברת הייטק בעמ", None, 13950.0, 150),
    (15, "חברת החשמל", "4900", -390.0, 90),
    (16, "PARTNER COMMUNICATIONS", "4814", -99.0, 0),
    (20, "מי אביבים", "4900", -145.0, 35),
]


class MockOpenBankingProvider:
    """Read-only account information service."""

    def __init__(self, account: BankAccount):
        self.account = account
        self.is_card = "card" in account.bank_name.lower() or "isracard" in account.bank_name.lower()

    def _rng(self, day: date) -> random.Random:
        return random.Random(f"{self.account.id}:{self.account.account_mask}:{day.isoformat()}")

    def _day(self, day: date) -> list[BankTransaction]:
        rng = self._rng(day)
        txs: list[BankTransaction] = []

        def add(merchant: str, mcc: str | None, amount: float, description: str | None = None) -> None:
            txs.append(BankTransaction(
                external_id=f"mock-{self.account.id}-{day.isoformat()}-{len(txs)}",
                date=day, amount=round(amount, 2), merchant=merchant, mcc=mcc, description=description,
            ))

        if self.is_card:
            for dom, merchant, mcc, base, jitter in CARD_SUBSCRIPTIONS:
                if day.day == dom:
                    amount = base
                    # Demo a price increase for the subscription radar: Netflix went up
                    # starting with the most recent two billing cycles.
                    if merchant.startswith("NETFLIX") and day >= date.today() - timedelta(days=45):
                        amount = 64.9
                    add(merchant, mcc, -(amount + rng.uniform(-jitter, jitter)))
            weekend = day.weekday() in (4, 5)  # Fri/Sat in Israel
            count = rng.choices([0, 1, 2, 3], weights=[3, 5, 3, 1] if not weekend else [2, 4, 4, 2])[0]
            weights = [m[4] for m in CARD_MERCHANTS]
            for merchant, mcc, low, high, _w in rng.choices(CARD_MERCHANTS, weights=weights, k=count):
                add(merchant, mcc, -rng.uniform(low, high))
        else:
            for dom, merchant, mcc, base, jitter in ACCOUNT_RECURRING:
                if day.day == dom:
                    add(merchant, mcc, base + rng.uniform(-jitter, jitter))
            if rng.random() < 0.04:
                add("משיכת מזומן כספומט", "6011", -rng.choice([100, 200, 300]))
            if rng.random() < 0.07:
                friend = rng.choice(["Noa", "יוסי", "Amit", "מיכל"])
                if rng.random() < 0.5:
                    add(f"BIT transfer to {friend}", "4829", -rng.uniform(30, 250))
                else:
                    add(f"bit from {friend}", None, rng.uniform(30, 200))
        return txs

    def fetch_transactions(self, since: date, until: date) -> list[BankTransaction]:
        if since > until:
            return []
        out: list[BankTransaction] = []
        day = since
        while day <= until:
            out.extend(self._day(day))
            day += timedelta(days=1)
        return out


@dataclass
class SyncResult:
    account_id: int
    fetched: int
    created: int

    def as_dict(self) -> dict:
        return {"account_id": self.account_id, "fetched": self.fetched, "created": self.created}


def sync_account(
    db: Session, account: BankAccount, since: date | None = None, until: date | None = None, notify: bool = True
) -> SyncResult:
    today = date.today()
    until = until or today
    # Re-fetch the last synced day too: today's transactions may still be arriving.
    since = since or account.synced_until or (today - timedelta(days=90))

    bank_txs = MockOpenBankingProvider(account).fetch_transactions(since, until)
    known = set(db.scalars(
        select(Transaction.external_id).where(
            Transaction.user_id == account.user_id,
            Transaction.external_id.in_([t.external_id for t in bank_txs] or [""]),
        )
    ))
    categorizer = Categorizer(db, account.user_id)
    created: list[Transaction] = []
    for bt in bank_txs:
        if bt.external_id in known:
            continue
        tx = Transaction(
            user_id=account.user_id, account_id=account.id, external_id=bt.external_id, date=bt.date,
            amount=bt.amount, merchant=bt.merchant, mcc=bt.mcc, description=bt.description, source="bank",
        )
        categorizer.apply(tx)
        db.add(tx)
        created.append(tx)

    account.last_synced_at = datetime.now(timezone.utc)
    account.synced_until = max(until, account.synced_until or until)
    db.commit()

    if notify and created:
        from services.notifications import check_budget_alerts  # avoid import cycle

        check_budget_alerts(db, account.user)
    logger.info("Synced account %s: fetched=%d created=%d", account.id, len(bank_txs), len(created))
    return SyncResult(account.id, len(bank_txs), len(created))


def sync_user(db: Session, user: User, notify: bool = True) -> list[SyncResult]:
    return [sync_account(db, account, notify=notify) for account in user.accounts]
