"""Smart categorisation engine.

Resolution order (first hit wins, each with its own confidence):

1. ``user_rule``  – exact match of the normalised merchant against a rule the
   user taught us by overriding a category (confidence 1.0).
2. ``user_rule``  – a learned pattern contained in the merchant, or vice versa
   (0.95). Handles "AROMA TLV 123" vs. a rule learned on "aroma".
3. ``keyword``    – built-in bilingual (English + Hebrew) keyword dictionary.
   The longest matching keyword wins so "super pharm" beats "super" (0.85).
4. ``mcc``        – ISO 18245 merchant category code mapping (0.7).
5. ``fuzzy_rule`` – difflib similarity against learned rules, catching typos
   and transliteration variants (ratio * 0.9, only when ratio >= 0.82).
6. ``default``    – ``other`` for expenses, ``other_income`` for income (0.0).

Hebrew text is normalised by stripping niqqud, geresh/gershayim and unifying
final letters (ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ). Single-letter Hebrew prefixes
(ב, ה, ו, כ, ל, מ, ש) are tolerated on keywords so "בקפה" matches "קפה".
"""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Category, MerchantRule, Transaction

HEBREW_RE = re.compile(r"[֐-׿]")
NIQQUD_RE = re.compile(r"[֑-ׇ]")
FINAL_LETTERS = str.maketrans({"ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ"})
HEBREW_PREFIXES = "בהוכלמש"
# Words that carry no merchant identity (legal suffixes, branch markers, URLs).
_NOISE_WORDS = {
    "ltd", "inc", "llc", "co", "com", "il", "www", "the", "branch", "store", "סניף", "בעמ", "בע", "מ",
}

