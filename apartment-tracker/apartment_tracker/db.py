"""SQLite-схема и CRUD."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterable, Iterator, Optional

from .models import FilterSpec, Listing, PricePoint, Score


SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    external_id TEXT,
    url TEXT NOT NULL,
    title TEXT,
    address TEXT,
    city TEXT,
    district TEXT,
    rooms INTEGER,
    area_total REAL,
    area_living REAL,
    area_kitchen REAL,
    floor INTEGER,
    floors_total INTEGER,
    year_built INTEGER,
    building_type TEXT,
    renovation TEXT,
    metro_distance_min INTEGER,
    metro_name TEXT,
    description TEXT,
    seller_type TEXT,
    photos_count INTEGER,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    custom_data TEXT
);

CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_last_seen ON listings(last_seen);

CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL,
    price INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RUB',
    deal_type TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_price_history_listing ON price_history(listing_id);
CREATE INDEX IF NOT EXISTS idx_price_history_seen_at ON price_history(seen_at);

CREATE TABLE IF NOT EXISTS scores (
    listing_id TEXT PRIMARY KEY,
    score REAL NOT NULL,
    breakdown TEXT,
    calculated_at TEXT NOT NULL,
    config_version TEXT,
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS filters (
    name TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    location TEXT,
    deal_type TEXT,
    rooms TEXT,
    url TEXT,
    additional_settings TEXT,
    last_run TEXT
);

CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_log_listing ON notification_log(listing_id);
"""


