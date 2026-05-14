"""Ядро: дедупликация, обнаружение изменений цены и статуса."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from .db import Database
from .models import Listing, PricePoint
from .sources.base import FetchResult


@dataclass
class IngestEvent:
    listing: Listing
    kind: str  # 'new', 'price_drop', 'price_increase', 'reappeared', 'unchanged'
    price: int
    previous_price: Optional[int] = None


class Tracker:
    def __init__(self, db: Database):
        self.db = db

    def ingest(self, result: FetchResult) -> IngestEvent:
        """Добавить наблюдение и определить тип события."""
        existing = self.db.get_listing(result.listing.id)
        is_new = existing is None
        reappeared = bool(existing and existing.status != "active")

        if existing:
            # Сохраняем дату первого появления, обновляем last_seen
            result.listing.first_seen = existing.first_seen
        result.listing.last_seen = datetime.utcnow()
        if reappeared:
            result.listing.status = "active"

        self.db.upsert_listing(result.listing)

        prev_price_point = self.db.latest_price(result.listing.id)
        previous_price = prev_price_point.price if prev_price_point else None

        diff = self.db.add_price(
            PricePoint(
                listing_id=result.listing.id,
                price=result.price,
                deal_type=result.deal_type,
            )
        )

        if is_new:
            kind = "new"
        elif reappeared:
            kind = "reappeared"
        elif diff is None:
            kind = "unchanged"
        elif diff < 0:
            kind = "price_drop"
        else:
            kind = "price_increase"

        return IngestEvent(
            listing=result.listing,
            kind=kind,
            price=result.price,
            previous_price=previous_price,
        )

    def finalize_run(self, source: str, seen_ids: list[str]) -> list[str]:
        """После прогона по источнику — пометить пропавшие лоты как removed."""
        return self.db.mark_unseen_as_removed(source, seen_ids)
