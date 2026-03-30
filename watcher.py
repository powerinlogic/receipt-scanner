"""
watcher.py — Watchdog-based file system monitor.
Watches the configured folder and processes new images as they appear.
Runs in a background thread; started by app.py on startup.
"""

import logging
import threading
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler, FileCreatedEvent, FileMovedEvent
from watchdog.observers import Observer

from config import WATCH_FOLDER, IMAGE_EXTENSIONS
import processor

logger = logging.getLogger(__name__)

_observer: Observer | None = None
_watch_folder = WATCH_FOLDER


class _ReceiptHandler(FileSystemEventHandler):
    def _handle(self, path: str):
        if Path(path).suffix.lower() not in IMAGE_EXTENSIONS:
            return
        # Small delay to ensure the file is fully written before reading
        time.sleep(1.5)
        logger.info("Watcher detected new file: %s", path)
        processor.process_file(path)

    def on_created(self, event: FileCreatedEvent):
        if not event.is_directory:
            self._handle(event.src_path)

    def on_moved(self, event: FileMovedEvent):
        if not event.is_directory:
            self._handle(event.dest_path)


def start(folder: str | None = None):
    """Start the watchdog observer in the background."""
    global _observer, _watch_folder
    if folder:
        _watch_folder = folder

    if _observer and _observer.is_alive():
        logger.info("Watcher already running")
        return

    try:
        handler = _ReceiptHandler()
        _observer = Observer()
        _observer.schedule(handler, _watch_folder, recursive=True)
        _observer.start()
        logger.info("Watching folder: %s", _watch_folder)
    except Exception:
        logger.exception("Failed to start watcher on %s", _watch_folder)


def stop():
    global _observer
    if _observer:
        _observer.stop()
        _observer.join()
        _observer = None


def is_running() -> bool:
    return _observer is not None and _observer.is_alive()


def get_watch_folder() -> str:
    return _watch_folder


def set_watch_folder(folder: str):
    """Change the watched folder (restarts the observer)."""
    global _watch_folder
    stop()
    _watch_folder = folder
    start()
