from datetime import date

import pytest

from services.nlp_parser import parse_message

TODAY = date(2026, 3, 15)


@pytest.mark.parametrize("text,intent,amount,description,lang", [
    ("I spent 50 on coffee", "expense", 50, "coffee", "en"),
    ("הוצאתי 50 שקל על קפה", "expense", 50, "קפה", "he"),
    ("120 groceries", "expense", 120, "groceries", "en"),
    ("קפה 18", "expense", 18, "קפה", "he"),
    ("₪1,250.50 ikea", "expense", 1250.5, "ikea", "en"),
    ("paid 2k for rent", "expense", 2000, "rent", "en"),
    ("fifty on lunch", "expense", 50, "lunch", "en"),
    ("two thousand five hundred for a laptop", "expense", 2500, "laptop", "en"),
    ("חמישים שקל פלאפל", "expense", 50, "פלאפל", "he"),
    ("שלוש מאות וחמישים על סופר", "expense", 350, "סופר", "he"),
    ("אלפיים וחמש מאות שכר דירה", "expense", 2500, "שכר דירה", "he"),
    ("שילמתי 40 ש\"ח במונית", "expense", 40, "במונית", "he"),
    ("got paid 3000", "income", 3000, None, "en"),
    ("קיבלתי 200 החזר", "income", 200, None, "he"),
    ("budget coffee 300", "set_budget", 300, "coffee", "en"),
    ("תקציב קפה 300", "set_budget", 300, "קפה", "he"),
])
def test_amount_and_intent(text, intent, amount, description, lang):
    parsed = parse_message(text, today=TODAY)
    assert parsed.intent == intent
    assert parsed.amount == amount
    assert parsed.language == lang
    if description is not None:
        assert parsed.description == description


@pytest.mark.parametrize("text,intent", [
    ("how much can I spend?", "balance"),
    ("כמה נשאר?", "balance"),
    ("summary", "summary"),
    ("סיכום שבועי", "summary"),
    ("budget", "budget"),
    ("תקציב", "budget"),
    ("goals", "goals"),
    ("undo", "undo"),
    ("ביטול", "undo"),
    ("help", "help"),
    ("עזרה", "help"),
    ("?", "help"),
    ("blah blah", "unknown"),
])
def test_commands(text, intent):
    assert parse_message(text, today=TODAY).intent == intent


def test_yesterday_and_merchant():
    parsed = parse_message("paid 89.90 at Super Pharm yesterday", today=TODAY)
    assert parsed.tx_date == date(2026, 3, 14)
    assert parsed.merchant == "Super Pharm"
    assert parse_message("אתמול 30 על קפה", today=TODAY).tx_date == date(2026, 3, 14)


def test_digits_without_letters_use_default_language():
    assert parse_message("45", default_language="he").language == "he"
