"""Базовый интерфейс источника."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ..models import Listing


@dataclass
class FetchResult:
    listing: Listing
    price: Optional[int]
    deal_type: str


class Source:
    """Базовый интерфейс источника объявлений."""

    name: str = "base"

    def fetch_filter(self, **kwargs) -> list[FetchResult]:
        """Получить список карточек по фильтру/поиску."""
        raise NotImplementedError

    def fetch_single(self, url: str, **kwargs) -> FetchResult:
        """Получить одну карточку по URL."""
        raise NotImplementedError
