"""
processor.py — Core pipeline that ties classifier → extractor → database.
Called by the watcher and by the manual scan endpoint.
"""

import hashlib
import logging
import os
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from config import ORIGINALS_DIR, THUMBNAILS_DIR, IMAGE_EXTENSIONS, THUMBNAIL_SIZE
import classifier
import database
import extractor

logger = logging.getLogger(__name__)

# Global processing queue state
_lock = threading.Lock()
_processing = False
_last_scan: datetime | None = None
_queue: list[str] = []


def _file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _make_thumbnail(src_path: str, dest_path: str):
    try:
        img = Image.open(src_path)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")
        img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)
        # Paste onto white background to avoid transparent PNGs
        bg = Image.new("RGB", THUMBNAIL_SIZE, (255, 255, 255))
        offset = ((THUMBNAIL_SIZE[0] - img.width) // 2, (THUMBNAIL_SIZE[1] - img.height) // 2)
        if img.mode == "RGBA":
            bg.paste(img, offset, img)
        else:
            bg.paste(img, offset)
        bg.save(dest_path, "JPEG", quality=85)
    except Exception:
        logger.exception("Thumbnail generation failed for %s", src_path)


def process_file(source_path: str) -> str:
    """
    Full pipeline for a single image file.

    Returns one of: 'duplicate' | 'not_receipt' | 'processed' | 'error'
    """
    global _last_scan
    source_path = str(source_path)
    ext = Path(source_path).suffix.lower()

    if ext not in IMAGE_EXTENSIONS:
        return "not_image"

    # ── Duplicate check ──────────────────────────────────────────────────────
    try:
        fhash = _file_hash(source_path)
    except Exception:
        logger.exception("Could not hash %s", source_path)
        return "error"

    if database.hash_exists(fhash):
        logger.info("Duplicate skipped: %s", source_path)
        return "duplicate"

    # ── OCR classification ───────────────────────────────────────────────────
    is_receipt, ocr_text, score = classifier.classify(source_path)
    if not is_receipt:
        logger.info("Not a receipt (score=%d): %s", score, source_path)
        return "not_receipt"

    # ── Copy to originals ────────────────────────────────────────────────────
    stem = Path(source_path).stem
    safe_stem = "".join(c if c.isalnum() or c in "-_" else "_" for c in stem)
    stored_name = f"{safe_stem}_{fhash[:8]}{ext}"
    stored_path = os.path.join(ORIGINALS_DIR, stored_name)
    thumb_name = f"{safe_stem}_{fhash[:8]}.jpg"
    thumb_path = os.path.join(THUMBNAILS_DIR, thumb_name)

    try:
        shutil.copy2(source_path, stored_path)
        _make_thumbnail(stored_path, thumb_path)
    except Exception:
        logger.exception("Could not copy receipt file %s", source_path)
        return "error"

    # ── Insert pending record ────────────────────────────────────────────────
    rid = database.insert_receipt(
        {
            "filename": stored_name,
            "original_path": source_path,
            "stored_path": stored_path,
            "thumbnail_path": thumb_path,
            "vendor_name": None,
            "date": None,
            "card_last4": None,
            "card_type": None,
            "total_amount": None,
            "category": None,
            "status": "processing",
            "raw_ocr_text": ocr_text,
            "file_hash": fhash,
        }
    )

    # ── Claude extraction ────────────────────────────────────────────────────
    data = extractor.extract(stored_path, ocr_text)
    if data is None:
        database.update_receipt(rid, {"status": "error"})
        logger.error("Extraction failed for receipt id=%d", rid)
        return "error"

    items = data.pop("items", [])
    data["status"] = "processed"
    data["processed_at"] = datetime.now(timezone.utc).isoformat()
    database.update_receipt(rid, data)
    database.insert_items(rid, items)
    _last_scan = datetime.now(timezone.utc)
    logger.info("Processed receipt id=%d vendor=%s total=%s", rid, data.get("vendor_name"), data.get("total_amount"))
    return "processed"


def scan_folder(folder: str) -> dict:
    """Scan an entire folder and process all new images. Returns a summary."""
    global _processing
    with _lock:
        if _processing:
            return {"status": "already_running"}
        _processing = True

    results = {"processed": 0, "not_receipt": 0, "duplicate": 0, "error": 0, "not_image": 0}
    try:
        for root, dirs, files in os.walk(folder):
            for fname in files:
                filepath = os.path.join(root, fname)
                result = process_file(filepath)
                results[result] = results.get(result, 0) + 1
                logger.info("File %s → %s", fname, result)
    except FileNotFoundError:
        logger.error("Watch folder not found: %s", folder)
    finally:
        with _lock:
            _processing = False
    return results


def get_status() -> dict:
    return {
        "processing": _processing,
        "last_scan": _last_scan.isoformat() if _last_scan else None,
    }
