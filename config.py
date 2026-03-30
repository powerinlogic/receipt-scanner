import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

WATCH_FOLDER = r"G:\My Drive\Mobile Photo Sync"
RECEIPTS_DIR = os.path.join(BASE_DIR, "receipts")
ORIGINALS_DIR = os.path.join(RECEIPTS_DIR, "originals")
THUMBNAILS_DIR = os.path.join(RECEIPTS_DIR, "thumbnails")
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
