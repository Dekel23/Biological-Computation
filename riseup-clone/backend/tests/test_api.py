import hashlib
import hmac
import json
from datetime import date, timedelta

from sqlalchemy import func, select

from models import Budget, BudgetAlertLog, Transaction, WhatsAppMessage
from services.bank_sync import sync_account
from services.insights import detect_subscriptions
from tests.conftest import cat


def test_bank_sync_is_idempotent(db, account):
    first = sync_account(db, account, since=date.today() - timedelta(days=30), notify=False)
    assert first.created > 0
    again = sync_account(db, account, since=date.today() - timedelta(days=30), notify=False)
    assert again.created == 0


def test_simulator_logs_hebrew_and_english_expenses(client, db, user):
    r = client.post("/api/whatsapp/simulate", json={"text": "הוצאתי 50 שקל על קפה"})
    assert r.status_code == 200
    body = r.json()
    assert body["intent"] == "expense" and body["language"] == "he"
    assert body["transaction"]["amount"] == -50
    assert body["transaction"]["category"]["key"] == "coffee"
    assert body["transaction"]["source"] == "cash"
    assert "נרשם" in body["messages"][1]["body"]

    r = client.post("/api/whatsapp/simulate", json={"text": "I spent 120 on groceries"})
    assert r.json()["transaction"]["category"]["key"] == "groceries"
    assert "Logged" in r.json()["messages"][1]["body"]

    r = client.post("/api/whatsapp/simulate", json={"text": "undo"})
    assert "Removed" in r.json()["messages"][1]["body"]
    assert db.scalar(select(func.count(Transaction.id))) == 1


def test_budget_alerts_sent_once_per_threshold(client, db, user):
    db.add(Budget(user_id=user.id, category_id=cat(db, "coffee").id, monthly_limit=100))
    db.commit()
    r = client.post("/api/whatsapp/simulate", json={"text": "85 coffee"})
    alerts = [m for m in r.json()["messages"] if m["kind"] == "budget_alert"]
    assert len(alerts) == 1 and "85%" in alerts[0]["body"]
    r = client.post("/api/whatsapp/simulate", json={"text": "5 coffee"})
    assert not [m for m in r.json()["messages"] if m["kind"] == "budget_alert"]
    r = client.post("/api/whatsapp/simulate", json={"text": "20 coffee"})
    alerts = [m for m in r.json()["messages"] if m["kind"] == "budget_alert"]
    assert len(alerts) == 1 and "over" in alerts[0]["body"]
    assert db.scalar(select(func.count(BudgetAlertLog.id))) == 2


def test_category_override_learns(client, db, user):
    tx = client.post("/api/transactions", json={
        "date": date.today().isoformat(), "amount": 70, "merchant": "Mystery Shop 12", "kind": "expense"
    }).json()
    assert tx["category"]["key"] == "other"
    client.post("/api/transactions", json={
        "date": date.today().isoformat(), "amount": 30, "merchant": "MYSTERY SHOP 7", "kind": "expense"
    })
    r = client.patch(f"/api/transactions/{tx['id']}/category", json={"category_key": "kids"})
    assert r.status_code == 200
    assert r.json()["recategorized"] == 1
    new = client.post("/api/transactions", json={
        "date": date.today().isoformat(), "amount": 15, "merchant": "Mystery Shop", "kind": "expense"
    }).json()
    assert new["category"]["key"] == "kids" and new["category_source"] == "user_rule"


def test_income_category_mismatch_rejected(client, db, user):
    tx = client.post("/api/transactions", json={
        "date": date.today().isoformat(), "amount": 70, "merchant": "Aroma", "kind": "expense"
    }).json()
    r = client.patch(f"/api/transactions/{tx['id']}/category", json={"category_key": "salary"})
    assert r.status_code == 422


