"""
classifier.py — OCR-based receipt detection.
Uses Tesseract to extract text, then scores it against receipt patterns.
No Claude API calls here — keeps classification cheap.
"""

import re
import logging
from pathlib import Path

from PIL import Image, ImageOps

try:
    import pytesseract
    # Point to Tesseract installation if not on PATH
    import os, shutil
    if not shutil.which("tesseract"):
        for candidate in [
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        ]:
            if os.path.isfile(candidate):
                pytesseract.pytesseract.tesseract_cmd = candidate
                break
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False
    logging.warning("pytesseract not available — all images will be skipped")

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    HEIF_AVAILABLE = True
except ImportError:
    HEIF_AVAILABLE = False

from config import OCR_RECEIPT_THRESHOLD

logger = logging.getLogger(__name__)

# ── Keyword patterns ─────────────────────────────────────────────────────────

# High-confidence keywords (worth 2 points each)
_HIGH_CONF_PATTERNS = [
    r"\btotal\b",
    r"\bsubtotal\b",
    r"\bsub[\s-]?total\b",
    r"\breceipt\b",
    r"\binvoice\b",
    r"\bamount\s*due\b",
    r"\bamount\s*paid\b",
    r"\bbalance\b",
    r"\bchange\s*due\b",
]

# Medium-confidence keywords (worth 1 point each)
_MED_CONF_PATTERNS = [
    r"\btax\b",
    r"\bpurchase\b",
    r"\bpayment\b",
    r"\bthank\s*you\b",
    r"\bcashier\b",
    r"\bregister\b",
    r"\btransaction\b",
    r"\bqty\b",
    r"\bdiscount\b",
    r"\bsavings?\b",
    r"\bauthorized\b",
    r"\bapproved\b",
    r"\bvisa\b",
    r"\bmastercard\b",
    r"\bdiscover\b",
    r"\bamex\b",
    r"\bdebit\b",
    r"\bcredit\b",
    r"\border\s*#",
    r"\bstore\s*#",
    r"\bmerchant\b",
    r"\brefund\b",
    r"\btip\b",
    r"\bgratuity\b",
    r"\bwelcome\s+to\b",
    r"\bsale\b",
    r"\bitem\b",
    r"\bprice\b",
    r"\bcoupon\b",
    r"\bcontactless\b",
    r"\bchip\s*read\b",
    r"\bauth\b",
]

# Dollar amount pattern
_PRICE_RE = re.compile(
    r"\$\s*\d{1,6}[.,]\d{2}"
    r"|\d{1,6}\.\d{2}\s*(?:USD|usd)"
)

# Standalone prices like "4.29" on their own or with surrounding receipt context
_LOOSE_PRICE_RE = re.compile(r"\b\d{1,5}\.\d{2}\b")

_compiled_high = [re.compile(p, re.IGNORECASE) for p in _HIGH_CONF_PATTERNS]
_compiled_med  = [re.compile(p, re.IGNORECASE) for p in _MED_CONF_PATTERNS]


def _score_text(text: str) -> int:
    """Return a numeric receipt-confidence score for the extracted OCR text."""
    score = 0

    for pattern in _compiled_high:
        if pattern.search(text):
            score += 2

    for pattern in _compiled_med:
        if pattern.search(text):
            score += 1

    # Dollar-sign prices are strong receipt signals
    dollar_prices = _PRICE_RE.findall(text)
    score += min(len(dollar_prices), 5) * 2

    # Loose decimal prices (e.g. "4.29") are weaker but still useful
    loose_prices = _LOOSE_PRICE_RE.findall(text)
    score += min(len(loose_prices), 8)

    return score


# Cap the working resolution. Modern phone photos are 12-48MP; running
# them through preprocessing + tesseract at full size spikes hundreds of
# MB and OOM-kills small containers (Render starter = 512MB). Receipt
# text OCRs reliably at this size.
MAX_OCR_DIMENSION = 2200


def _open_image(path: str) -> Image.Image:
    """Open an image, apply EXIF rotation, downscale, convert to RGB."""
    img = Image.open(path)
    # Apply EXIF orientation (critical for phone photos)
    img = ImageOps.exif_transpose(img)
    if max(img.size) > MAX_OCR_DIMENSION:
        img.thumbnail((MAX_OCR_DIMENSION, MAX_OCR_DIMENSION), Image.LANCZOS)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img


def _preprocess(img: Image.Image) -> Image.Image:
    """Preprocess image for optimal Tesseract OCR on receipt photos."""
    # Convert to grayscale
    gray = ImageOps.grayscale(img)

    # Boost contrast to handle variable lighting
    gray = ImageOps.autocontrast(gray, cutoff=5)

    # Binarize — receipts are high-contrast text on white/light paper
    bw = gray.point(lambda x: 255 if x > 140 else 0, "1")

    # Upscale small images for better OCR
    w, h = bw.size
    if max(w, h) < 1500:
        scale = 1500 / max(w, h)
        bw = bw.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    return bw


def classify(image_path: str) -> tuple[bool, str, int]:
    """
    Classify whether an image is a receipt.

    Returns:
        (is_receipt, ocr_text, score)
    """
    if not TESSERACT_AVAILABLE:
        return False, "", 0

    ext = Path(image_path).suffix.lower()
    if not HEIF_AVAILABLE and ext in (".heic", ".heif"):
        logger.warning("HEIC file skipped — install pillow-heif for HEIC support: %s", image_path)
        return False, "", 0

    try:
        img = _open_image(image_path)
        processed = _preprocess(img)
        ocr_text = pytesseract.image_to_string(processed, config="--psm 3 --oem 3")
        score = _score_text(ocr_text)
        is_receipt = score >= OCR_RECEIPT_THRESHOLD
        logger.info(
            "classify %s → score=%d is_receipt=%s",
            Path(image_path).name,
            score,
            is_receipt,
        )
        return is_receipt, ocr_text, score
    except Exception:
        logger.exception("Error classifying %s", image_path)
        return False, "", 0
