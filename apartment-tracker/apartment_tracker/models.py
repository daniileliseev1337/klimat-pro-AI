"""Dataclasses для основных сущностей."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Any, Optional


@dataclass
class Listing:
    id: str
    source: str
    url: str
    external_id: Optional[str] = None
    title: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    district: Optional[str] = None
    rooms: Optional[int] = None
    area_total: Optional[float] = None
    area_living: Optional[float] = None
    area_kitchen: Optional[float] = None
    floor: Optional[int] = None
    floors_total: Optional[int] = None
    year_built: Optional[int] = None
    building_type: Optional[str] = None
    renovation: Optional[str] = None
    metro_distance_min: Optional[int] = None
    metro_name: Optional[str] = None
    description: Optional[str] = None
    seller_type: Optional[str] = None
    photos_count: Optional[int] = None
    first_seen: datetime = field(default_factory=datetime.utcnow)
    last_seen: datetime = field(default_factory=datetime.utcnow)
    status: str = "active"
    notes: Optional[str] = None
    custom_data: dict[str, Any] = field(default_factory=dict)

    def to_db_row(self) -> dict[str, Any]:
        row = asdict(self)
        row["first_seen"] = self.first_seen.isoformat()
        row["last_seen"] = self.last_seen.isoformat()
        import json
        row["custom_data"] = json.dumps(self.custom_data, ensure_ascii=False)
        return row


@dataclass
class PricePoint:
    listing_id: str
    price: int
    currency: str = "RUB"
    deal_type: str = "sale"
    seen_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class Score:
    listing_id: str
    score: float
    breakdown: dict[str, float]
    calculated_at: datetime = field(default_factory=datetime.utcnow)
    config_version: Optional[str] = None


@dataclass
class FilterSpec:
    name: str
    source: str
    enabled: bool = True
    location: Optional[str] = None
    deal_type: Optional[str] = None
    rooms: Optional[Any] = None
    url: Optional[str] = None
    additional_settings: dict[str, Any] = field(default_factory=dict)
    last_run: Optional[datetime] = None


def make_listing_id(source: str, external_id: str) -> str:
    """Канонический ID лота: 'source:external_id'."""
    return f"{source}:{external_id}"
