"""Pone `apps/api` en sys.path para que los scripts puedan importar `app.*`.

Evita tener que instalar el backend como paquete durante el MVP.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
API_ROOT = REPO_ROOT / "apps" / "api"

if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))
