"""Avito-источник: лёгкий парсер страниц поиска и одиночных карточек.

Стратегия:
- cloudscraper (уже в зависимостях) обходит базовый Cloudflare и UA-фильтры.
- HTML-парсинг через BeautifulSoup + lxml.
- Селекторы Avito регулярно меняются — поэтому идём в порядке: data-marker
  атрибуты (Avito их менее охотно ломает) → itemprop микроразметка → regex по
  заголовку карточки. Если что-то не нашлось, поле остаётся None, и лот всё
  равно сохраняется (главное — id, url, price).

Известные ограничения:
- Avito может вернуть капчу — тогда HTML будет содержать "Доступ ограничен" /
  "captcha". В этом случае возвращаем пустой список + лог-предупреждение.
- Парсим только первую страницу выдачи (~50 карточек). Достаточно для трекера.
"""

from __future__ import annotations

import hashlib
import logging
import random
import re
from datetime import datetime
from typing import Any, Optional

from ..models import Listing, make_listing_id
from .base import FetchResult, Source

logger = logging.getLogger(__name__)

# Несколько UA — небольшая защита от примитивных фильтров. cloudscraper
# умеет своё, но дополнительный realistic UA не повредит.
_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
]


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


def _external_id_from_url(url: str) -> str:
    """Avito URL карточки: /.../tovar_NNNNNNNNN — берём это число."""
    m = re.search(r"_(\d{6,})(?:[/?#]|$)", url)
    if m:
        return m.group(1)
    # fallback на хеш всего url
    return hashlib.md5(url.encode("utf-8")).hexdigest()[:12]


def _parse_title(title: str) -> dict[str, Any]:
    """Из 'X-к. квартира, A м², F/T эт.' / 'студия, A м²' вытащить rooms/area/floor.

    Возвращает словарь с возможными ключами: rooms, area_total, floor, floors_total.
    """
    out: dict[str, Any] = {}
    if not title:
        return out

    t = title.lower()

    # Комнаты
    if "студи" in t:
        out["rooms"] = 0  # 0 = студия
    else:
        m = re.search(r"(\d+)\s*-?\s*к", t)
        if m:
            out["rooms"] = int(m.group(1))

    # Площадь: "36 м²" / "36.5 м2"
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*м[²2]", t)
    if m:
        out["area_total"] = _to_float(m.group(1))

    # Этаж: "5/9 эт"
    m = re.search(r"(\d+)\s*/\s*(\d+)\s*эт", t)
    if m:
        out["floor"] = int(m.group(1))
        out["floors_total"] = int(m.group(2))

    return out


def _is_blocked(html: str) -> bool:
    """Распознать страницу-заглушку (капча, бан)."""
    if not html or len(html) < 1000:
        return True
    markers = ("Доступ ограничен", "captcha", "Подтвердите, что вы не робот")
    return any(m.lower() in html.lower() for m in markers)


def _detect_deal_type(url: str) -> str:
    """sale / rent_long / rent_short — по сегменту в URL."""
    u = url.lower()
    if "/sdam" in u or "/arenda" in u:
        if "posutochno" in u or "sutochnaja" in u:
            return "rent_short"
        return "rent_long"
    return "sale"


def _detect_city(url: str) -> Optional[str]:
    """Avito-URL: https://www.avito.ru/moskva/kvartiry/...  → 'moskva'.

    Возвращаем как-есть (avito-slug). Хранится для информации, для скоринга не
    критично.
    """
    m = re.search(r"avito\.ru/([a-z_-]+)/", url.lower())
    return m.group(1) if m else None


def _extract_card(card_html: Any, base_url: str, deal_type: str, city: Optional[str]) -> Optional[FetchResult]:
    """Из одной BeautifulSoup-карточки вытащить FetchResult.

    Возвращает None если карточка нечитабельна (нет URL / цены).
    """
    from bs4 import BeautifulSoup, Tag

    if not isinstance(card_html, Tag):
        return None

    # URL карточки + external_id
    link_tag = (
        card_html.select_one('a[data-marker="item-title"]')
        or card_html.select_one('a[itemprop="url"]')
        or card_html.select_one("h3 a")
        or card_html.select_one("a[href*='/items/']")
        or card_html.select_one("a[href]")
    )
    if not link_tag or not link_tag.get("href"):
        return None
    href = str(link_tag.get("href"))
    if href.startswith("/"):
        url = "https://www.avito.ru" + href
    else:
        url = href

    external_id = _external_id_from_url(url)

    # Заголовок
    title = (link_tag.get_text(strip=True) or "").strip() or None

    # Цена
    price_tag = (
        card_html.select_one('meta[itemprop="price"]')
        or card_html.select_one('[data-marker="item-price/price"]')
        or card_html.select_one('span[itemprop="price"]')
        or card_html.select_one('[itemprop="price"]')
    )
    price: Optional[int] = None
    if price_tag is not None:
        if price_tag.get("content"):
            price = _to_int(price_tag.get("content"))
        if price is None:
            price = _to_int(price_tag.get_text(" ", strip=True))

    if price is None:
        # Карточка без цены — пропускаем, иначе захламим базу
        return None

    # Адрес
    addr_tag = (
        card_html.select_one('[data-marker="item-address"]')
        or card_html.select_one('span[data-marker*="address"]')
    )
    address = addr_tag.get_text(" ", strip=True) if addr_tag else None

    # Тип продавца — если в карточке есть метка частное лицо / агентство.
    seller_tag = card_html.select_one('[data-marker="seller-info/label"]') or card_html.select_one(
        '[class*="iva-item-userInfo"]'
    )
    seller_type = None
    if seller_tag:
        txt = seller_tag.get_text(" ", strip=True).lower()
        if "частн" in txt:
            seller_type = "owner"
        elif "агент" in txt or "компания" in txt:
            seller_type = "agency"

    # Парсим из заголовка
    parsed = _parse_title(title or "")

    listing = Listing(
        id=make_listing_id("avito", external_id),
        source="avito",
        external_id=external_id,
        url=url,
        title=title,
        address=address,
        city=city,
        rooms=parsed.get("rooms"),
        area_total=parsed.get("area_total"),
        floor=parsed.get("floor"),
        floors_total=parsed.get("floors_total"),
        seller_type=seller_type,
        first_seen=datetime.utcnow(),
        last_seen=datetime.utcnow(),
        custom_data={"raw_title": title or ""},
    )
    return FetchResult(listing=listing, price=price, deal_type=deal_type)


