import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Ingestion ────────────────────────────────────────────────────────────────
# Preferred: Google Drive API polling (works anywhere — no Drive for Desktop
# mount needed). Set GOOGLE_DRIVE_FOLDER_ID to enable; the legacy local
# WATCH_FOLDER watchdog is used only when the folder ID is unset.
GOOGLE_DRIVE_FOLDER_ID = os.environ.get("GOOGLE_DRIVE_FOLDER_ID", "")
GOOGLE_DRIVE_CREDENTIALS_FILE = os.environ.get("GOOGLE_DRIVE_CREDENTIALS_FILE", os.path.join(BASE_DIR, "credentials.json"))
GOOGLE_DRIVE_CREDENTIALS_JSON = os.environ.get("GOOGLE_DRIVE_CREDENTIALS_JSON", "")
DRIVE_POLL_INTERVAL_MINUTES = int(os.environ.get("DRIVE_POLL_INTERVAL_MINUTES", "10"))

# Legacy local-folder mode (Drive for Desktop mount on the host machine)
WATCH_FOLDER = os.environ.get("WATCH_FOLDER", r"G:\My Drive\Mobile Photo Sync")

RECEIPTS_DIR = os.path.join(BASE_DIR, "receipts")
ORIGINALS_DIR = os.path.join(RECEIPTS_DIR, "originals")
THUMBNAILS_DIR = os.path.join(RECEIPTS_DIR, "thumbnails")
INBOX_DIR = os.path.join(RECEIPTS_DIR, "inbox")
DB_PATH = os.path.join(BASE_DIR, "receipts.db")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# OCR receipt detection — minimum score to classify as receipt
OCR_RECEIPT_THRESHOLD = 4

# Thumbnail dimensions
THUMBNAIL_SIZE = (280, 360)

# Supported image extensions
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tiff", ".bmp"}

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
