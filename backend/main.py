"""
Server entrypoint:  uvicorn backend.main:app --host 127.0.0.1 --port 3000
"""

import logging

from backend.api.app import create_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = create_app()
