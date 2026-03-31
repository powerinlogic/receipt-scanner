import sqlite3
import os
from config import DB_PATH


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS receipts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            filename        TEXT    NOT NULL,
            original_path   TEXT,
            stored_path     TEXT    NOT NULL,
            thumbnail_path  TEXT,
            vendor_name     TEXT,
            date            TEXT,
            card_last4      TEXT,
            card_type       TEXT,
            total_amount    REAL,
            category        TEXT,
            status          TEXT    NOT NULL DEFAULT 'pending',
            raw_ocr_text    TEXT,
            notes           TEXT,
            file_hash       TEXT    UNIQUE,
            created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            processed_at    TEXT
        );

        CREATE TABLE IF NOT EXISTS folders (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
            color      TEXT    NOT NULL DEFAULT '#6366f1',
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS receipt_folders (
            receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
            folder_id  INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
            PRIMARY KEY (receipt_id, folder_id)
        );

        CREATE INDEX IF NOT EXISTS idx_rf_receipt ON receipt_folders(receipt_id);
        CREATE INDEX IF NOT EXISTS idx_rf_folder  ON receipt_folders(folder_id);

        CREATE TABLE IF NOT EXISTS receipt_items (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            receipt_id   INTEGER NOT NULL,
            description  TEXT,
            quantity     REAL    DEFAULT 1,
            unit_price   REAL,
            total_price  REAL,
            FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_receipts_date      ON receipts(date);
        CREATE INDEX IF NOT EXISTS idx_receipts_vendor    ON receipts(vendor_name);
        CREATE INDEX IF NOT EXISTS idx_receipts_card      ON receipts(card_last4);
        CREATE INDEX IF NOT EXISTS idx_receipts_category  ON receipts(category);
        CREATE INDEX IF NOT EXISTS idx_receipts_status    ON receipts(status);
        CREATE INDEX IF NOT EXISTS idx_items_receipt      ON receipt_items(receipt_id);
    """)
    conn.commit()
    conn.close()


# ── Receipts ────────────────────────────────────────────────────────────────

def insert_receipt(data: dict) -> int:
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO receipts
           (filename, original_path, stored_path, thumbnail_path,
            vendor_name, date, card_last4, card_type, total_amount,
            category, status, raw_ocr_text, file_hash)
           VALUES (:filename, :original_path, :stored_path, :thumbnail_path,
                   :vendor_name, :date, :card_last4, :card_type, :total_amount,
                   :category, :status, :raw_ocr_text, :file_hash)""",
        data,
    )
    conn.commit()
    rid = cur.lastrowid
    conn.close()
    return rid


def update_receipt(rid: int, data: dict):
    fields = ", ".join(f"{k} = :{k}" for k in data)
    data["id"] = rid
    conn = get_db()
    conn.execute(f"UPDATE receipts SET {fields} WHERE id = :id", data)
    conn.commit()
    conn.close()


def get_receipt(rid: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM receipts WHERE id = ?", (rid,)).fetchone()
    conn.close()
    return dict(row) if row else None


def delete_receipt(rid: int):
    conn = get_db()
    conn.execute("DELETE FROM receipts WHERE id = ?", (rid,))
    conn.commit()
    conn.close()


def hash_exists(file_hash: str) -> bool:
    conn = get_db()
    row = conn.execute(
        "SELECT 1 FROM receipts WHERE file_hash = ?", (file_hash,)
    ).fetchone()
    conn.close()
    return row is not None


def _apply_filters(conditions, params, *, search, cards, vendors, category,
                   date_from, date_to, folder_id, missing):
    """Shared filter-building helper used by list_receipts and get_filtered_stats."""
    if folder_id:
        conditions.append("r.id IN (SELECT receipt_id FROM receipt_folders WHERE folder_id = ?)")
        params.append(folder_id)
    if search:
        conditions.append("(r.vendor_name LIKE ? OR r.raw_ocr_text LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]
    if cards:
        ph = ','.join('?' * len(cards))
        conditions.append(f"r.card_last4 IN ({ph})")
        params.extend(cards)
    if vendors:
        ph = ','.join('?' * len(vendors))
        conditions.append(f"r.vendor_name IN ({ph})")
        params.extend(vendors)
    if category:
        conditions.append("r.category = ?")
        params.append(category)
    if date_from:
        conditions.append("r.date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("r.date <= ?")
        params.append(date_to)
    if missing == 'no_vendor':
        conditions.append("(r.vendor_name IS NULL OR r.vendor_name = '')")
    elif missing == 'no_card':
        conditions.append("r.card_last4 IS NULL")
    elif missing == 'no_amount':
        conditions.append("r.total_amount IS NULL")
    elif missing == 'no_date':
        conditions.append("r.date IS NULL")
    elif missing == 'no_category':
        conditions.append("(r.category IS NULL OR r.category = '')")


def list_receipts(
    search=None,
    cards=None,        # list of card_last4 values; None = all
    vendors=None,      # list of vendor names; None = all
    category=None,
    date_from=None,
    date_to=None,
    sort_by="date",
    sort_dir="desc",
    page=1,
    per_page=50,
    show_hidden=False,
    folder_id=None,
    missing=None,
):
    allowed_sorts = {"date", "vendor_name", "total_amount", "card_last4", "created_at"}
    if sort_by not in allowed_sorts:
        sort_by = "date"
    sort_dir = "ASC" if sort_dir.lower() == "asc" else "DESC"

    if show_hidden:
        conditions = ["r.status IN ('processed', 'hidden')"]
    else:
        conditions = ["r.status = 'processed'"]
    params = []

    _apply_filters(conditions, params, search=search, cards=cards, vendors=vendors,
                   category=category, date_from=date_from, date_to=date_to,
                   folder_id=folder_id, missing=missing)

    where = " AND ".join(conditions)
    offset = (page - 1) * per_page

    conn = get_db()
    total = conn.execute(
        f"SELECT COUNT(*) FROM receipts r WHERE {where}", params
    ).fetchone()[0]

    rows = conn.execute(
        f"""SELECT r.*,
                   (SELECT GROUP_CONCAT(description, ', ')
                    FROM receipt_items WHERE receipt_id = r.id LIMIT 5) AS items_preview
            FROM receipts r
            WHERE {where}
            ORDER BY COALESCE(r.{sort_by}, '') {sort_dir},
                     r.created_at DESC
            LIMIT ? OFFSET ?""",
        params + [per_page, offset],
    ).fetchall()
    conn.close()

    return [dict(r) for r in rows], total


def get_filtered_stats(
    search=None, cards=None, vendors=None, category=None,
    date_from=None, date_to=None, folder_id=None,
    show_hidden=False, missing=None,
):
    """Return aggregate stats for the current filter — mirrors list_receipts logic."""
    if show_hidden:
        conditions = ["r.status IN ('processed', 'hidden')"]
    else:
        conditions = ["r.status = 'processed'"]
    params = []
    _apply_filters(conditions, params, search=search, cards=cards, vendors=vendors,
                   category=category, date_from=date_from, date_to=date_to,
                   folder_id=folder_id, missing=missing)

    where = " AND ".join(conditions)
    conn = get_db()
    row = conn.execute(
        f"""SELECT
               COUNT(*)                           AS total_receipts,
               COALESCE(SUM(r.total_amount), 0)  AS total_spend,
               COUNT(DISTINCT r.vendor_name)      AS vendors,
               COUNT(DISTINCT r.card_last4)       AS cards_on_file
            FROM receipts r WHERE {where}""",
        params,
    ).fetchone()
    conn.close()
    return dict(row)


def get_stats():
    conn = get_db()
    row = conn.execute(
        """SELECT
               COUNT(*)                                        AS total_receipts,
               COALESCE(SUM(total_amount), 0)                 AS total_spend,
               COUNT(DISTINCT vendor_name)                     AS vendors,
               COUNT(DISTINCT card_last4)                      AS cards_on_file
           FROM receipts
           WHERE status = 'processed'"""
    ).fetchone()
    pending = conn.execute(
        "SELECT COUNT(*) FROM receipts WHERE status IN ('pending','processing')"
    ).fetchone()[0]
    review = conn.execute(
        "SELECT COUNT(*) FROM receipts WHERE status = 'review'"
    ).fetchone()[0]
    conn.close()
    return dict(row) | {"pending": pending, "review": review}


def list_review_queue():
    """Return all receipts awaiting review (non-receipt candidates)."""
    conn = get_db()
    rows = conn.execute(
        """SELECT r.*,
                  (SELECT GROUP_CONCAT(description, ', ')
                   FROM receipt_items WHERE receipt_id = r.id LIMIT 5) AS items_preview
           FROM receipts r
           WHERE status = 'review'
           ORDER BY r.created_at DESC"""
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_cards():
    conn = get_db()
    rows = conn.execute(
        """SELECT card_last4, card_type, COUNT(*) AS receipt_count
           FROM receipts
           WHERE status = 'processed' AND card_last4 IS NOT NULL
           GROUP BY card_last4, card_type
           ORDER BY receipt_count DESC"""
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Receipt Items ────────────────────────────────────────────────────────────

def insert_items(receipt_id: int, items: list):
    if not items:
        return
    conn = get_db()
    conn.executemany(
        """INSERT INTO receipt_items (receipt_id, description, quantity, unit_price, total_price)
           VALUES (?, ?, ?, ?, ?)""",
        [
            (
                receipt_id,
                i.get("description"),
                i.get("quantity", 1),
                i.get("unit_price"),
                i.get("total_price"),
            )
            for i in items
        ],
    )
    conn.commit()
    conn.close()


def get_items(receipt_id: int):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY id",
        (receipt_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def replace_items(receipt_id: int, items: list):
    conn = get_db()
    conn.execute("DELETE FROM receipt_items WHERE receipt_id = ?", (receipt_id,))
    conn.commit()
    conn.close()
    insert_items(receipt_id, items)


# ── Folders ──────────────────────────────────────────────────────────────────

def get_folders() -> list:
    """Return all folders as a flat list with receipt counts."""
    conn = get_db()
    rows = conn.execute(
        """SELECT f.*,
                  COUNT(rf.receipt_id) AS receipt_count
           FROM folders f
           LEFT JOIN receipt_folders rf ON rf.folder_id = f.id
           LEFT JOIN receipts r ON r.id = rf.receipt_id
               AND r.status IN ('processed', 'hidden')
           GROUP BY f.id
           ORDER BY f.parent_id NULLS FIRST, f.name COLLATE NOCASE"""
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_folder(name: str, parent_id: int | None = None, color: str = "#6366f1") -> int:
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO folders (name, parent_id, color) VALUES (?, ?, ?)",
        (name.strip(), parent_id, color),
    )
    conn.commit()
    fid = cur.lastrowid
    conn.close()
    return fid


def update_folder(fid: int, data: dict):
    allowed = {"name", "parent_id", "color"}
    data = {k: v for k, v in data.items() if k in allowed}
    if not data:
        return
    fields = ", ".join(f"{k} = :{k}" for k in data)
    data["id"] = fid
    conn = get_db()
    conn.execute(f"UPDATE folders SET {fields} WHERE id = :id", data)
    conn.commit()
    conn.close()


def delete_folder(fid: int):
    conn = get_db()
    conn.execute("DELETE FROM folders WHERE id = ?", (fid,))
    conn.commit()
    conn.close()


# ── Receipt ↔ Folder tagging ──────────────────────────────────────────────────

def get_receipt_folder_ids(receipt_id: int) -> list[int]:
    conn = get_db()
    rows = conn.execute(
        "SELECT folder_id FROM receipt_folders WHERE receipt_id = ?", (receipt_id,)
    ).fetchall()
    conn.close()
    return [r[0] for r in rows]


def set_receipt_folders(receipt_id: int, folder_ids: list[int]):
    """Replace all folder assignments for a receipt."""
    conn = get_db()
    conn.execute("DELETE FROM receipt_folders WHERE receipt_id = ?", (receipt_id,))
    if folder_ids:
        conn.executemany(
            "INSERT OR IGNORE INTO receipt_folders (receipt_id, folder_id) VALUES (?, ?)",
            [(receipt_id, fid) for fid in folder_ids],
        )
    conn.commit()
    conn.close()


def bulk_update_receipts(ids: list, data: dict):
    """Bulk-update allowed fields across multiple receipts."""
    if not ids or not data:
        return
    allowed = {"category", "vendor_name", "card_type", "card_last4", "notes"}
    data = {k: v for k, v in data.items() if k in allowed}
    if not data:
        return
    fields = ", ".join(f"{k} = :{k}" for k in data)
    conn = get_db()
    for rid in ids:
        d = dict(data)
        d["id"] = rid
        conn.execute(f"UPDATE receipts SET {fields} WHERE id = :id", d)
    conn.commit()
    conn.close()


def bulk_tag_folder(folder_id: int, receipt_ids: list[int]):
    """Add a folder tag to multiple receipts at once."""
    conn = get_db()
    conn.executemany(
        "INSERT OR IGNORE INTO receipt_folders (receipt_id, folder_id) VALUES (?, ?)",
        [(rid, folder_id) for rid in receipt_ids],
    )
    conn.commit()
    conn.close()


def get_all_receipt_ids_for_filter(
    search=None, cards=None, vendors=None, category=None,
    date_from=None, date_to=None, folder_id=None,
) -> list[int]:
    """Return all receipt IDs matching filters (no pagination) for bulk tagging."""
    conditions = ["r.status IN ('processed', 'hidden')"]
    params = []
    _apply_filters(conditions, params, search=search, cards=cards, vendors=vendors,
                   category=category, date_from=date_from, date_to=date_to,
                   folder_id=folder_id, missing=None)
    where = " AND ".join(conditions)
    conn = get_db()
    rows = conn.execute(f"SELECT r.id FROM receipts r WHERE {where}", params).fetchall()
    conn.close()
    return [r[0] for r in rows]


def get_vendors() -> list:
    """Return distinct vendor names with receipt counts, most common first."""
    conn = get_db()
    rows = conn.execute(
        """SELECT vendor_name, COUNT(*) AS receipt_count
           FROM receipts
           WHERE status = 'processed' AND vendor_name IS NOT NULL AND vendor_name != ''
           GROUP BY vendor_name
           ORDER BY receipt_count DESC
           LIMIT 300"""
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def merge_card(card_last4: str, card_type: str) -> int:
    """Set every receipt with card_last4 to use card_type. Returns rows updated."""
    conn = get_db()
    cur = conn.execute(
        "UPDATE receipts SET card_type = ? WHERE card_last4 = ?",
        (card_type or None, card_last4),
    )
    conn.commit()
    affected = cur.rowcount
    conn.close()
    return affected