# ---------------------------------------------------------------------------
# Bilingual keyword dictionary. Keys are category keys from services.seed.
# ---------------------------------------------------------------------------
KEYWORDS: dict[str, list[str]] = {
    "salary": ["salary", "payroll", "wage", "wages", "paycheck", "משכורת", "שכר עבודה", "תלוש"],
    "other_income": [
        "refund", "transfer from", "bit from", "paybox from", "dividend", "interest", "החזר", "זיכוי",
        "העברה מ", "ביטוח לאומי", "קצבה", "מענק", "בונוס", "bonus", "gift received", "got paid", "received",
    ],
    "rent": ["rent", "landlord", "שכר דירה", "שכירות", "דמי שכירות"],
    "utilities": [
        "electric", "electricity", "israel electric", "iec", "חברת החשמל", "חשמל", "water", "מי אביבים",
        "תאגיד מים", "מים", "arnona", "ארנונה", "municipality", "עירייה", "עיריית", "bezeq", "בזק",
        "partner", "פרטנר", "cellcom", "סלקום", "pelephone", "פלאפון", "hot mobile", "golan telecom",
        "גולן טלקום", "012", "019", "supergas", "סופרגז", "amisragas", "אמישראגז", "pazgas", "פזגז", "internet",
        "ועד בית", "phone bill",
    ],
    "insurance": [
        "insurance", "ביטוח", "harel", "הראל", "migdal", "מגדל", "clal", "כלל ביטוח", "phoenix", "הפניקס",
        "menora", "מנורה", "ayalon", "איילון", "direct insurance", "ביטוח ישיר", "aig", "9 million", "ליברה", "libra",
    ],
    "loans": ["loan", "mortgage", "הלוואה", "משכנתא", "החזר הלוואה", "credit line"],
    "subscriptions": [
        "netflix", "נטפליקס", "spotify", "ספוטיפיי", "apple.com/bill", "apple com bill", "icloud", "itunes",
        "google one", "google storage", "youtube premium", "disney", "disney+", "amazon prime", "chatgpt", "openai",
        "dropbox", "adobe", "microsoft 365", "office 365", "yes tv", "hot tv", "סלקום tv", "partner tv",
        "next tv", "gym", "holmes place", "הולמס פלייס", "מנוי", "subscription", "patreon",
    ],
    "groceries": [
        "groceries", "grocery", "supermarket", "supermarkt", "shufersal", "שופרסל", "rami levy", "רמי לוי",
        "victory", "ויקטורי", "yochananof", "יוחננוף", "osher ad", "אושר עד", "tiv taam", "טיב טעם",
        "mega", "מגה", "am pm", "ampm", "איי אם פי אם", "carrefour", "קרפור", "yenot bitan", "יינות ביתן",
        "hatzi hinam", "חצי חינם", "machsanei hashuk", "מחסני השוק", "super yuda", "סופר יודה", "מכולת",
        "סופרמרקט", "סופר", "ירקות", "פירות", "שוק", "market", "vegetables", "bakery", "מאפייה",
    ],
    "restaurants": [
        "restaurant", "מסעדה", "wolt", "וולט", "10bis", "תן ביס", "cibus", "סיבוס", "mcdonald", "mcdonalds",
        "מקדונלדס", "burger", "בורגר", "pizza", "פיצה", "domino", "דומינו", "kfc", "sushi", "סושי", "shawarma",
        "שווארמה", "falafel", "פלאפל", "humus", "hummus", "חומוס", "lunch", "dinner", "breakfast", "ארוחה",
        "ארוחת צהריים", "ארוחת ערב", "ארוחת בוקר", "japanika", "ג'פניקה", "food", "אוכל", "takeaway",
    ],
    "coffee": [
        "coffee", "קפה", "cafe", "café", "קפה קפה", "aroma", "ארומה", "cofix", "קופיקס", "starbucks",
        "landwer", "לנדוור", "greg", "גרג", "cafe joe", "קפה ג'ו", "arcaffe", "ארקפה", "espresso", "אספרסו",
        "latte", "לאטה", "cappuccino", "קפוצ'ינו", "נס קפה", "הפוך",
    ],
    "transport": [
        "rav kav", "rav-kav", "רב קו", "רב-קו", "moovit", "מוביט", "gett", "גט טקסי", "uber", "yango", "taxi",
        "מונית", "monit", "israel railways", "רכבת ישראל", "רכבת", "train", "egged", "אגד", "dan bus", "דן",
        "metropoline", "מטרופולין", "kavim", "קווים", "bus", "אוטובוס", "pango", "פנגו", "cellopark",
        "סלופארק", "parking", "חניה", "חנייה", "ahuzat hof", "אחוזת חוף", "kvish 6", "כביש 6", "toll",
        "scooter", "bird", "lime",
    ],
    "fuel": [
        "fuel", "gas station", "petrol", "דלק", "paz", "פז", "delek", "sonol", "סונול", "ten", "טן", "dor alon",
        "דור אלון", "yellow", "יילו", "תדלוק", "בנזין", "סולר",
    ],
    "health": [
        "pharmacy", "בית מרקחת", "super-pharm", "super pharm", "סופר-פארם", "סופר פארם", "be pharm", "גוד פארם",
        "good pharm", "clalit", "כללית", "maccabi", "מכבי", "meuhedet", "מאוחדת", "leumit", "לאומית",
        "doctor", "רופא", "dentist", "רופא שיניים", "שיניים", "clinic", "מרפאה", "hospital", "בית חולים",
        "optic", "אופטיקה", "medicine", "תרופות", "תרופה",
    ],
    "shopping": [
        "shopping", "קניות", "zara", "זארה", "h&m", "castro", "קסטרו", "fox", "פוקס", "renuar", "רנואר",
        "terminal x", "טרמינל איקס", "amazon", "אמזון", "aliexpress", "עלי אקספרס", "ikea", "איקאה",
        "ace", "אייס", "home center", "הום סנטר", "ksp", "bug", "באג", "ivory", "איבורי", "shein", "שיין",
        "clothes", "בגדים", "shoes", "נעליים", "electronics", "max stock", "מקס סטוק", "גולף", "golf",
    ],
    "entertainment": [
        "cinema", "movie", "movies", "סרט", "קולנוע", "cinema city", "סינמה סיטי", "yes planet", "יס פלאנט",
        "lev cinema", "eventim", "leaan", "לאן", "tickets", "כרטיסים", "הופעה", "concert", "theater", "תיאטרון",
        "steam", "playstation", "xbox", "nintendo", "bar", "בר", "pub", "פאב", "club", "מועדון", "escape room",
        "חדר בריחה", "bowling", "באולינג",
    ],
    "education": [
        "university", "אוניברסיטה", "college", "מכללה", "udemy", "coursera", "course", "קורס", "tuition",
        "שכר לימוד", "books", "ספרים", "steimatzky", "סטימצקי", "tzomet sfarim", "צומת ספרים", "school", "בית ספר",
        "lesson", "שיעור", "חוג",
    ],
    "kids": [
        "daycare", "גן ילדים", "גן", "מעון", "צהרון", "babysitter", "בייביסיטר", "toys", "צעצועים",
        "toys r us", "טויס אר אס", "shilav", "שילב", "diapers", "חיתולים", "kids", "ילדים",
    ],
    "cash": ["atm", "cash withdrawal", "כספומט", "משיכת מזומן", "משיכה מכספומט", "מזומן"],
    "transfers": ["bit", "ביט", "paybox", "פייבוקס", "pepper pay", "transfer to", "העברה ל"],
}

