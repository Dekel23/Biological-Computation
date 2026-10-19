import os
import sys
import tempfile
from pathlib import Path

import pytest

# Isolated database + no background jobs, configured before the app is imported.
_tmp = tempfile.mkdtemp(prefix="riseup-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_tmp) / 'test.db'}"
os.environ["ENABLE_SCHEDULER"] = "0"
os.environ["SEED_DEMO"] = "0"
os.environ.pop("WHATSAPP_TOKEN", None)
os.environ.pop("WHATSAPP_APP_SECRET", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
from main import app  # noqa: E402
from models import BankAccount, Category, User  # noqa: E402
from services.seed import seed_categories  # noqa: E402


@pytest.fixture()
def db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    seed_categories(session)
    yield session
    session.close()


@pytest.fixture()
def user(db):
    u = User(name="Test", phone="972500000001", language="en", currency="ILS", expected_monthly_income=10000)
    db.add(u)
    db.commit()
    return u


@pytest.fixture()
def account(db, user):
    a = BankAccount(user_id=user.id, bank_name="Isracard (mock)", account_mask="1111")
    db.add(a)
    db.commit()
    return a


@pytest.fixture()
def client(db, user):
    with TestClient(app) as c:
        yield c


def cat(db, key: str) -> Category:
    return db.scalar(select(Category).where(Category.key == key))
