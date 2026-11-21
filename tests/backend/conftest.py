"""Small limits so size tests stay fast. Set before main.py reads them at import."""

import os

os.environ["MAX_FILE_MB"] = "1"
os.environ["CONVERT_TIMEOUT_S"] = "5"
