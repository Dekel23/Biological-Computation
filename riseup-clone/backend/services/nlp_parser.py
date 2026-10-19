"""Rule-based bilingual (English / Hebrew) parser for WhatsApp messages.

Examples it understands::

    "I spent 50 on coffee"            -> expense 50, "coffee"
    "הוצאתי 50 שקל על קפה"             -> expense 50, "קפה"
    "paid ₪1,250.50 at IKEA yesterday" -> expense 1250.5, merchant "IKEA", yesterday
    "חמישים שקל פלאפל"                 -> expense 50 (Hebrew number words)
    "got paid 3k"                      -> income 3000
    "budget coffee 300" / "תקציב קפה 300" -> set_budget
    "how much can I spend?" / "כמה נשאר?" -> balance
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta

from services.categorizer import contains_hebrew, normalize

# ---------------------------------------------------------------------------
# Number words
# ---------------------------------------------------------------------------
_EN_NUMBERS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40,
    "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100, "thousand": 1000,
}
_HE_NUMBERS_RAW = {
    "אחד": 1, "אחת": 1, "שניים": 2, "שתיים": 2, "שני": 2, "שתי": 2, "שלוש": 3, "שלושה": 3, "שלושת": 3,
    "ארבע": 4, "ארבעה": 4, "ארבעת": 4, "חמש": 5, "חמישה": 5, "חמשת": 5, "שש": 6, "שישה": 6, "ששת": 6,
    "שבע": 7, "שבעה": 7, "שבעת": 7, "שמונה": 8, "שמונת": 8, "תשע": 9, "תשעה": 9, "תשעת": 9, "עשר": 10,
    "עשרה": 10, "עשרים": 20, "שלושים": 30, "ארבעים": 40, "חמישים": 50, "שישים": 60, "שבעים": 70,
    "שמונים": 80, "תשעים": 90, "מאה": 100, "מאות": 100, "מאתיים": 200, "אלף": 1000, "אלפים": 1000,
    "אלפיים": 2000,
}
_HE_NUMBERS = {normalize(k): v for k, v in _HE_NUMBERS_RAW.items()}
_MULTIPLIER_100 = {"hundred", normalize("מאות")}
_MULTIPLIER_1000 = {"thousand", normalize("אלף"), normalize("אלפים")}
_CONNECTORS = {"and", "ו"}

_AMOUNT_RE = re.compile(
    r"(?P<pre>[₪$€])?\s?(?<![\d.,])(?P<int>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?P<dec>\d{1,2}))?(?!\d)"
    r"\s?(?P<suffix>k\b|K\b|אלף)?"
)

# ---------------------------------------------------------------------------
# Vocabulary (normalised before use)
# ---------------------------------------------------------------------------
_CURRENCY_WORDS = {"₪", "$", "€", "nis", "ils", "shekel", "shekels", "sheqel", "שקל", "שקלים", "שח", "ש״ח", "ש\"ח"}
_FILLER_WORDS = {
    # English
    "i", "ive", "i've", "im", "just", "spent", "spend", "spending", "paid", "pay", "bought", "buy", "purchased",
    "on", "for", "at", "in", "a", "an", "the", "some", "today", "yesterday", "me", "my", "worth", "of", "got",
    "and", "expense", "cost", "costs", "was", "it", "to", "log", "add", "cash", "with",
    # Hebrew
    "הוצאתי", "הוצאנו", "שילמתי", "שילמנו", "קניתי", "קנינו", "על", "היום", "אתמול", "עלה", "עלתה", "עלו",
    "לי", "של", "הוצאה", "את", "קצת", "ש", "ב", "ל", "במזומן", "מזומן", "סך", "הכל", "בערך", "תרשום", "תוסיף",
}
_FILLER = {normalize(w) for w in _FILLER_WORDS} | {normalize(w) for w in _CURRENCY_WORDS}

_INTENT_PHRASES: dict[str, list[str]] = {
    "help": ["help", "menu", "commands", "start", "hi", "hello", "hey", "?", "עזרה", "תפריט", "פקודות",
             "שלום", "היי", "הי", "מה אפשר"],
    "undo": ["undo", "delete last", "remove last", "cancel last", "cancel", "oops", "ביטול", "בטל", "מחק",
             "תמחק", "טעות"],
    "balance": ["balance", "free to spend", "how much can i spend", "how much left", "how much is left",
                "left to spend", "remaining", "bottom line", "status", "כמה נשאר", "נשאר", "יתרה", "מצב",
                "שורה תחתונה", "כמה אפשר", "כמה מותר", "פנוי להוצאה", "כמה אני יכול", "כמה אני יכולה"],
    "summary": ["summary", "weekly", "report", "this week", "סיכום", "דוח", "דו\"ח", "שבועי", "השבוע"],
    "budget": ["budget", "budgets", "תקציב", "תקציבים"],
    "goals": ["goal", "goals", "savings", "saving", "יעד", "יעדים", "חיסכון", "חסכון"],
}
_INCOME_PHRASES = ["received", "got paid", "earned", "income", "salary", "bonus", "refund", "קיבלתי", "הרווחתי",
                   "הכנסה", "נכנס", "נכנסו", "משכורת", "בונוס", "החזר", "זיכוי"]
_YESTERDAY = {"yesterday", normalize("אתמול")}


def _phrase_regex(phrase: str) -> re.Pattern[str]:
    norm = normalize(phrase) or phrase
    if contains_hebrew(norm):
        return re.compile(rf"(?:^|\s)[בהוכלמש]?{re.escape(norm)}(?=\s|$|\?)")
    return re.compile(rf"(?<!\w){re.escape(norm)}(?!\w)")


_INTENT_RES = {intent: [_phrase_regex(p) for p in phrases] for intent, phrases in _INTENT_PHRASES.items()}
_INCOME_RES = [_phrase_regex(p) for p in _INCOME_PHRASES]


@dataclass
class ParsedMessage:
    intent: str  # expense | income | set_budget | balance | summary | budget | goals | undo | help | unknown
    language: str  # en | he
    raw: str
    amount: float | None = None
    description: str | None = None
    merchant: str | None = None
    tx_date: date | None = None


def detect_language(text: str, default: str = "en") -> str:
    if contains_hebrew(text):
        return "he"
    return "en" if re.search(r"[A-Za-z]", text) else default


def _parse_digits(text: str) -> tuple[float | None, tuple[int, int] | None]:
    best = None
    for m in _AMOUNT_RE.finditer(text):
        value = float(m.group("int").replace(",", ""))
        if m.group("dec"):
            value += float(f"0.{m.group('dec')}")
        if m.group("suffix"):
            value *= 1000
        # Prefer amounts with a currency marker, otherwise the largest number.
        score = (bool(m.group("pre") or m.group("suffix")), value)
        if best is None or score > best[0]:
            best = (score, value, m.span())
    if best is None:
        return None, None
    return best[1], best[2]


def _number_word_value(token: str) -> int | None:
    if token in _EN_NUMBERS:
        return _EN_NUMBERS[token]
    if token in _HE_NUMBERS:
        return _HE_NUMBERS[token]
    # Hebrew attached prefix: "וחמישים", "בעשרים", "במאה".
    if len(token) > 2 and token[0] in "ובל" and token[1:] in _HE_NUMBERS:
        return _HE_NUMBERS[token[1:]]
    return None


def _parse_number_words(tokens: list[str]) -> tuple[float | None, set[int]]:
    """Find the longest run of number words and evaluate it."""
    best_value, best_idx = None, set()
    i = 0
    while i < len(tokens):
        if _number_word_value(tokens[i]) is None:
            i += 1
            continue
        total, current, used, j = 0, 0, set(), i
        while j < len(tokens):
            tok = tokens[j]
            value = _number_word_value(tok)
            if value is None:
                if tok in _CONNECTORS and j + 1 < len(tokens) and _number_word_value(tokens[j + 1]) is not None:
                    used.add(j)
                    j += 1
                    continue
                break
            bare = tok[1:] if tok not in _EN_NUMBERS and tok not in _HE_NUMBERS else tok
            if bare in _MULTIPLIER_100:
                current = max(current, 1) * 100
            elif bare in _MULTIPLIER_1000:
                total += max(current, 1) * 1000
                current = 0
            elif value >= 1000:  # standalone thousands such as "אלפיים"
                total += value
            else:
                current += value
            used.add(j)
            j += 1
        value = total + current
        if best_value is None or len(used) > len(best_idx):
            best_value, best_idx = float(value), used
        i = j
    return best_value, best_idx


def _extract_merchant(text: str) -> str | None:
    m = re.search(r"\bat\s+([A-Za-z0-9&'\-. ]+?)(?:\s+(?:for|on|yesterday|today)\b|[,.!?]|$)", text, re.IGNORECASE)
    return m.group(1).strip() if m else None


def _matches_any(norm: str, patterns: list[re.Pattern[str]]) -> bool:
    return any(p.search(norm) for p in patterns)


def parse_message(text: str, default_language: str = "en", today: date | None = None) -> ParsedMessage:
    today = today or date.today()
    raw = (text or "").strip()
    language = detect_language(raw, default_language)
    parsed = ParsedMessage(intent="unknown", language=language, raw=raw)
    if not raw:
        parsed.intent = "help"
        return parsed

    amount, span = _parse_digits(raw)
    remainder = raw if span is None else (raw[: span[0]] + " " + raw[span[1]:])
    tokens = normalize(remainder).split()
    used_idx: set[int] = set()
    if amount is None:
        amount, used_idx = _parse_number_words(tokens)
        if amount == 0:
            amount = None
    norm_full = normalize(raw) or raw.lower()
    if raw.strip() == "?":
        norm_full = "?"

    if amount is not None:
        if _matches_any(norm_full, _INTENT_RES["budget"]):
            parsed.intent = "set_budget"
        elif _matches_any(norm_full, _INCOME_RES):
            parsed.intent = "income"
        else:
            parsed.intent = "expense"
    else:
        for intent in ("undo", "balance", "summary", "budget", "goals", "help"):
            if _matches_any(norm_full, _INTENT_RES[intent]):
                parsed.intent = intent
                break
        return parsed

    parsed.amount = round(amount, 2)
    if any(tok in _YESTERDAY for tok in tokens):
        parsed.tx_date = today - timedelta(days=1)
    else:
        parsed.tx_date = today

    budget_words = {normalize(w) for w in _INTENT_PHRASES["budget"]}
    income_words = {normalize(w) for w in _INCOME_PHRASES if " " not in w}
    keep = []
    for idx, tok in enumerate(tokens):
        if idx in used_idx or tok in _FILLER or tok in _YESTERDAY:
            continue
        if parsed.intent == "set_budget" and tok in budget_words:
            continue
        if parsed.intent == "income" and tok in income_words | {"paid"}:
            continue
        # Hebrew one-letter prefix glued to a filler word, e.g. "בשקלים".
        if contains_hebrew(tok) and len(tok) > 2 and tok[0] in "בלו" and tok[1:] in _FILLER:
            continue
        keep.append(tok)
    description = " ".join(keep).strip()
    parsed.description = description or None
    parsed.merchant = _extract_merchant(remainder) or parsed.description
    return parsed