def test_meta_webhook_verification_and_inbound(client, db, user, monkeypatch):
    r = client.get("/api/whatsapp/webhook", params={
        "hub.mode": "subscribe", "hub.verify_token": "riseup-dev-verify-token", "hub.challenge": "42"})
    assert r.status_code == 200 and r.text == "42"
    assert client.get("/api/whatsapp/webhook", params={
        "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42"}).status_code == 403

    payload = {"entry": [{"changes": [{"value": {"messages": [
        {"from": user.phone, "type": "text", "text": {"body": "קפה 18"}},
        {"from": "972599999999", "type": "text", "text": {"body": "50 coffee"}},
    ]}}]}]}
    raw = json.dumps(payload).encode()
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "s3cret")
    assert client.post("/api/whatsapp/webhook", content=raw,
                       headers={"X-Hub-Signature-256": "sha256=bad"}).status_code == 401
    signature = "sha256=" + hmac.new(b"s3cret", raw, hashlib.sha256).hexdigest()
    r = client.post("/api/whatsapp/webhook", content=raw, headers={"X-Hub-Signature-256": signature})
    assert r.json() == {"status": "ok", "processed": 1, "ignored": 1}
    tx = db.scalar(select(Transaction))
    assert tx.amount == -18 and tx.category.key == "coffee"


def test_proactive_updates(client, db, user, account):
    sync_account(db, account, since=date.today() - timedelta(days=20), notify=False)
    r = client.post("/api/whatsapp/proactive/weekly_summary")
    assert r.status_code == 200 and "Weekly summary" in r.json()[0]["body"]
    r = client.post("/api/whatsapp/proactive/free_to_spend")
    assert "Free to spend" in r.json()[0]["body"]
    user.language = "he"
    db.commit()
    r = client.post("/api/whatsapp/proactive/weekly_summary")
    assert "סיכום שבועי" in r.json()[0]["body"]
    assert db.scalar(select(func.count(WhatsAppMessage.id))) == 3


def test_subscription_radar_detects_price_hike(db, user):
    sub = cat(db, "subscriptions").id
    today = date(2026, 6, 20)
    for i, amount in enumerate([54.9, 54.9, 54.9, 64.9]):
        db.add(Transaction(user_id=user.id, date=date(2026, 3 + i, 3), amount=-amount, merchant="NETFLIX.COM",
                           category_id=sub))
    for d in (1, 9, 12, 25, 40):  # irregular merchant must not be flagged
        db.add(Transaction(user_id=user.id, date=date(2026, 5, 1) + timedelta(days=d), amount=-40,
                           merchant="Random Kiosk", category_id=cat(db, "other").id))
    db.commit()
    radar = detect_subscriptions(db, user, today=today)
    assert [s["merchant"] for s in radar["items"]] == ["NETFLIX.COM"]
    assert radar["items"][0]["price_change_pct"] == 18.2
    assert radar["price_hikes"][0]["merchant"] == "NETFLIX.COM"


def test_dashboard_settings_and_goals(client, db, user):
    s = client.get("/api/dashboard/summary").json()
    assert s["bottom_line"]["total_income"] == 10000
    assert client.get("/api/dashboard/summary", params={"month": "2026-13"}).status_code == 422

    r = client.put("/api/settings", json={"language": "he", "phone": "050-123-4567"})
    assert r.json()["language"] == "he" and r.json()["phone"] == "972501234567"

    g = client.post("/api/goals", json={"name": "Car", "target_amount": 12000,
                                        "deadline": (date.today() + timedelta(days=360)).isoformat()}).json()
    goal = g["items"][0]
    assert goal["required_monthly"] == 1000
    after = client.post(f"/api/goals/{goal['id']}/deposit", json={"amount": 3000}).json()
    assert after["items"][0]["saved_amount"] == 3000
    assert client.post(f"/api/goals/{goal['id']}/deposit", json={"amount": -5000}).status_code == 422

    r = client.put("/api/budgets", json={"category_key": "coffee", "monthly_limit": 200})
    assert r.status_code == 200
    assert client.put("/api/budgets", json={"category_key": "salary", "monthly_limit": 1}).status_code == 422


def test_budget_alert_follows_message_language(client, db, user):
    db.add(Budget(user_id=user.id, category_id=cat(db, "coffee").id, monthly_limit=100))
    db.commit()
    r = client.post("/api/whatsapp/simulate", json={"text": "הוצאתי 120 שקל על קפה"})
    alerts = [m for m in r.json()["messages"] if m["kind"] == "budget_alert"]
    assert len(alerts) == 1 and "חרגת" in alerts[0]["body"]
