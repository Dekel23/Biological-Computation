"""FastAPI application entry point.

Run with:  uvicorn main:app --reload --port 8000   (from the backend/ directory)
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from database import SessionLocal, init_db
from routers import dashboard, insights, transactions, whatsapp
from services.seed import seed_categories, seed_demo

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("riseup")


def _flag(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    with SessionLocal() as db:
        seed_categories(db)
        if _flag("SEED_DEMO"):
            seed_demo(db)
    scheduler = None
    if _flag("ENABLE_SCHEDULER"):
        from services.scheduler import create_scheduler

        scheduler = create_scheduler()
        scheduler.start()
        logger.info("Scheduler started with jobs: %s", [job.id for job in scheduler.get_jobs()])
    try:
        yield
    finally:
        if scheduler:
            scheduler.shutdown(wait=False)


app = FastAPI(
    title="Riseup Clone – Personal Finance API",
    version="1.0.0",
    description="Bottom-line budgeting, smart categorisation, mock Open Banking and a WhatsApp bot.",
    lifespan=lifespan,
)

origins = [o.strip() for o in os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"
).split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard.router)
app.include_router(transactions.router)
app.include_router(insights.router)
app.include_router(whatsapp.router)


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok"}


# Serve the built PWA (frontend/dist) when present, so one process can host everything.
DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (DIST / path).resolve()
        if path and candidate.is_file() and DIST in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
