# Bottom Line – a Riseup-style personal finance app

A mobile-first PWA that answers one question: **how much is free to spend this month?**

* **Backend:** Python · FastAPI · SQLAlchemy · SQLite · APScheduler
* **Frontend:** React · Vite · Tailwind CSS · Recharts · react-i18next · vite-plugin-pwa
* **Bot:** WhatsApp Cloud API webhook (simulated by default) with English + Hebrew NLP

## Features

| | |
|---|---|
| 🏦 **Mock Open Banking sync** | Read-only provider that generates deterministic, realistic Israeli bank + credit-card history (Hebrew & English merchant names, MCC codes, salary, rent, subscriptions). Re-syncs are de-duplicated. |
| 🧠 **Smart categorisation** | User-learned rules → bilingual keyword dictionary → MCC codes → fuzzy match on learned rules. Hebrew normalisation (niqqud, final letters, ב/ל/ה… prefixes). Overriding a category teaches the engine and recategorises that merchant's history. |
| 💸 **Bottom Line calculator** | `Free to spend = Income − Fixed − Variable`, with expected income, planned fixed costs reserved before they're charged, a cash "envelope" so ATM withdrawals and logged cash spends aren't double counted, a daily allowance and an end-of-month forecast. |
| 💬 **WhatsApp bot** | Inbound: "I spent 50 on coffee", "הוצאתי 50 שקל על קפה", "חמישים שקל פלאפל", "got paid 3k", "budget coffee 300", "כמה נשאר?", "summary", "undo"… Outbound: weekly summary (Sun 09:00), budget alerts at 80% / 100%, optional daily free-to-spend (20:30). |
| 🌍 **i18n + RTL** | English by default, one-tap English ⇄ עברית toggle; full RTL layout (logical CSS, mirrored charts and navigation, bidi-isolated numbers and names). |
| 📱 **PWA** | Installable, offline app shell, network-first API cache, safe-area aware bottom navigation. |
| 📡 **Subscription Radar** *(extra)* | Detects recurring charges automatically from history (weekly/monthly/quarterly/yearly cadence + stable amounts), shows monthly/yearly cost, the next expected charge, and **flags price hikes** (also mentioned in the weekly WhatsApp summary). |
| 🎯 **Savings Goals** *(extra)* | Goals with deadlines: required monthly saving, progress, and whether this month's forecast surplus covers it ("on track" / "stretch"), plus a suggested transfer. |

## Project structure

```
riseup-clone/
├── dev.sh                      # starts backend + frontend together
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   ├── main.py                 # FastAPI app, CORS, routers, scheduler, serves frontend/dist
│   ├── database.py             # SQLite engine/session
│   ├── models.py               # ORM models
│   ├── schemas.py              # Pydantic request/response models
│   ├── deps.py                 # current-user + validation dependencies
│   ├── routers/
│   │   ├── dashboard.py        # bottom line, trend, settings, budgets, fixed expenses
│   │   ├── transactions.py     # list/add/re-categorise, bank sync
│   │   ├── insights.py         # subscription radar, savings goals
│   │   └── whatsapp.py         # webhook, simulator, proactive sends
│   ├── services/
│   │   ├── categorizer.py      # classification + learning engine
│   │   ├── calculator.py       # Free-to-Spend / forecast / chart series
│   │   ├── bank_sync.py        # mock Open Banking provider + sync
│   │   ├── nlp_parser.py       # bilingual message parser
│   │   ├── bot.py              # inbound conversation handler
│   │   ├── notifications.py    # weekly summary, budget alerts, daily update
│   │   ├── whatsapp_client.py  # Cloud API transport / simulation
│   │   ├── messages.py         # bilingual message templates
│   │   ├── insights.py         # subscription detection + goal projections
│   │   ├── scheduler.py        # APScheduler jobs
│   │   └── seed.py             # categories + demo data
│   └── tests/                  # pytest suite (65 tests)
└── frontend/
    ├── package.json · vite.config.js · tailwind.config.js · postcss.config.js · index.html
    ├── public/                 # manifest.json, favicon.svg, icons/
    └── src/
        ├── main.jsx · App.jsx · i18n.js · api.js · index.css
        ├── hooks/              # useApi, useCategories
        ├── utils/format.js     # Intl money/date formatting
        └── components/
            ├── Dashboard.jsx · TransactionsTable.jsx · WhatsAppSimulator.jsx
            ├── GoalsPage.jsx · SubscriptionRadar.jsx · Settings.jsx
            └── ui.jsx          # Sheet, Toggle, MonthSwitcher, Toast…
```

## Run it

Requirements: **Python 3.11+** and **Node.js 18+**.

### Option A – one command (macOS / Linux / WSL)

```bash
cd riseup-clone
./dev.sh
```

It creates the virtualenv and installs dependencies on the first run, then starts both servers. Ctrl+C stops both.

### Option B – two terminals

Terminal 1, the API on http://localhost:8000 (interactive docs at `/docs`):

