from datetime import date

import pytest

from models import Transaction
from services.categorizer import Categorizer, match_keyword, merchant_key, normalize
from tests.conftest import cat


def test_normalize_hebrew_final_letters_and_niqqud():
    assert normalize("שָׁלוֹם") == normalize("שלומ")
    assert normalize("סופר-פארם") == "סופר פארמ"
    assert normalize("קפה ג'ו") == "קפה גו"


def test_merchant_key_drops_noise_and_branch_numbers():
    assert merchant_key("COFIX 223") == "cofix"
    assert merchant_key('שופרסל בע"מ סניף 12') == "שופרסל"
    assert merchant_key("012") == "012"


@pytest.mark.parametrize("text,expected", [
    ("ארומה תל אביב", "coffee"),
    ("AROMA ESPRESSO BAR", "coffee"),
    ("בקפה", "coffee"),  # attached Hebrew prefix
    ("שופרסל דיל", "groceries"),
    ("RAMI LEVY SHIVUK", "groceries"),
    ("סופר-פארם", "health"),  # longest keyword beats generic "סופר"
    ("NETFLIX.COM", "subscriptions"),
    ("פז YELLOW", "fuel"),
    ("רב קו", "transport"),
    ("WOLT", "restaurants"),
    ("משכורת חודש מאי", "salary"),
])
def test_keyword_matching_bilingual(text, expected):
    assert match_keyword(text) == expected


def test_short_latin_keywords_need_word_boundaries():
    assert match_keyword("TENANT SERVICES") != "fuel"


def test_mcc_fallback_and_default(db, user):
    c = Categorizer(db, user.id)
    assert c.categorize("ג'ירף נורדאו", -120, "5812").source == "mcc"
    assert c.categorize("ג'ירף נורדאו", -120, "5812").category_key == "restaurants"
    unknown = c.categorize("חנות הפרחים של רינה", -80, "5992")
    assert (unknown.category_key, unknown.source) == ("other", "default")
    assert c.categorize("Unknown payer", 500).category_key == "other_income"


def test_income_never_lands_in_expense_category(db, user):
    c = Categorizer(db, user.id)
    assert c.categorize("bit from Noa", 120).category_key == "other_income"
    assert c.categorize("BIT transfer to Noa", -120).category_key == "transfers"


def test_learning_from_override_applies_to_history_and_future(db, user):
    flowers = [Transaction(user_id=user.id, date=date(2026, 1, d), amount=-80, merchant="חנות הפרחים של רינה",
                           category_id=cat(db, "other").id) for d in (1, 2)]
    manual = Transaction(user_id=user.id, date=date(2026, 1, 3), amount=-80, merchant="חנות הפרחים של רינה",
                         category_id=cat(db, "kids").id, category_source="user")
    db.add_all([*flowers, manual])
    db.commit()

    c = Categorizer(db, user.id)
    changed = c.learn("חנות הפרחים של רינה", "shopping")
    db.commit()
    assert changed == 2
    assert {tx.category.key for tx in flowers} == {"shopping"}
    assert manual.category.key == "kids"  # manual choices are never overwritten

    assert c.categorize("חנות הפרחים של רינה", -50).source == "user_rule"
    assert c.categorize("חנות הפרחים של רינה סניף 2", -50).category_key == "shopping"
    fuzzy = c.categorize("חנות הפרחים של רינא", -50)  # typo / transliteration variant
    assert (fuzzy.category_key, fuzzy.source) == ("shopping", "fuzzy_rule")


def test_learned_rule_beats_builtin_keyword(db, user):
    c = Categorizer(db, user.id)
    assert c.categorize("AROMA", -30).category_key == "coffee"
    c.learn("AROMA", "restaurants")
    db.commit()
    assert c.categorize("AROMA", -30).category_key == "restaurants"
