"""Ручной ввод данных через интерактивный CLI или dict.

Используется как fallback когда автоматический парсер не справился (типичный
сценарий для Yandex Realty с капчей).
"""

from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import urlparse

from ..models import Listing, make_listing_id
from .base import FetchResult, Source


def _prompt(label: str, *, required: bool = False, cast: type | None = None, default: Any = None) -> Any:
    while True:
        suffix = ""
        if default not in (None, ""):
            suffix = f" [{default}]"
        elif not required:
            suffix = " [пропустить]"
        raw = input(f"  {label}{suffix}: ").strip()
        if not raw:
            if default not in (None, ""):
                return default
            if required:
                print("    обязательное поле, повторите")
                continue
            return None
        if cast is None:
            return raw
        try:
            if cast is bool:
                return raw.lower() in ("y", "yes", "1", "true", "да")
            return cast(raw)
        except ValueError:
            print(f"    не удалось распарсить как {cast.__name__}, повторите")


class ManualSource(Source):
    name = "manual"

    def fetch_single(
        self,
        url: str,
        *,
        prefill: Optional[dict[str, Any]] = None,
        source_hint: Optional[str] = None,
    ) -> FetchResult:
        prefill = prefill or {}
        source = source_hint or _guess_source(url)
        external_id = prefill.get("external_id") or _extract_external_id(url) or ""
        if not external_id:
            external_id = _prompt("ID объявления (любой уникальный)", required=True)

        listing_id = make_listing_id(source, external_id)

        print(f"\nЗаполнение карточки {listing_id}")
        print("(Enter — пропустить поле)\n")

        def get(field: str, label: str, **kwargs) -> Any:
            if field in prefill and prefill[field] not in (None, ""):
                return prefill[field]
            return _prompt(label, **kwargs)

        price = get("price", "Цена (₽)", required=True, cast=int)
        deal_type = get("deal_type", "Тип сделки (sale/rent_long)", default="sale")

        listing = Listing(
            id=listing_id,
            source=source,
            external_id=external_id,
            url=url,
            title=get("title", "Заголовок"),
            address=get("address", "Адрес"),
            city=get("city", "Город"),
            district=get("district", "Район"),
            rooms=get("rooms", "Комнат", cast=int),
            area_total=get("area_total", "Общая площадь (м²)", cast=float),
            area_living=get("area_living", "Жилая площадь (м²)", cast=float),
            area_kitchen=get("area_kitchen", "Кухня (м²)", cast=float),
            floor=get("floor", "Этаж", cast=int),
            floors_total=get("floors_total", "Всего этажей", cast=int),
            year_built=get("year_built", "Год постройки", cast=int),
            building_type=get("building_type", "Тип дома (panel/brick/monolith)"),
            renovation=get("renovation", "Ремонт (designer/euro/cosmetic/none)"),
            metro_distance_min=get("metro_distance_min", "До метро, минут пешком", cast=int),
            metro_name=get("metro_name", "Метро"),
            seller_type=get("seller_type", "Продавец (owner/agent/agency)"),
            photos_count=get("photos_count", "Кол-во фото", cast=int),
            notes=get("notes", "Заметки"),
        )

        return FetchResult(listing=listing, price=price, deal_type=deal_type or "sale")


def _guess_source(url: str) -> str:
    host = urlparse(url).hostname or ""
    if "cian" in host:
        return "cian"
    if "yandex" in host:
        return "yandex"
    if "avito" in host:
        return "avito"
    return "manual"


def _extract_external_id(url: str) -> Optional[str]:
    """Извлечь ID из URL популярных источников. Для незнакомых — None."""
    parsed = urlparse(url)
    path = parsed.path

    # cian: /sale/flat/12345678/
    m = re.search(r"/(flat|rent|sale)/(?:flat/)?(\d{6,})/?", path)
    if m:
        return m.group(2)

    # yandex: /offer/1234567890/
    m = re.search(r"/offer/(\d+)/?", path)
    if m:
        return m.group(1)

    # avito: /…_id_1234567890
    m = re.search(r"_(\d{6,})/?$", path)
    if m:
        return m.group(1)

    return None