# ISO 18245 merchant category codes → category keys.
MCC_MAP: dict[str, str] = {
    "5411": "groceries", "5422": "groceries", "5441": "groceries", "5451": "groceries", "5499": "groceries",
    "5462": "coffee",
    "5812": "restaurants", "5813": "entertainment", "5814": "restaurants",
    "5541": "fuel", "5542": "fuel", "5983": "fuel",
    "4111": "transport", "4112": "transport", "4121": "transport", "4131": "transport", "4784": "transport",
    "7523": "transport",
    "4900": "utilities", "4814": "utilities", "4816": "utilities", "9311": "utilities",
    "4899": "subscriptions", "5815": "subscriptions", "5817": "subscriptions", "5818": "subscriptions",
    "7997": "subscriptions",
    "6300": "insurance", "6381": "insurance",
    "5912": "health", "8011": "health", "8021": "health", "8062": "health", "8099": "health", "8043": "health",
    "5311": "shopping", "5651": "shopping", "5661": "shopping", "5691": "shopping", "5699": "shopping",
    "5732": "shopping", "5942": "education", "5945": "kids", "5200": "shopping", "5712": "shopping",
    "5999": "shopping",
    "7832": "entertainment", "7922": "entertainment", "7991": "entertainment", "7994": "entertainment",
    "7996": "entertainment",
    "8211": "education", "8220": "education", "8299": "education", "8351": "kids",
    "6011": "cash", "6010": "cash",
    "6513": "rent",
    "4829": "transfers",
}


@dataclass(frozen=True)
class CategorizationResult:
    category_key: str
    confidence: float
    source: str  # user_rule | fuzzy_rule | keyword | mcc | default


# ---------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------
def contains_hebrew(text: str | None) -> bool:
    return bool(text and HEBREW_RE.search(text))


