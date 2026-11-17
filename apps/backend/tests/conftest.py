import sys
from pathlib import Path

# The application imports its modules from src/ (see main.py), so tests do the same.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
