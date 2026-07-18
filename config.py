import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Ingestion ────────────────────────────────────────────────────────────────
# Preferred: Google Drive API polling (works anywhere — no Drive for Desktop
# mount needed). Set GOOGLE_DRIVE_FOLDER_ID to enable; the legacy local
# WATCH_FOLDER watchdog is used only when the folder ID is unset.
# One or more Drive folder IDs, comma-separated (e.g. camera roll + a
# digital "Invoices" folder for vendor/Faire/Amazon PDFs)
GOOGLE_DRIVE_FOLDER_ID = os.environ.get("GOOGLE_DRIVE_FOLDER_ID", "")
GOOGLE_DRIVE_FOLDER_IDS = [f.strip() for f in GOOGLE_DRIVE_FOLDER_ID.split(",") if f.strip()]
GOOGLE_DRIVE_CREDENTIALS_FILE = os.environ.get("GOOGLE_DRIVE_CREDENTIALS_FILE", os.path.join(BASE_DIR, "credentials.json"))
GOOGLE_DRIVE_CREDENTIALS_JSON = os.environ.get("GOOGLE_DRIVE_CREDENTIALS_JSON", "")
DRIVE_POLL_INTERVAL_MINUTES = int(os.environ.get("DRIVE_POLL_INTERVAL_MINUTES", "10"))
# Only ingest images created within this many days (0 = no limit). Keeps the
# first poll from downloading years of camera roll; older files are marked
# seen without downloading.
DRIVE_LOOKBACK_DAYS = int(os.environ.get("DRIVE_LOOKBACK_DAYS", "90"))

# Legacy local-folder mode (Drive for Desktop mount on the host machine)
WATCH_FOLDER = os.environ.get("WATCH_FOLDER", r"G:\My Drive\Mobile Photo Sync")

# DATA_DIR: where the database and receipt images live. Locally this is the
# project folder; on Render set DATA_DIR=/var/data and attach a persistent
# disk there, or every deploy wipes the database and images.
DATA_DIR = os.environ.get("DATA_DIR", BASE_DIR)

RECEIPTS_DIR = os.path.join(DATA_DIR, "receipts")
ORIGINALS_DIR = os.path.join(RECEIPTS_DIR, "originals")
THUMBNAILS_DIR = os.path.join(RECEIPTS_DIR, "thumbnails")
INBOX_DIR = os.path.join(RECEIPTS_DIR, "inbox")
DB_PATH = os.path.join(DATA_DIR, "receipts.db")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# OCR receipt detection — minimum score to classify as receipt
OCR_RECEIPT_THRESHOLD = 4

# Thumbnail dimensions
THUMBNAIL_SIZE = (280, 360)

# Supported image extensions
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tiff", ".bmp"}

# Ensure storage directories exist (fresh deploys have none of them)
for _d in (RECEIPTS_DIR, ORIGINALS_DIR, THUMBNAILS_DIR, INBOX_DIR):
    os.makedirs(_d, exist_ok=True)

# Categories available for assignment
CATEGORIES = [
    "Shopping",
    "Groceries",
    "Dining",
    "Gas",
    "Auto Repair",
    "Utilities",
    "Education",
    "Healthcare",
    "Travel",
    "Entertainment",
    "Other",
]
