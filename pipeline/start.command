#!/bin/bash
# Double-clic : lance la machine à contenu et ouvre http://127.0.0.1:8765 dans le navigateur.
cd "$(dirname "$0")"
exec .venv/bin/python dashboard.py
