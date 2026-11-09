# 🔥 על האש · צלייה לקבוצה

אתר שמקבל ייצוא של צ'אט קבוצתי (WhatsApp או Telegram) ומחזיר:

- **סיכום** של מה קרה בקבוצה: נושאים מרכזיים, רגעים בלתי נשכחים והדינמיקה בין האנשים
- **ירידה אישית** על כל אחד מחברי הקבוצה, שמבוססת על מה שהוא באמת כתב ועל ההרגלים שלו בצ'אט
- **טקס פרסים**: פרסים מצחיקים ש-Claude ממציא, ולצידם פרסים "לפי המספרים" (ינשוף הלילה, הפפראצי, המתחרט הסדרתי…)
- **סטטיסטיקות**: מי מדבר הכי הרבה, באיזו שעה הקבוצה ערה, יום השיא ועוד

הסיכום והירידות נכתבים על ידי Claude. הסטטיסטיקות מחושבות מקומית בשרת.

השרת יכול להגיע ל-Claude בשתי דרכים (`LLM_PROVIDER`):
- **Replicate** (`replicate`): עם טוקן של Replicate (`REPLICATE_API_TOKEN`). ברירת המחדל היא `anthropic/claude-sonnet-4.6`, והחיוב דרך Replicate.
- **Anthropic API** (`anthropic`): עם מפתח של Anthropic (`ANTHROPIC_API_KEY`). ברירת המחדל היא `claude-opus-5-5`, עם פלט JSON מובנה וגיבוי אוטומטי.

אם `LLM_PROVIDER` לא מוגדר, השרת משתמש ב-Replicate כשיש רק טוקן של Replicate, ובכל מקרה אחר ב-Anthropic.

## גרסה בתוך Claude: בלי מפתח API ובלי שרת

`claude-artifact.html` הוא אותו אתר כקובץ אחד שרץ כ-Artifact בתוך Claude (באתר claude.ai או באפליקציה):

- הקובץ נקרא והסטטיסטיקות מחושבות בדפדפן עצמו. אין שרת, ולא צריך לאחסן כלום.
- הירידות נכתבות דרך היכולת `sample`, שפונה ל-Claude **בחשבון של מי שפותח את הדף**. כלומר, הן נכללות במנוי שלו ולא עולות כסף לבעלי האתר.
- בפעם הראשונה Claude מבקש אישור להשתמש בחשבון. מעבר לזה מופיע רק העיצוב של האתר.
- מגבלה: עד 256KB טקסט לבקשה. לכן Claude קורא בערך את 180KB האחרונים של הצ'אט, והסטטיסטיקות עדיין מחושבות על כל הצ'אט.

כדי לעדכן את ה-Artifact, מפרסמים את הקובץ מחדש מ-Claude Code.

## הרצה על המחשב שלכם, בלחיצה כפולה

1. מתקינים Python מ-python.org/downloads. ב-Windows מסמנים בהתקנה **Add python.exe to PATH**.
2. מורידים את הקוד כ-ZIP ומחלצים אותו:
   https://github.com/Dekel23/Biological-Computation/archive/refs/heads/ccr-c4b4a72f-yutvlc.zip
3. בתיקייה `group-roast` לוחצים לחיצה כפולה על:
   - **Windows:** `start-windows.bat`. אם מופיע "Windows protected your PC", לוחצים More info ← Run anyway.
   - **Mac:** `start-mac.command`. אם מופיעה אזהרה, לוחצים קליק ימני ← Open.
4. בפעם הראשונה הקובץ מתקין את מה שצריך (בערך דקה) ומבקש את הטוקן של Replicate. הטוקן נשמר רק במחשב שלכם, בקובץ `.env`.
5. האתר נפתח בדפדפן. החלון מציג גם כתובת לפתיחה מהטלפון כשהוא על אותו Wi-Fi.

כדי לכבות סוגרים את החלון. בפעם הבאה מספיקה לחיצה כפולה, בלי התקנה ובלי טוקן.
כדי להחליף טוקן, מוחקים את הקובץ `.env` ומריצים שוב.

## הרצה מקומית ידנית (גרסת השרת)

```bash
cd group-roast
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export REPLICATE_API_TOKEN=r8_...        # טוקן מ-replicate.com/account/api-tokens
# או: export ANTHROPIC_API_KEY=sk-ant-...  (מפתח מ-console.anthropic.com)
python app.py                            # http://localhost:8000
```

