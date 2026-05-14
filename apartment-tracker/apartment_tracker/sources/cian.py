"""CIAN-источник через библиотеку cianparser."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Optional

from ..models import Listing, make_listing_id
from .base import FetchResult, Source


def _to_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    s = str(value)
    digits = re.sub(r"[^\d]", "", s)
    return int(digits) if digits else None


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).replace(",", ".")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None


def _map_cian_row(row: dict[str, Any], deal_type: str) -> tuple[Listing, Optional[int]]:
    """Превратить словарь от cianparser в Listing+price.

    Точные имена полей в cianparser могут отличаться между версиями — берём
    несколько вариантов и игнорируем отсутствующие.
    """
    external_id = str(row.get("id") or row.get("cian_id") or row.get("ID") or "").strip()
    url = row.get("link") or row.get("url") or ""
    if not external_id and url:
        m = re.search(r"/(\d{6,})/?(?:$|\?)", url)
        if m:
            external_id = m.group(1)
    if not external_id:
        # как fallback хешируем URL
        import hashlib
        external_id = hashlib.md5(url.encode("utf-8")).hexdigest()[:12]

    listing_id = make_listing_id("cian", external_id)

    price = _to_int(row.get("price") or row.get("price_per_month"))

    listing = Listing(
        id=listing_id,
        source="cian",
        external_id=external_id,
        url=url,
        title=row.get("title"),
        address=row.get("street") or row.get("address"),
        city=row.get("city") or row.get("location"),
        district=row.get("district"),
        rooms=_to_int(row.get("rooms_count")),
        area_total=_to_float(row.get("total_meters") or row.get("area_total")),
        area_living=_to_float(row.get("living_meters")),
        area_kitchen=_to_float(row.get("kitchen_meters")),
        floor=_to_int(row.get("floor")),
        floors_total=_to_int(row.get("floors_count")),
        year_built=_to_int(row.get("year_of_construction") or row.get("year")),
        building_type=row.get("house_material_type"),
        metro_name=row.get("metro") or row.get("underground"),
        metro_distance_min=_to_int(row.get("minutes_to_metro")),
        seller_type=row.get("author_type") or row.get("seller_type"),
        description=row.get("description"),
        first_seen=datetime.utcnow(),
        last_seen=datetime.utcnow(),
        custom_data={k: v for k, v in row.items() if k not in {"id", "link", "url"}},
    )

    return listing, price


class CianSource(Source):
    name = "cian"

    def fetch_filter(
        self,
        *,
        location: str = "Москва",
        deal_type: str = "sale",
        rooms: Any = "all",
        additional_settings: Optional[dict[str, Any]] = None,
        **_: Any,
    ) -> list[FetchResult]:
        try:
            import cianparser  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "Не установлен пакет cianparser. Запусти: pip install -e ."
            ) from exc

        parser = cianparser.CianParser(location=location)
        kwargs: dict[str, Any] = {"deal_type": deal_type, "rooms": rooms}
        if additional_settings:
            kwargs["additional_settings"] = additional_settings

        rows = parser.get_flats(**kwargs)

        results: list[FetchResult] = []
        for row in rows or []:
            listing, price = _map_cian_row(row, deal_type)
            if price is None:
                continue
            results.append(FetchResult(listing=listing, price=price, deal_type=deal_type))
        return results
