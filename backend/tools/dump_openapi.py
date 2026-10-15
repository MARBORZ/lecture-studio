"""Print the OpenAPI schema without starting the server (used by `npm run gen:api`)."""

import json
import logging

logging.disable(logging.CRITICAL)

from backend.api.app import create_app  # noqa: E402

print(json.dumps(create_app().openapi(), ensure_ascii=False, indent=1))
