"""
extractor.py — Claude-based receipt data extraction.
Only called after classifier confirms the image is a receipt.
"""

import base64
import json
import logging
import os
import re
from pathlib import Path

import anthropic

from config import ANTHROPIC_API_KEY

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _client


_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".heic": "image/jpeg",  # converted before sending
    ".heif": "image/jpeg",
}

_PROMPT = """\
You are a receipt data extraction assistant. Analyze this receipt image carefully and return ONLY a valid JSON object — no markdown, no explanation, just the raw JSON.

Extract these fields:

{
  "vendor_name": "Full store/restaurant/service name as printed",
  "date": "YYYY-MM-DD (null if not found)",
  "card_last4": "Last 4 digits of the payment card as a string, null if cash or not shown",
  "card_type": "Visa | Mastercard | Discover | Amex | Debit | null",
  "total_amount": 0.00,
  "category": "Exactly one of: Shopping, Groceries, Dining, Gas, Auto Repair, Utilities, Education, Healthcare, Travel, Entertainment, Other",
  "items": [
    {
      "description": "Item name",
      "quantity": 1,
      "unit_price": 0.00,
      "total_price": 0.00
    }
  ]
}

Rules:
- total_amount is the final amount paid (after tax, discounts, tips)
- If an item quantity is not shown, use 1
- If unit_price cannot be determined, set it to null
- If there are no line items visible, return an empty items array
- All monetary values must be numbers (no $ sign)
- date must be null if you cannot determine it with confidence

OCR context (may contain errors — use image as primary source):
{ocr_text}"""


def _encode_image(image_path: str) -> tuple[str, str]:
    """Return (base64_data, media_type). Converts HEIC to JPEG first."""
    ext = Path(image_path).suffix.lower()

    if ext in (".heic", ".heif"):
        try:
            from PIL import Image
            from pillow_heif import register_heif_opener
            register_heif_opener()
            img = Image.open(image_path).convert("RGB")
            import io
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=90)
            data = base64.standard_b64encode(buf.getvalue()).decode()
            return data, "image/jpeg"
        except Exception:
            logger.exception("HEIC conversion failed for %s", image_path)
            raise

    with open(image_path, "rb") as f:
        data = base64.standard_b64encode(f.read()).decode()
    media_type = _MEDIA_TYPES.get(ext, "image/jpeg")
    return data, media_type


def extract(image_path: str, ocr_text: str = "") -> dict | None:
    """
    Send the receipt image to Claude and return structured data.

    Returns a dict with keys: vendor_name, date, card_last4, card_type,
    total_amount, category, items — or None on failure.
    """
    try:
        image_data, media_type = _encode_image(image_path)
    except Exception:
        logger.exception("Could not encode image %s", image_path)
        return None

    prompt = _PROMPT.replace("{ocr_text}", (ocr_text or "")[:3000])

    try:
        client = _get_client()
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=2048,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_data,
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        )
        raw = response.content[0].text.strip()
        logger.debug("Claude raw response for %s: %s", Path(image_path).name, raw[:500])

        # Strip markdown code fences if present
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

        parsed = json.loads(raw)
        return _sanitize(parsed)

    except json.JSONDecodeError:
        logger.error("Claude returned non-JSON for %s: %s", image_path, raw[:300])
        return None
    except Exception:
        logger.exception("Claude extraction failed for %s", image_path)
        return None


def _sanitize(data: dict) -> dict:
    """Normalize and validate the parsed Claude response."""
    def _float(val):
        try:
            return round(float(val), 2)
        except (TypeError, ValueError):
            return None

    items = []
    for it in data.get("items") or []:
        items.append(
            {
                "description": str(it.get("description") or "").strip(),
                "quantity": _float(it.get("quantity")) or 1.0,
                "unit_price": _float(it.get("unit_price")),
                "total_price": _float(it.get("total_price")),
            }
        )

    return {
        "vendor_name": (str(data.get("vendor_name") or "").strip() or None),
        "date": (str(data.get("date") or "").strip() or None),
        "card_last4": (str(data.get("card_last4") or "").strip()[-4:] or None)
        if data.get("card_last4")
        else None,
        "card_type": (str(data.get("card_type") or "").strip() or None),
        "total_amount": _float(data.get("total_amount")),
        "category": (str(data.get("category") or "").strip() or "Other"),
        "items": items,
    }
