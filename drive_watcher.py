"""
drive_watcher.py — Google Drive API ingestion.

Replaces the local-folder watchdog when GOOGLE_DRIVE_FOLDER_ID is set:
instead of watching a Google Drive for Desktop mount (which only works on
the one machine that has the G:\\ drive), this polls the Drive folder
directly through the Drive API. Photos synced from the phone land in Drive,
this pulls them down wherever the app is running, and hands each new image
to the existing processor pipeline (which dedupes by file hash).

Setup:
  1. A Google Cloud service account with the Drive API enabled — the same
     credentials.json pattern as the Content Engine works here.
  2. Share the Drive folder with the service account's email address
     (Viewer is enough — access is read-only).
  3. Set GOOGLE_DRIVE_FOLDER_ID in .env (the ID from the folder's URL),
     and GOOGLE_DRIVE_CREDENTIALS_FILE (path to the key file) or
     GOOGLE_DRIVE_CREDENTIALS_JSON (the full JSON, for cloud deploys).

State: seen Drive file IDs are recorded in drive_state.json next to the
database, so each poll only downloads what's new. The processor's
hash-dedupe remains the backstop, so wiping the state file is always safe.

Runs in a background thread; started by app.py on startup. Mirrors the
watcher.py interface (start/stop/is_running) so app.py can treat either
ingestion mode the same way.
"""

import io
import json
import logging
import os
import threading
import time

from config import (
    DATA_DIR,
    DRIVE_POLL_INTERVAL_MINUTES,
    GOOGLE_DRIVE_CREDENTIALS_FILE,
    GOOGLE_DRIVE_CREDENTIALS_JSON,
    GOOGLE_DRIVE_FOLDER_ID,
    IMAGE_EXTENSIONS,
    INBOX_DIR,
)

logger = logging.getLogger(__name__)

STATE_PATH = os.path.join(DATA_DIR, "drive_state.json")
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

_thread: threading.Thread | None = None
_stop_event = threading.Event()
_last_poll: str | None = None
_last_error: str | None = None


# ── Credentials / service ────────────────────────────────────────────────────

def _get_service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    if GOOGLE_DRIVE_CREDENTIALS_JSON:
        info = json.loads(GOOGLE_DRIVE_CREDENTIALS_JSON)
        creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    elif GOOGLE_DRIVE_CREDENTIALS_FILE and os.path.exists(GOOGLE_DRIVE_CREDENTIALS_FILE):
        creds = service_account.Credentials.from_service_account_file(
            GOOGLE_DRIVE_CREDENTIALS_FILE, scopes=SCOPES
        )
    else:
        raise RuntimeError(
            "No Google Drive credentials. Set GOOGLE_DRIVE_CREDENTIALS_FILE "
            "(path to service-account key) or GOOGLE_DRIVE_CREDENTIALS_JSON."
        )
    # cache_discovery=False avoids a noisy warning under threads
    return build("drive", "v3", credentials=creds, cache_discovery=False)


# ── Seen-file state ──────────────────────────────────────────────────────────

def _load_state() -> dict:
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"seen_ids": []}


def _save_state(state: dict):
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(tmp, STATE_PATH)


# ── Polling ──────────────────────────────────────────────────────────────────

def poll_once() -> dict:
    """
    One pass: list images in the Drive folder, download any not seen
    before, run each through the processor. Returns a result summary.
    """
    global _last_poll, _last_error
    import processor  # late import to avoid cycles

    summary = {"listed": 0, "downloaded": 0, "processed": 0, "skipped": 0, "errors": 0}
    state = _load_state()
    seen = set(state.get("seen_ids", []))

    try:
        service = _get_service()
        os.makedirs(INBOX_DIR, exist_ok=True)

        page_token = None
        files = []
        while True:
            resp = service.files().list(
                q=(
                    f"'{GOOGLE_DRIVE_FOLDER_ID}' in parents "
                    "and trashed = false and mimeType contains 'image/'"
                ),
                fields="nextPageToken, files(id, name, mimeType, size, createdTime)",
                pageSize=200,
                pageToken=page_token,
                orderBy="createdTime",
            ).execute()
            files.extend(resp.get("files", []))
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

        summary["listed"] = len(files)

        for f in files:
            if _stop_event.is_set():
                break
            if f["id"] in seen:
                summary["skipped"] += 1
                continue

            name = f.get("name", f["id"])
            ext = os.path.splitext(name)[1].lower()
            if ext and ext not in IMAGE_EXTENSIONS:
                seen.add(f["id"])
                summary["skipped"] += 1
                continue

            local_path = os.path.join(INBOX_DIR, f"{f['id']}_{name}")
            try:
                from googleapiclient.http import MediaIoBaseDownload

                request = service.files().get_media(fileId=f["id"])
                with io.FileIO(local_path, "wb") as fh:
                    downloader = MediaIoBaseDownload(fh, request)
                    done = False
                    while not done:
                        _status, done = downloader.next_chunk()
                summary["downloaded"] += 1

                result = processor.process_file(local_path)
                summary["processed"] += 1
                logger.info("Drive file %s -> %s", name, result)

                # Mark seen regardless of processor outcome (duplicate /
                # not_receipt are normal); hash-dedupe is the backstop.
                seen.add(f["id"])

                # The processor copies originals into ORIGINALS_DIR;
                # remove the inbox copy if it's still there.
                try:
                    if os.path.exists(local_path):
                        os.remove(local_path)
                except OSError:
                    pass
            except Exception:
                summary["errors"] += 1
                logger.exception("Failed to ingest Drive file %s", name)

        state["seen_ids"] = list(seen)
        _save_state(state)
        _last_error = None
    except Exception as e:
        _last_error = str(e)
        summary["errors"] += 1
        logger.exception("Drive poll failed")

    _last_poll = time.strftime("%Y-%m-%dT%H:%M:%S")
    return summary


def _loop():
    interval = max(1, DRIVE_POLL_INTERVAL_MINUTES) * 60
    logger.info(
        "Drive watcher polling folder %s every %d min",
        GOOGLE_DRIVE_FOLDER_ID, DRIVE_POLL_INTERVAL_MINUTES,
    )
    while not _stop_event.is_set():
        poll_once()
        _stop_event.wait(interval)


# ── watcher.py-compatible interface ──────────────────────────────────────────

def start():
    global _thread
    if not GOOGLE_DRIVE_FOLDER_ID:
        logger.warning("GOOGLE_DRIVE_FOLDER_ID not set; drive watcher not started")
        return
    if _thread and _thread.is_alive():
        logger.info("Drive watcher already running")
        return
    _stop_event.clear()
    _thread = threading.Thread(target=_loop, daemon=True, name="drive-watcher")
    _thread.start()


def stop():
    global _thread
    _stop_event.set()
    if _thread:
        _thread.join(timeout=5)
        _thread = None


def is_running() -> bool:
    return _thread is not None and _thread.is_alive()


def get_status() -> dict:
    return {
        "mode": "drive",
        "folder_id": GOOGLE_DRIVE_FOLDER_ID,
        "poll_interval_minutes": DRIVE_POLL_INTERVAL_MINUTES,
        "last_poll": _last_poll,
        "last_error": _last_error,
        "running": is_running(),
    }
