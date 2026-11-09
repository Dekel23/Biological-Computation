"""Read KEY=VALUE settings from a .env file next to the app.

The start-windows.bat / start-mac.command launchers save the API token there,
so it stays on the user's own computer. Values already set in the real
environment win over the file.
"""

from __future__ import annotations

import os
from pathlib import Path


def load_env_file(path: Path | None = None) -> None:
    path = path or Path(__file__).with_name(".env")
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except (FileNotFoundError, UnicodeDecodeError):
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and value and key not in os.environ:
            os.environ[key] = value