def normalize(text: str | None) -> str:
    """Canonical lowercase form used for all matching (both scripts)."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = NIQQUD_RE.sub("", text)
    text = text.lower().translate(FINAL_LETTERS)
    # Unify the many apostrophe/quote variants used for geresh & gershayim.
    text = re.sub(r"[\"'`׳״’‘“”]", "", text)
    # Keep letters (any script), digits, '&', '+', '/', '.'; everything else is a separator.
    text = re.sub(r"[^\w&+/.֐-׿]+", " ", text)
    text = re.sub(r"(?<!\w)\.|\.(?!\w)", " ", text)  # stray dots
    return re.sub(r"\s+", " ", text).strip()


NOISE_TOKENS = {normalize(w) for w in _NOISE_WORDS}


def merchant_key(merchant: str | None) -> str:
    """Normalised merchant identity: drops noise words and branch/terminal numbers."""
    tokens = [t for t in normalize(merchant).split() if t not in NOISE_TOKENS]
    # Drop pure numbers (branch / terminal ids) unless the name *is* a number (e.g. "012").
    meaningful = [t for t in tokens if not t.isdigit()]
    return " ".join(meaningful or tokens)


def _keyword_regex(keyword_norm: str) -> re.Pattern[str]:
    escaped = re.escape(keyword_norm)
    if contains_hebrew(keyword_norm):
        # Allow one attached Hebrew prefix letter, e.g. "בקפה", "לסופר", "ושופרסל".
        return re.compile(rf"(?:(?<=\s)|^)[{HEBREW_PREFIXES}]?{escaped}(?=\s|$)")
    return re.compile(rf"(?<![\w]){escaped}(?![\w])")


def _build_keyword_index() -> list[tuple[re.Pattern[str], int, str]]:
    index = []
    for category_key, words in KEYWORDS.items():
        for word in words:
            norm = normalize(word)
            if norm:
                index.append((_keyword_regex(norm), len(norm), category_key))
    # Longest (most specific) keywords first.
    index.sort(key=lambda item: item[1], reverse=True)
    return index


_KEYWORD_INDEX = _build_keyword_index()


def match_keyword(text: str | None, accept: Callable[[str], bool] | None = None) -> str | None:
    """Return the category key of the most specific keyword found in ``text``.

    ``accept`` filters candidate categories (e.g. income-only), so a less specific
    keyword of an acceptable category can still win.
    """
    norm = normalize(text)
    if not norm:
        return None
    for pattern, _length, category_key in _KEYWORD_INDEX:
        if (accept is None or accept(category_key)) and pattern.search(norm):
            return category_key
    return None


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
class Categorizer:
    """Per-request categoriser bound to a DB session and a user."""

    FUZZY_THRESHOLD = 0.82

    def __init__(self, db: Session, user_id: int):
        self.db = db
        self.user_id = user_id
        self._categories: dict[str, Category] | None = None
        self._rules: list[tuple[str, str]] | None = None  # (pattern, category_key)

    # -- caches -------------------------------------------------------------
    @property
    def categories(self) -> dict[str, Category]:
        if self._categories is None:
            self._categories = {c.key: c for c in self.db.scalars(select(Category))}
        return self._categories

    @property
    def rules(self) -> list[tuple[str, str]]:
        if self._rules is None:
            rows = self.db.execute(
                select(MerchantRule.pattern, Category.key)
                .join(Category, Category.id == MerchantRule.category_id)
                .where(MerchantRule.user_id == self.user_id)
                .order_by(MerchantRule.hits.desc())
            ).all()
            self._rules = [(pattern, key) for pattern, key in rows]
        return self._rules

    def category_id(self, key: str) -> int:
        return self.categories[key].id

    # -- classification -----------------------------------------------------
    def _fits_direction(self, key: str, amount: float | None) -> bool:
        """Income transactions may only land in income categories and vice versa."""
        if amount is None or key not in self.categories:
            return key in self.categories
        return self.categories[key].is_income == (amount > 0)

    def categorize(
        self, merchant: str, amount: float | None = None, mcc: str | None = None, description: str | None = None
    ) -> CategorizationResult:
        key = merchant_key(merchant)

        if key:
            for pattern, category_key in self.rules:
                if pattern == key and self._fits_direction(category_key, amount):
                    return CategorizationResult(category_key, 1.0, "user_rule")
            for pattern, category_key in self.rules:
                if len(pattern) >= 3 and (
                    re.search(rf"(?<!\w){re.escape(pattern)}(?!\w)", key)
                    or re.search(rf"(?<!\w){re.escape(key)}(?!\w)", pattern)
                ) and self._fits_direction(category_key, amount):
                    return CategorizationResult(category_key, 0.95, "user_rule")

        for text in (merchant, description):
            category_key = match_keyword(text, lambda k: self._fits_direction(k, amount))
            if category_key:
                return CategorizationResult(category_key, 0.85, "keyword")

        if mcc and (category_key := MCC_MAP.get(str(mcc).zfill(4))) and self._fits_direction(category_key, amount):
            return CategorizationResult(category_key, 0.7, "mcc")

        if key:
            best_ratio, best_key = 0.0, None
            for pattern, category_key in self.rules:
                ratio = SequenceMatcher(None, key, pattern).ratio()
                if ratio > best_ratio and self._fits_direction(category_key, amount):
                    best_ratio, best_key = ratio, category_key
            if best_key and best_ratio >= self.FUZZY_THRESHOLD:
                return CategorizationResult(best_key, round(best_ratio * 0.9, 3), "fuzzy_rule")

        fallback = "other_income" if amount is not None and amount > 0 else "other"
        return CategorizationResult(fallback, 0.0, "default")

    def apply(self, tx: Transaction) -> CategorizationResult:
        """Categorise a transaction in place (never overrides a manual choice)."""
        if tx.category_source == "user" and tx.category_id:
            return CategorizationResult(tx.category.key if tx.category else "other", 1.0, "user")
        result = self.categorize(tx.merchant, tx.amount, tx.mcc, tx.description)
        tx.category_id = self.category_id(result.category_key)
        tx.category_source = result.source
        tx.category_confidence = result.confidence
        return result

    # -- learning -------------------------------------------------------------
    def learn(self, merchant: str, category_key: str, apply_to_existing: bool = True) -> int:
        """Remember the user's choice for ``merchant``.

        Upserts a MerchantRule and, when ``apply_to_existing`` is set, recategorises
        every other transaction of the same merchant that the user did not
        categorise by hand. Returns how many existing transactions changed.
        """
        pattern = merchant_key(merchant)
        if not pattern:
            return 0
        category = self.categories[category_key]
        # Sessions run with autoflush off: persist pending edits (e.g. the override that
        # triggered this call) so the queries below see them.
        self.db.flush()
        rule = self.db.scalar(
            select(MerchantRule).where(MerchantRule.user_id == self.user_id, MerchantRule.pattern == pattern)
        )
        if rule:
            rule.hits = rule.hits + 1 if rule.category_id == category.id else 1
            rule.category_id = category.id
        else:
            self.db.add(MerchantRule(user_id=self.user_id, pattern=pattern, category_id=category.id))
        self._rules = None

        updated = 0
        if apply_to_existing:
            candidates = self.db.scalars(
                select(Transaction).where(
                    Transaction.user_id == self.user_id,
                    Transaction.category_source != "user",
                    Transaction.category_id != category.id,
                )
            )
            for tx in candidates:
                if merchant_key(tx.merchant) == pattern and self._fits_direction(category_key, tx.amount):
                    tx.category_id = category.id
                    tx.category_source = "user_rule"
                    tx.category_confidence = 1.0
                    updated += 1
        return updated