```bash
cd riseup-clone/backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Terminal 2, the PWA on http://localhost:5173:

```bash
cd riseup-clone/frontend
npm install
npm run dev
```

Open http://localhost:5173 on your computer, or on a phone on the same Wi-Fi via `http://<your-computer-ip>:5173` (Vite listens on all interfaces). Vite proxies `/api` to the backend, so no CORS setup is needed.

On first start the backend creates `backend/riseup.db` and seeds a demo user ("Dana") with ~6 months of mock bank history, budgets, fixed expenses and two savings goals. To start fresh, stop the API and delete `backend/riseup.db*`.

### Tests

```bash
cd riseup-clone/backend
source .venv/bin/activate
pytest -q
```

### Production build (single process)

```bash
cd riseup-clone/frontend && npm run build          # outputs frontend/dist
cd ../backend && uvicorn main:app --host 0.0.0.0 --port 8000
```

When `frontend/dist` exists, FastAPI serves the PWA itself at http://localhost:8000. Service workers and PWA install require HTTPS (or `localhost`), so put it behind a TLS proxy before installing it on a phone.

## Using the WhatsApp bot

The **Bot** tab is a WhatsApp-style simulator that talks to the same webhook logic. Try:

| You send | Bot does |
|---|---|
| `I spent 50 on coffee` / `הוצאתי 50 שקל על קפה` | Logs a ₪50 cash expense under ☕ Coffee and replies with the new free-to-spend |
| `120 groceries at Shufersal yesterday` | Logs it with yesterday's date |
| `חמישים שקל פלאפל` · `twenty five for a taxi` | Number words work in both languages |
| `got paid 3k` / `קיבלתי 200` | Logs income |
| `budget coffee 300` / `תקציב קפה 300` | Creates or updates a budget |
| `balance` · `כמה נשאר?` | Bottom-line breakdown + forecast |
| `summary` · `סיכום` | This week's summary |
| `budget` · `goals` · `undo` · `help` | Status, goals, remove your last entry, menu |

Replies come in the language you wrote in. The "Proactive updates" buttons trigger the same outbound messages the scheduler sends.

### Connecting real WhatsApp (Meta Cloud API)

1. Create a Meta app with the WhatsApp product, and copy the access token and phone-number ID.
2. Set them in `backend/.env` (see `.env.example`): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, and `WHATSAPP_APP_SECRET` (enables `X-Hub-Signature-256` verification).
3. Expose the API over HTTPS (e.g. `ngrok http 8000`) and set the webhook URL to `https://<host>/api/whatsapp/webhook` with the same verify token. Subscribe to `messages`.
4. Put your number in **Settings → WhatsApp number**. Inbound messages are matched to users by phone number. Outbound messages go through the Graph API and are also stored for the in-app chat view.

## How the numbers work

**Free to spend** for the selected month:

```
total_income      = max(actual income received, expected monthly income)   # current month
fixed_expenses    = Σ per fixed category  max(actually charged, planned)    # rent, bills, insurance, loans, subscriptions
variable_expenses = all other spending + max(0, ATM cash withdrawn − cash spends logged)
free_to_spend     = total_income − fixed_expenses − variable_expenses
daily_allowance   = free_to_spend / days left (incl. today)
forecast          = total_income − fixed_expenses − (variable so far + daily pace × remaining days)
```

Past months use actuals only. Refunds in an expense category reduce that category's spend.

**Categorisation order**: learned rule (exact or contained) → keyword (longest match wins; Hebrew prefixes tolerated) → MCC → fuzzy match on learned rules (≥ 0.82 similarity) → `other` / `other_income`. Income only lands in income categories and expenses only in expense categories. Manual choices are never overwritten.

## API overview

| Method | Path | |
|---|---|---|
| GET | `/api/dashboard/summary?month=YYYY-MM` | bottom line, chart series, 6-month trend, highlights |
| GET/PUT | `/api/settings` | profile, language, expected income, notification toggles |
| GET/PUT/DELETE | `/api/budgets` | monthly category budgets |
| GET/POST/DELETE | `/api/fixed-expenses` | planned fixed commitments |
| GET/POST | `/api/transactions` | list (month, category, q, source) / add manual |
| PATCH | `/api/transactions/{id}/category` | override + learn |
| POST | `/api/bank/sync` | pull new mock Open Banking transactions |
| GET | `/api/insights/subscriptions` | Subscription Radar |
| GET/POST/PATCH/DELETE | `/api/goals` · `POST /api/goals/{id}/deposit` | savings goals |
| GET/POST | `/api/whatsapp/webhook` | Meta verification / inbound messages |
| POST | `/api/whatsapp/simulate` | send a message as the user |
| POST | `/api/whatsapp/proactive/{weekly_summary\|free_to_spend\|budget_alerts}` | push an update now |

## Notes

* **Single household by design.** The API acts as the first user, or the one in the `X-User-Id` header. Add real authentication (OAuth/JWT, or an auth proxy) before exposing it beyond your own machine or network.
* The Open Banking provider is a mock: it only implements read access, which mirrors how real account-information APIs work.
* Amounts are stored as signed floats (expenses negative), rounded to agorot.
