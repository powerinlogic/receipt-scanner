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


def list_receipts(
    search=None,
    card_last4=None,
    category=None,
    date_from=None,
    date_to=None,
    sort_by="date",
    sort_dir="desc",
    page=1,
    per_page=50,
):
    allowed_sorts = {"date", "vendor_name", "total_amount", "card_last4", "created_at"}
    if sort_by not in allowed_sorts:
        sort_by = "date"
    sort_dir = "ASC" if sort_dir.lower() == "asc" else "DESC"

    conditions = ["status = 'processed'"]
    params = []

    if search:
        conditions.append(
            "(vendor_name LIKE ? OR raw_ocr_text LIKE ?)"
        )
        params += [f"%{search}%", f"%{search}%"]
    if card_last4:
        conditions.append("card_last4 = ?")
        params.append(card_last4)
    if category:
        conditions.append("category = ?")
        params.append(category)
    if date_from:
        conditions.append("date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("date <= ?")
        params.append(date_to)

    where = " AND ".join(conditions)
    offset = (page - 1) * per_page

    conn = get_db()
    total = conn.execute(
        f"SELECT COUNT(*) FROM receipts WHERE {where}", params
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
    conn.close()
    return dict(row) | {"pending": pending}


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