אפשר לנסות עם הקובץ `sample_chat.txt` (צ'אט בדיוני).

## איך מייצאים צ'אט

| מקור | איך |
|---|---|
| WhatsApp באנדרואיד | הקבוצה ← ⋮ ← עוד ← ייצוא צ'אט ← **ללא מדיה** → קובץ `.txt` |
| WhatsApp באייפון | שם הקבוצה ← ייצוא צ'אט ← **ללא מדיה** → קובץ `.zip` (מעלים כמו שהוא) |
| Telegram | Telegram Desktop ← הקבוצה ← ⋮ ← Export chat history ← פורמט JSON → `result.json` |

אפשר גם להדביק את הטקסט ישירות באתר.

## הגדרות (משתני סביבה)

| משתנה | ברירת מחדל | מה זה |
|---|---|---|
| `LLM_PROVIDER` | אוטומטי | `replicate` או `anthropic` |
| `REPLICATE_API_TOKEN` | — | הטוקן של Replicate (ל-`replicate`) |
| `REPLICATE_MODEL` | `anthropic/claude-sonnet-4.6` | המודל ב-Replicate |
| `REPLICATE_MAX_TOKENS` | `16000` | אורך תשובה מקסימלי ב-Replicate |
| `ANTHROPIC_API_KEY` | — | המפתח של Anthropic (ל-`anthropic`) |
| `ROAST_MODEL` | `claude-opus-5-5` | המודל ב-Anthropic API |
| `ROAST_EFFORT` | `high` | `low` / `medium` / `high` / `xhigh` / `max` (רק ב-Anthropic API). נמוך יותר: מהיר וזול יותר |
| `MAX_TRANSCRIPT_CHARS` | `300000` | כמה תווים מהצ'אט (מההודעות האחרונות) נשלחים ל-Claude. הסטטיסטיקות תמיד מחושבות על כל הצ'אט, והאתר מציין כשנקרא רק חלק |
| `MAX_ROASTED_MEMBERS` | `20` | לכמה מהחברים הפעילים ביותר נכתבת ירידה אישית |
| `MAX_UPLOAD_MB` | `50` | גודל קובץ מקסימלי |
| `ACCESS_CODE` | ריק | קוד גישה. אם מוגדר, רק מי שמכניס אותו יכול להריץ צלייה. ריק = פתוח לכולם |
| `DAILY_ROAST_LIMIT` | `30` | מקסימום צליות ביום, לכל המשתמשים יחד (0 = ללא הגבלה) |
| `HEARTBEAT_SECONDS` | `10` | כל כמה שניות לשלוח "אני עדיין כאן" כשאין התקדמות |
| `PORT` | `8000` | פורט השרת |

**עלות:** כל צלייה היא קריאה אחת למודל. צ'אט גדול שממלא את כל 300 אלף התווים יעלה בהערכה גסה כחצי דולר, בשתי הדרכים. את היחס בין תווים לטוקנים בעברית לא מדדנו. צ'אטים קטנים עולים הרבה פחות. כדי לחסוך, אפשר להוריד את `MAX_TRANSCRIPT_CHARS`.

## העלאה לאוויר ב-Render (אחסון חינמי)

בשורש הריפו יש קובץ `render.yaml` שמגדיר את כל השירות.

1. ב-render.com נכנסים עם GitHub ובוחרים **New → Blueprint**.
2. בוחרים את הריפו ואת ה-branch שבו נמצא האתר.
3. Render מבקש שני ערכים:
   - `REPLICATE_API_TOKEN`: הטוקן מ-replicate.com/account/api-tokens. כדי להשתמש במפתח של Anthropic במקום, משנים בהגדרות השירות את `LLM_PROVIDER` ל-`anthropic` ומוסיפים `ANTHROPIC_API_KEY`.
   - `ACCESS_CODE`: קוד שתבחרו. רק מי שיודע אותו יכול להריץ צלייה על המפתח שלכם.
4. לוחצים **Apply**. אחרי כמה דקות מקבלים כתובת `https://al-haesh-….onrender.com`.

**הערות:**
- **הגנה על הכסף:** בנוסף לקוד הגישה ולמכסה היומית (`DAILY_ROAST_LIMIT`), כדאי לבדוק בהגדרות החיוב של ספק ה-AI אם אפשר להגדיר שם תקרת הוצאה.
- **התעוררות איטית:** בתוכנית החינמית השירות נרדם כשאין שימוש, והבקשה הראשונה אחרי הפסקה לוקחת קצת יותר זמן.
- **חיבור פתוח:** השרת שולח הודעת "אני עדיין כאן" כל 10 שניות (`HEARTBEAT_SECONDS`), כדי שהחיבור לא ינותק בזמן ש-Claude חושב.

להרצה ידנית בשרת אחר:

```bash
gunicorn app:app --bind 0.0.0.0:8000 --workers 1 --threads 8 --timeout 600
```

עובד אחד (`--workers 1`) שומר את ספירת המכסה היומית במקום אחד.

## איך זה בנוי

```
group-roast/
├── app.py            # שרת Flask. ‏POST /api/roast מחזיר זרם NDJSON: stats → progress… → result | error
├── chat_parser.py    # פענוח WhatsApp (אנדרואיד/אייפון, 12/24 שעות, ZIP) ו-Telegram JSON, וחישוב סטטיסטיקות
├── roaster.py        # הפרומפט, סכמת ה-JSON וקריאה מוזרמת ל-Claude
├── static/           # האתר עצמו (HTML/CSS/JS, בעברית ומימין לשמאל, תומך במצב כהה)
├── sample_chat.txt   # צ'אט לדוגמה
└── tests/            # בדיקות לפענוח ולסטטיסטיקות (pytest)
```

- הסטטיסטיקות מגיעות לדפדפן מיד, עוד לפני ש-Claude מסיים לכתוב, כך שיש מה לראות בזמן ההמתנה.
- הקריאה ל-Claude משתמשת ב-structured outputs (סכמת JSON), כך שהתשובה תמיד במבנה שהאתר יודע להציג.
- אם מסווג הבטיחות של המודל דוחה בקשה, היא נשלחת אוטומטית למודל גיבוי (server-side fallback). אפשר לבטל את זה ב-`roaster.py`.
- הפרומפט מגדיר גבולות: יורדים על התנהגות בצ'אט ולא על זהות, מראה, בריאות וכו'. אין תוכן מיני, ונושאים כואבים לא הופכים לבדיחה.
- הצ'אט לא נשמר בשרת. הוא נשלח ל-Anthropic לצורך הניתוח בלבד.

## בדיקות

```bash
pip install pytest
pytest -q tests
```

---

### English (short)

Upload a WhatsApp/Telegram group-chat export and get a summary of the group plus a personal roast for each member, written by Claude. Stats (who talks most, night owls, deleted messages, peak hours) are computed locally. Run with `pip install -r requirements.txt && REPLICATE_API_TOKEN=... python app.py` (Claude on Replicate) or `ANTHROPIC_API_KEY=... python app.py` (Anthropic API), then open http://localhost:8000. The output language can be Hebrew or English.
