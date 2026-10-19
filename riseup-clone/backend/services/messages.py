"""Bilingual WhatsApp message templates and formatting helpers."""
from __future__ import annotations

CURRENCY_SYMBOLS = {"ILS": "₪", "USD": "$", "EUR": "€", "GBP": "£"}


def money(amount: float, currency: str = "ILS", decimals: int = 0) -> str:
    symbol = CURRENCY_SYMBOLS.get(currency, currency + " ")
    sign = "-" if amount < 0 else ""
    return f"{sign}{symbol}{abs(amount):,.{decimals}f}"


def category_name(category, lang: str) -> str:
    """Accepts a Category ORM object or a dict with name_en / name_he."""
    get = category.get if isinstance(category, dict) else lambda k: getattr(category, k)
    return get("name_he") if lang == "he" else get("name_en")


TEMPLATES: dict[str, dict[str, str]] = {
    "en": {
        "help": (
            "👋 Hi {name}! I'm your money buddy.\n\n"
            "• Log cash: *I spent 50 on coffee* or *120 groceries*\n"
            "• Log income: *got paid 500*\n"
            "• *balance* – how much is free to spend\n"
            "• *summary* – this week at a glance\n"
            "• *budget* – budget status · *budget coffee 300* to set one\n"
            "• *goals* – savings goals progress\n"
            "• *undo* – remove the last entry you logged\n\n"
            "Hebrew works too: הוצאתי 50 שקל על קפה"
        ),
        "unknown": "🤔 I didn't get that. Try *I spent 40 on lunch* or type *help*.",
        "expense_logged": "✅ Logged {amount} · {icon} {category}{merchant}{when}.\n💸 Free to spend this month: *{free}*",
        "income_logged": "💰 Added income {amount} · {icon} {category}.\n💸 Free to spend this month: *{free}*",
        "yesterday": " (yesterday)",
        "balance": (
            "📊 *Your bottom line – {month}*\n"
            "Income: {income}{projected}\nFixed: -{fixed}\nVariable: -{variable}\n"
            "━━━━━━━━━━\n💸 *Free to spend: {free}*\n"
            "📅 {days_left} days left · {daily} per day\n🔮 End-of-month forecast: {forecast}"
        ),
        "projected": " (expected)",
        "undo_done": "↩️ Removed {amount} · {category} ({merchant}).\n💸 Free to spend: *{free}*",
        "undo_nothing": "Nothing to undo – you haven't logged anything here yet.",
        "budget_set": "🎯 Budget for {icon} {category} set to {amount}/month.",
        "budget_unknown_category": "I couldn't tell which category. Try *budget coffee 300*.",
        "budget_header": "🎯 *Budgets – {month}*",
        "budget_line": "{flag} {icon} {category}: {spent} / {limit} ({pct}%)",
        "no_budgets": "No budgets yet. Send *budget groceries 2000* to create one.",
        "goals_header": "🏆 *Savings goals*",
        "goal_line": "{emoji} {name}: {saved} / {target} ({pct}%){need}",
        "goal_need": " · save {monthly}/mo to make it",
        "no_goals": "No savings goals yet – add one in the app.",
        "weekly_summary": (
            "🗓️ *Weekly summary* ({start} – {end})\n"
            "You spent *{spent}* this week {trend}.\n{top}\n"
            "━━━━━━━━━━\n💸 Free to spend: *{free}* · {days_left} days left ({daily}/day)\n{tip}"
        ),
        "trend_up": "(📈 {pct}% more than last week)",
        "trend_down": "(📉 {pct}% less than last week)",
        "trend_flat": "(about the same as last week)",
        "top_line": "{i}. {icon} {category} – {amount}",
        "tip_over": "⚠️ You're over your bottom line. Consider pausing non-essential spending.",
        "tip_tight": "⚠️ At this pace you'll end the month {forecast} in the red. Slow down a little!",
        "tip_good": "🌱 On track to finish the month with {forecast} to spare. Nice!",
        "budget_alert_80": "⚠️ Heads up! You've used {pct}% of your {icon} {category} budget ({spent} of {limit}).",
        "budget_alert_100": "🚨 You've gone over your {icon} {category} budget: {spent} of {limit}.",
        "daily_update": "🌙 Today you spent {today}. Free to spend for the rest of {month}: *{free}* ({daily}/day).",
        "price_hike": "🔔 {merchant} went up from {old} to {new}/month.",
    },
    "he": {
        "help": (
            "👋 היי {name}! אני העוזר הפיננסי שלך.\n\n"
            "• רישום מזומן: *הוצאתי 50 שקל על קפה* או *120 סופר*\n"
            "• רישום הכנסה: *קיבלתי 500*\n"
            "• *כמה נשאר* – כמה פנוי להוצאה\n"
            "• *סיכום* – השבוע במבט אחד\n"
            "• *תקציב* – מצב התקציבים · *תקציב קפה 300* להגדרה\n"
            "• *יעדים* – התקדמות ביעדי החיסכון\n"
            "• *ביטול* – מחיקת הרישום האחרון שלך\n\n"
            "English works too: I spent 50 on coffee"
        ),
        "unknown": "🤔 לא הבנתי. נסו *הוצאתי 40 על צהריים* או כתבו *עזרה*.",
        "expense_logged": "✅ נרשם {amount} · {icon} {category}{merchant}{when}.\n💸 פנוי להוצאה החודש: *{free}*",
        "income_logged": "💰 נוספה הכנסה {amount} · {icon} {category}.\n💸 פנוי להוצאה החודש: *{free}*",
        "yesterday": " (אתמול)",
        "balance": (
            "📊 *השורה התחתונה – {month}*\n"
            "הכנסות: {income}{projected}\nקבועות: -{fixed}\nמשתנות: -{variable}\n"
            "━━━━━━━━━━\n💸 *פנוי להוצאה: {free}*\n"
            "📅 נותרו {days_left} ימים · {daily} ליום\n🔮 תחזית לסוף החודש: {forecast}"
        ),
        "projected": " (צפוי)",
        "undo_done": "↩️ נמחק {amount} · {category} ({merchant}).\n💸 פנוי להוצאה: *{free}*",
        "undo_nothing": "אין מה לבטל – עדיין לא רשמת כאן כלום.",
        "budget_set": "🎯 התקציב ל{icon} {category} עודכן ל-{amount} לחודש.",
        "budget_unknown_category": "לא הצלחתי לזהות קטגוריה. נסו *תקציב קפה 300*.",
        "budget_header": "🎯 *תקציבים – {month}*",
        "budget_line": "{flag} {icon} {category}: {spent} / {limit} ({pct}%)",
        "no_budgets": "אין עדיין תקציבים. שלחו *תקציב סופר 2000* כדי ליצור אחד.",
        "goals_header": "🏆 *יעדי חיסכון*",
        "goal_line": "{emoji} {name}: {saved} / {target} ({pct}%){need}",
        "goal_need": " · לחסוך {monthly} בחודש כדי להגיע",
        "no_goals": "אין עדיין יעדי חיסכון – אפשר להוסיף באפליקציה.",
        "weekly_summary": (
            "🗓️ *סיכום שבועי* ({start} – {end})\n"
            "הוצאת השבוע *{spent}* {trend}.\n{top}\n"
            "━━━━━━━━━━\n💸 פנוי להוצאה: *{free}* · נותרו {days_left} ימים ({daily} ליום)\n{tip}"
        ),
        "trend_up": "(📈 {pct}% יותר מהשבוע שעבר)",
        "trend_down": "(📉 {pct}% פחות מהשבוע שעבר)",
        "trend_flat": "(בערך כמו בשבוע שעבר)",
        "top_line": "{i}. {icon} {category} – {amount}",
        "tip_over": "⚠️ עברת את השורה התחתונה. כדאי לעצור הוצאות לא הכרחיות.",
        "tip_tight": "⚠️ בקצב הזה החודש ייגמר במינוס של {forecast}. כדאי להאט קצת!",
        "tip_good": "🌱 בדרך לסיים את החודש עם {forecast} בצד. כל הכבוד!",
        "budget_alert_80": "⚠️ שימו לב! ניצלת {pct}% מתקציב {icon} {category} ({spent} מתוך {limit}).",
        "budget_alert_100": "🚨 חרגת מתקציב {icon} {category}: {spent} מתוך {limit}.",
        "daily_update": "🌙 היום הוצאת {today}. פנוי להוצאה עד סוף {month}: *{free}* ({daily} ליום).",
        "price_hike": "🔔 {merchant} התייקר מ-{old} ל-{new} לחודש.",
    },
}

MONTH_NAMES = {
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December"],
    "he": ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר",
           "דצמבר"],
}


def t(lang: str, key: str, **kwargs) -> str:
    lang = lang if lang in TEMPLATES else "en"
    return TEMPLATES[lang][key].format(**kwargs)


def month_name(month: str, lang: str) -> str:
    """'2026-10' → 'October' / 'אוקטובר'."""
    lang = lang if lang in MONTH_NAMES else "en"
    return MONTH_NAMES[lang][int(month.split("-")[1]) - 1]