class Database:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA)
            conn.commit()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
        finally:
            conn.close()

    # ----- listings -----

    def upsert_listing(self, listing: Listing) -> bool:
        """Возвращает True если лот новый, False если обновлён существующий."""
        with self.connect() as conn:
            cur = conn.execute("SELECT id FROM listings WHERE id = ?", (listing.id,))
            existed = cur.fetchone() is not None
            row = listing.to_db_row()
            cols = list(row.keys())
            placeholders = ",".join(["?"] * len(cols))
            assignments = ",".join(f"{c}=excluded.{c}" for c in cols if c != "id" and c != "first_seen")
            sql = (
                f"INSERT INTO listings ({','.join(cols)}) VALUES ({placeholders}) "
                f"ON CONFLICT(id) DO UPDATE SET {assignments}"
            )
            conn.execute(sql, [row[c] for c in cols])
            conn.commit()
        return not existed

    def get_listing(self, listing_id: str) -> Optional[Listing]:
        with self.connect() as conn:
            cur = conn.execute("SELECT * FROM listings WHERE id = ?", (listing_id,))
            row = cur.fetchone()
        return _row_to_listing(row) if row else None

    def all_listings(self, status: Optional[str] = None) -> list[Listing]:
        sql = "SELECT * FROM listings"
        params: tuple = ()
        if status:
            sql += " WHERE status = ?"
            params = (status,)
        with self.connect() as conn:
            cur = conn.execute(sql, params)
            rows = cur.fetchall()
        return [_row_to_listing(r) for r in rows]

    def set_status(self, listing_id: str, status: str) -> None:
        with self.connect() as conn:
            conn.execute("UPDATE listings SET status = ? WHERE id = ?", (status, listing_id))
            conn.commit()

    def mark_unseen_as_removed(self, source: str, seen_ids: Iterable[str]) -> list[str]:
        """Лоты данного источника, которых не было в seen_ids, помечаем 'removed'.
        Возвращает список ID, которые только что переведены в removed."""
        seen_set = set(seen_ids)
        with self.connect() as conn:
            cur = conn.execute(
                "SELECT id FROM listings WHERE source = ? AND status = 'active'",
                (source,),
            )
            active_ids = [r["id"] for r in cur.fetchall()]
            removed = [i for i in active_ids if i not in seen_set]
            if removed:
                conn.executemany(
                    "UPDATE listings SET status = 'removed' WHERE id = ?",
                    [(i,) for i in removed],
                )
                conn.commit()
        return removed

    # ----- price_history -----

    def add_price(self, point: PricePoint) -> Optional[int]:
        """Добавляет точку цены, если она отличается от последней. Возвращает разницу со старой ценой (None если первая)."""
        with self.connect() as conn:
            cur = conn.execute(
                "SELECT price FROM price_history WHERE listing_id = ? "
                "ORDER BY seen_at DESC LIMIT 1",
                (point.listing_id,),
            )
            prev = cur.fetchone()
            if prev and prev["price"] == point.price:
                return None
            conn.execute(
                "INSERT INTO price_history (listing_id, price, currency, deal_type, seen_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (point.listing_id, point.price, point.currency, point.deal_type, point.seen_at.isoformat()),
            )
            conn.commit()
            return point.price - prev["price"] if prev else None

    def price_history(self, listing_id: str) -> list[PricePoint]:
        with self.connect() as conn:
            cur = conn.execute(
                "SELECT * FROM price_history WHERE listing_id = ? ORDER BY seen_at ASC",
                (listing_id,),
            )
            rows = cur.fetchall()
        return [
            PricePoint(
                listing_id=r["listing_id"],
                price=r["price"],
                currency=r["currency"],
                deal_type=r["deal_type"],
                seen_at=datetime.fromisoformat(r["seen_at"]),
            )
            for r in rows
        ]

    def latest_price(self, listing_id: str) -> Optional[PricePoint]:
        hist = self.price_history(listing_id)
        return hist[-1] if hist else None

    # ----- scores -----

    def save_score(self, score: Score) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO scores (listing_id, score, breakdown, calculated_at, config_version) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(listing_id) DO UPDATE SET "
                "score=excluded.score, breakdown=excluded.breakdown, "
                "calculated_at=excluded.calculated_at, config_version=excluded.config_version",
                (
                    score.listing_id,
                    score.score,
                    json.dumps(score.breakdown, ensure_ascii=False),
                    score.calculated_at.isoformat(),
                    score.config_version,
                ),
            )
            conn.commit()

    def all_scores(self) -> list[Score]:
        with self.connect() as conn:
            cur = conn.execute("SELECT * FROM scores")
            rows = cur.fetchall()
        return [
            Score(
                listing_id=r["listing_id"],
                score=r["score"],
                breakdown=json.loads(r["breakdown"]) if r["breakdown"] else {},
                calculated_at=datetime.fromisoformat(r["calculated_at"]),
                config_version=r["config_version"],
            )
            for r in rows
        ]

    # ----- filters -----

    def upsert_filter(self, spec: FilterSpec) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO filters (name, source, enabled, location, deal_type, rooms, url, additional_settings, last_run) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(name) DO UPDATE SET "
                "source=excluded.source, enabled=excluded.enabled, location=excluded.location, "
                "deal_type=excluded.deal_type, rooms=excluded.rooms, url=excluded.url, "
                "additional_settings=excluded.additional_settings",
                (
                    spec.name,
                    spec.source,
                    1 if spec.enabled else 0,
                    spec.location,
                    spec.deal_type,
                    None if spec.rooms is None else json.dumps(spec.rooms),
                    spec.url,
                    json.dumps(spec.additional_settings, ensure_ascii=False),
                    spec.last_run.isoformat() if spec.last_run else None,
                ),
            )
            conn.commit()

    def list_filters(self, enabled_only: bool = False) -> list[FilterSpec]:
        sql = "SELECT * FROM filters"
        if enabled_only:
            sql += " WHERE enabled = 1"
        with self.connect() as conn:
            cur = conn.execute(sql)
            rows = cur.fetchall()
        out = []
        for r in rows:
            out.append(
                FilterSpec(
                    name=r["name"],
                    source=r["source"],
                    enabled=bool(r["enabled"]),
                    location=r["location"],
                    deal_type=r["deal_type"],
                    rooms=json.loads(r["rooms"]) if r["rooms"] else None,
                    url=r["url"],
                    additional_settings=json.loads(r["additional_settings"]) if r["additional_settings"] else {},
                    last_run=datetime.fromisoformat(r["last_run"]) if r["last_run"] else None,
                )
            )
        return out

    def mark_filter_run(self, name: str) -> None:
        with self.connect() as conn:
            conn.execute("UPDATE filters SET last_run = ? WHERE name = ?", (datetime.utcnow().isoformat(), name))
            conn.commit()

    # ----- notification_log -----

    def log_notification(self, listing_id: str, kind: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO notification_log (listing_id, kind, sent_at) VALUES (?, ?, ?)",
                (listing_id, kind, datetime.utcnow().isoformat()),
            )
            conn.commit()

    def last_notification(self, listing_id: str, kind: str) -> Optional[datetime]:
        with self.connect() as conn:
            cur = conn.execute(
                "SELECT sent_at FROM notification_log WHERE listing_id = ? AND kind = ? "
                "ORDER BY sent_at DESC LIMIT 1",
                (listing_id, kind),
            )
            row = cur.fetchone()
        return datetime.fromisoformat(row["sent_at"]) if row else None


def _row_to_listing(row: sqlite3.Row) -> Listing:
    data = dict(row)
    custom_raw = data.pop("custom_data", None)
    data["custom_data"] = json.loads(custom_raw) if custom_raw else {}
    data["first_seen"] = datetime.fromisoformat(data["first_seen"])
    data["last_seen"] = datetime.fromisoformat(data["last_seen"])
    return Listing(**data)