class AvitoSource(Source):
    name = "avito"

    def _build_scraper(self):
        import cloudscraper  # type: ignore

        scraper = cloudscraper.create_scraper(
            browser={
                "browser": "chrome",
                "platform": "windows",
                "desktop": True,
            }
        )
        scraper.headers.update({
            "User-Agent": random.choice(_USER_AGENTS),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
        })
        return scraper

    def fetch_filter(
        self,
        *,
        url: str,
        **_: Any,
    ) -> list[FetchResult]:
        """Прогнать одну страницу поиска Avito → список карточек.

        url — обычная ссылка с avito.ru/<city>/kvartiry/...; пользователь
        копирует её из браузера после настройки фильтров (комнаты, цена, метро,
        «только частные лица» и т.д.).
        """
        if not url or "avito.ru" not in url:
            raise ValueError("AvitoSource.fetch_filter ожидает URL с avito.ru")

        scraper = self._build_scraper()
        try:
            resp = scraper.get(url, timeout=20)
        except Exception as exc:
            raise RuntimeError(f"Avito недоступен: {exc}") from exc

        if resp.status_code != 200:
            raise RuntimeError(f"Avito вернул HTTP {resp.status_code}")

        html = resp.text or ""
        if _is_blocked(html):
            logger.warning("avito: страница похожа на капчу/блокировку, лотов не будет")
            return []

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "lxml")

        deal_type = _detect_deal_type(url)
        city = _detect_city(url)

        cards = soup.select('[data-marker="item"]')
        if not cards:
            # запасной селектор
            cards = soup.select('div[class*="iva-item-root"]')

        results: list[FetchResult] = []
        for card in cards:
            try:
                r = _extract_card(card, base_url=url, deal_type=deal_type, city=city)
            except Exception as exc:
                logger.debug("avito: пропустил карточку: %s", exc)
                continue
            if r:
                results.append(r)

        if not results:
            logger.warning("avito: HTML загрузился (%d байт), но карточки не распознаны — селекторы могли поменяться", len(html))

        return results

    def fetch_single(self, url: str, **_: Any) -> FetchResult:
        """Парсинг одиночной карточки Avito по URL.

        Минимальная реализация: цена + базовые поля из meta-тегов микроразметки.
        Для глубокого парсинга карточки нужна отдельная итерация (этажи, метро,
        год дома — там разбросано по JS-структуре). Пока возвращаем то, что
        видно без JS, как и для других источников fetch_single.
        """
        if "avito.ru" not in url:
            raise ValueError("AvitoSource.fetch_single ожидает URL с avito.ru")

        scraper = self._build_scraper()
        resp = scraper.get(url, timeout=20)
        if resp.status_code != 200:
            raise RuntimeError(f"Avito карточка вернула HTTP {resp.status_code}")

        html = resp.text or ""
        if _is_blocked(html):
            raise RuntimeError("Avito показал капчу. Открой ссылку в браузере и пришли снова.")

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "lxml")

        external_id = _external_id_from_url(url)

        # Цена
        price_tag = (
            soup.select_one('meta[itemprop="price"]')
            or soup.select_one('[itemprop="price"]')
            or soup.select_one('[data-marker="item-view/item-price"]')
        )
        price = None
        if price_tag is not None:
            price = _to_int(price_tag.get("content")) or _to_int(price_tag.get_text(" ", strip=True))

        if price is None:
            raise RuntimeError("Avito карточка: цену не нашёл — возможно изменилась вёрстка")

        # Заголовок
        title_tag = soup.select_one('h1[data-marker="item-view/title-info"]') or soup.select_one("h1")
        title = title_tag.get_text(" ", strip=True) if title_tag else None

        # Адрес
        addr_tag = soup.select_one('[itemprop="address"]') or soup.select_one('[data-marker="item-view/item-address"]')
        address = addr_tag.get_text(" ", strip=True) if addr_tag else None

        parsed = _parse_title(title or "")
        deal_type = _detect_deal_type(url)
        city = _detect_city(url)

        listing = Listing(
            id=make_listing_id("avito", external_id),
            source="avito",
            external_id=external_id,
            url=url,
            title=title,
            address=address,
            city=city,
            rooms=parsed.get("rooms"),
            area_total=parsed.get("area_total"),
            floor=parsed.get("floor"),
            floors_total=parsed.get("floors_total"),
            first_seen=datetime.utcnow(),
            last_seen=datetime.utcnow(),
            custom_data={"raw_title": title or ""},
        )
        return FetchResult(listing=listing, price=price, deal_type=deal_type)
