"""Yandex Realty: best-effort парсер + извлечение из сохранённого HTML.

Прямой парсинг почти не работает (капча, JS), поэтому основной путь —
сохранить страницу в браузере (Ctrl+S) и передать HTML-файл через CLI.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from ..models import Listing, make_listing_id
from .base import FetchResult, Source


_USER_AGENTS = [
    # Несколько свежих UA — слабая защита от блокировок, но лучше чем дефолт.
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
]


def _extract_external_id(url: str) -> Optional[str]:
    m = re.search(r"/offer/(\d+)/?", url)
    return m.group(1) if m else None


def _to_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    digits = re.sub(r"[^\d]", "", str(value))
    return int(digits) if digits else None


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).replace(",", ".").replace("\xa0", " ")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None


def _parse_from_html(html: str, url: str) -> tuple[Listing, Optional[int], str]:
    """Извлечь поля из HTML страницы Yandex Realty.

    Реализация — наивная: ищет специфичные классы и data-атрибуты, плюс
    JSON-LD блок если есть. Имена классов на realty.yandex.ru меняются,
    поэтому это best-effort. Если что-то не нашлось — поле остаётся None и
    пользователь дозаполнит вручную.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")

    external_id = _extract_external_id(url) or ""
    title = None
    price = None
    deal_type = "sale"
    address = None
    rooms = None
    area_total = None
    floor = None
    floors_total = None
    year_built = None
    metro_name = None
    metro_distance_min = None

    # 1) JSON-LD блоки
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "{}")
        except (ValueError, TypeError):
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            if item.get("@type") in ("Apartment", "House", "Product", "Offer"):
                title = title or item.get("name")
                offers = item.get("offers") or {}
                if isinstance(offers, dict):
                    price = price or _to_int(offers.get("price"))
                address_obj = item.get("address") or {}
                if isinstance(address_obj, dict):
                    parts = [
                        address_obj.get("streetAddress"),
                        address_obj.get("addressLocality"),
                    ]
                    address = address or ", ".join(p for p in parts if p)
                area = item.get("floorSize") or {}
                if isinstance(area, dict):
                    area_total = area_total or _to_float(area.get("value"))

    # 2) Цена: поиск в meta или явных селекторах
    if price is None:
        meta_price = soup.find("meta", attrs={"itemprop": "price"})
        if meta_price and meta_price.get("content"):
            price = _to_int(meta_price["content"])
    if price is None:
        node = soup.find(attrs={"data-test": re.compile("price", re.I)})
        if node:
            price = _to_int(node.get_text(" ", strip=True))

    if price is None:
        # совсем грубо — ищем «12 345 678 ₽» в начале страницы
        body_text = soup.get_text(" ", strip=True)[:5000]
        m = re.search(r"(\d[\d\s\xa0]{5,})\s*₽", body_text)
        if m:
            price = _to_int(m.group(1))

    # 3) Заголовок
    if title is None:
        h1 = soup.find("h1")
        if h1:
            title = h1.get_text(" ", strip=True)

    # 4) Этаж и комнаты из заголовка типа «3-комн. кв., 78 м², 5/9 эт.»
    headline = title or ""
    m = re.search(r"(\d+)[-\s]*комн", headline, re.I)
    if m:
        rooms = int(m.group(1))
    if "студ" in headline.lower():
        rooms = 0
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*м[²2]", headline)
    if m and area_total is None:
        area_total = _to_float(m.group(1))
    m = re.search(r"(\d+)\s*/\s*(\d+)\s*эт", headline)
    if m:
        floor = int(m.group(1))
        floors_total = int(m.group(2))

    # 5) Метро (текст «5 мин пешком до …»)
    text = soup.get_text(" ", strip=True)
    m = re.search(r"(\d+)\s*мин(?:ут)?\s*(?:пешком)?\s*до\s+([А-Яа-яёЁ0-9\- ]{2,40})", text)
    if m:
        metro_distance_min = int(m.group(1))
        metro_name = m.group(2).strip()

    # 6) Год постройки
    m = re.search(r"Год\s+постройки[:\s]+(\d{4})", text, re.I)
    if m:
        year_built = int(m.group(1))

    # Если не нашли external_id — fallback по url-хешу
    if not external_id:
        import hashlib
        external_id = hashlib.md5(url.encode("utf-8")).hexdigest()[:12]

    listing = Listing(
        id=make_listing_id("yandex", external_id),
        source="yandex",
        external_id=external_id,
        url=url,
        title=title,
        address=address,
        rooms=rooms,
        area_total=area_total,
        floor=floor,
        floors_total=floors_total,
        year_built=year_built,
        metro_name=metro_name,
        metro_distance_min=metro_distance_min,
        first_seen=datetime.utcnow(),
        last_seen=datetime.utcnow(),
    )
    return listing, price, deal_type


class YandexSource(Source):
    name = "yandex"

    def fetch_single(
        self,
        url: str,
        *,
        html_file: Optional[str | Path] = None,
        **_: Any,
    ) -> FetchResult:
        if html_file:
            html = Path(html_file).read_text(encoding="utf-8", errors="ignore")
        else:
            html = self._download(url)
        listing, price, deal_type = _parse_from_html(html, url)
        return FetchResult(listing=listing, price=price, deal_type=deal_type)

    def _download(self, url: str) -> str:
        """Попытаться скачать страницу через cloudscraper.

        Высокая вероятность капчи. При ошибке поднимает исключение —
        вызывающий код переключится на ручной ввод.
        """
        try:
            import cloudscraper  # type: ignore
        except ImportError as exc:
            raise RuntimeError("Не установлен cloudscraper") from exc

        scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "desktop": True}
        )
        scraper.headers.update({"User-Agent": _USER_AGENTS[0], "Accept-Language": "ru,en;q=0.9"})
        resp = scraper.get(url, timeout=20)
        if resp.status_code != 200:
            raise RuntimeError(
                f"Yandex вернул {resp.status_code}. Сохраните страницу в браузере "
                f"(Ctrl+S) и передайте файл через --html-file."
            )
        if "captcha" in resp.text.lower() or "showcaptcha" in resp.text.lower():
            raise RuntimeError(
                "Yandex показал капчу. Сохраните страницу вручную "
                "(Ctrl+S → HTML) и используйте --html-file."
            )
        return resp.text
