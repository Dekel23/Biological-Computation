#!/bin/bash
# Double-click on a Mac to run the group-roast site on this computer.
# First run: installs what the site needs and asks for your API token once.

cd "$(dirname "$0")" || exit 1
pause_and_exit() { echo; read -r -p "Press Enter to close this window..." _; exit "${1:-0}"; }

if ! command -v python3 >/dev/null 2>&1 || ! python3 -c "import sys" >/dev/null 2>&1; then
  echo "Python is not installed."
  echo "Download it from https://www.python.org/downloads/ , install it, and run this file again."
  pause_and_exit 1
fi

if [ ! -f .venv/installed.txt ]; then
  echo "Installing (first run only, takes a minute)..."
  rm -rf .venv
  if ! python3 -m venv .venv || ! .venv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements.txt; then
    echo "Installation failed. Check your internet connection and run this file again."
    pause_and_exit 1
  fi
  echo ok > .venv/installed.txt
fi

if ! grep -qE '^(REPLICATE_API_TOKEN|ANTHROPIC_API_KEY)=.+' .env 2>/dev/null; then
  echo
  echo "Paste your Replicate API token (it starts with r8_) and press Enter."
  echo "It is saved only on this computer, in the file .env (nothing shows while you paste)."
  token=""
  while [ -z "$token" ]; do
    read -r -s -p "Token: " token
    echo
  done
  printf 'LLM_PROVIDER=replicate\nREPLICATE_API_TOKEN=%s\n' "$token" > .env
  chmod 600 .env
fi

OPEN_BROWSER=1 .venv/bin/python app.py
echo "The site stopped."
pause_and_exit 0
