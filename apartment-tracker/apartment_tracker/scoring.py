"""Конфигурируемый скоринг 0-100."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from .models import Listing, Score


@dataclass
class ScoringConfig:
    version: str
    weights: dict[str, float]
    thresholds: dict[str, dict[str, Any]]
    renovation_scores: dict[str, float]
    seller_scores: dict[str, float]
    missing_policy: str = "neutral"

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ScoringConfig":
        return cls(
            version=str(d.get("version", "1.0")),
            weights=dict(d.get("weights", {})),
            thresholds=dict(d.get("thresholds", {})),
            renovation_scores=dict(d.get("renovation_scores", {})),
            seller_scores=dict(d.get("seller_scores", {})),
            missing_policy=d.get("missing_policy", "neutral"),
        )


def _linear_normalize(value: float, best: float, worst: float) -> float:
    """Линейная нормализация: best→1.0, worst→0.0. Поддерживает best<worst (ниже=лучше) и best>worst (выше=лучше)."""
    if best == worst:
        return 1.0 if value == best else 0.0
    raw = (value - worst) / (best - worst)
    return max(0.0, min(1.0, raw))


def _score_price_per_m2(listing: Listing, price: Optional[int], thresholds: dict[str, Any]) -> Optional[float]:
    if price is None or not listing.area_total:
        return None
    ppm = price / listing.area_total
    return _linear_normalize(ppm, thresholds["best"], thresholds["worst"])


def _score_metro_distance(listing: Listing, thresholds: dict[str, Any]) -> Optional[float]:
    if listing.metro_distance_min is None:
        return None
    return _linear_normalize(listing.metro_distance_min, thresholds["best"], thresholds["worst"])


def _score_floor(listing: Listing, thresholds: dict[str, Any]) -> Optional[float]:
    if listing.floor is None or listing.floors_total is None or listing.floors_total < 1:
        return None
    if listing.floor == 1:
        return float(thresholds.get("penalty_first", 0.2))
    if listing.floor == listing.floors_total:
        return float(thresholds.get("penalty_last", 0.2))
    if listing.floor == 2 or listing.floor == listing.floors_total - 1:
        return float(thresholds.get("penalty_second_or_prelast", 0.7))
    return 1.0


def _score_area_total(listing: Listing, thresholds: dict[str, Any]) -> Optional[float]:
    if listing.area_total is None:
        return None
    lo = thresholds["ideal_min"]
    hi = thresholds["ideal_max"]
    tol = thresholds.get("tolerance", 20)
    a = listing.area_total
    if lo <= a <= hi:
        return 1.0
    if a < lo:
        return max(0.0, 1.0 - (lo - a) / tol)
    return max(0.0, 1.0 - (a - hi) / tol)


def _score_year_built(listing: Listing, thresholds: dict[str, Any]) -> Optional[float]:
    if listing.year_built is None:
        return None
    return _linear_normalize(listing.year_built, thresholds["best"], thresholds["worst"])


def _score_rooms(listing: Listing, thresholds: dict[str, Any]) -> Optional[float]:
    if listing.rooms is None:
        return None
    target = thresholds["target"]
    tol = thresholds.get("tolerance", 1)
    diff = abs(listing.rooms - target)
    if diff == 0:
        return 1.0
    if diff <= tol:
        return 0.5
    return 0.0


def _score_photos(listing: Listing, thresholds: dict[str, Any]) -> Optional[float]:
    if listing.photos_count is None:
        return None
    return _linear_normalize(listing.photos_count, thresholds["best"], thresholds["worst"])


def _score_renovation(listing: Listing, scores_map: dict[str, float]) -> Optional[float]:
    if not listing.renovation:
        return None
    key = listing.renovation.lower().strip()
    return scores_map.get(key, scores_map.get("unknown", 0.4))


def _score_seller(listing: Listing, scores_map: dict[str, float]) -> Optional[float]:
    if not listing.seller_type:
        return None
    key = listing.seller_type.lower().strip()
    return scores_map.get(key, scores_map.get("unknown", 0.5))


_CRITERION_FUNCS = {
    "price_per_m2": lambda l, p, cfg: _score_price_per_m2(l, p, cfg.thresholds.get("price_per_m2", {})),
    "metro_distance": lambda l, p, cfg: _score_metro_distance(l, cfg.thresholds.get("metro_distance", {})),
    "floor": lambda l, p, cfg: _score_floor(l, cfg.thresholds.get("floor", {})),
    "area_total": lambda l, p, cfg: _score_area_total(l, cfg.thresholds.get("area_total", {})),
    "renovation": lambda l, p, cfg: _score_renovation(l, cfg.renovation_scores),
    "year_built": lambda l, p, cfg: _score_year_built(l, cfg.thresholds.get("year_built", {})),
    "rooms": lambda l, p, cfg: _score_rooms(l, cfg.thresholds.get("rooms", {})),
    "seller_type": lambda l, p, cfg: _score_seller(l, cfg.seller_scores),
    "photos_count": lambda l, p, cfg: _score_photos(l, cfg.thresholds.get("photos_count", {})),
}


def compute_score(listing: Listing, price: Optional[int], config: ScoringConfig) -> Score:
    """Вычисляет скоринг 0-100 для лота при текущей цене.

    Считаются только критерии, явно указанные в config.weights. Для них
    подгружаются соответствующие пороги. Незнакомые критерии в weights
    игнорируются (с предупреждением через None).
    """
    policy = config.missing_policy
    weights = config.weights
    breakdown: dict[str, float] = {}
    total_weight = 0.0
    weighted_sum = 0.0

    for crit, weight in weights.items():
        if weight == 0:
            continue
        func = _CRITERION_FUNCS.get(crit)
        if func is None:
            continue
        try:
            norm: Optional[float] = func(listing, price, config)
        except KeyError:
            # отсутствуют пороги — трактуем как missing
            norm = None
        if norm is None:
            if policy == "skip":
                continue
            if policy == "worst":
                norm = 0.0
            else:  # neutral
                norm = 0.5
        contribution = weight * norm
        breakdown[crit] = round(contribution, 2)
        weighted_sum += contribution
        total_weight += weight

    if total_weight == 0:
        final = 0.0
    else:
        final = weighted_sum / total_weight * 100

    return Score(
        listing_id=listing.id,
        score=round(final, 2),
        breakdown=breakdown,
        config_version=config.version,
    )
