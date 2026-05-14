"""Юнит-тесты на скоринг — самое критичное для корректности."""

from __future__ import annotations

import pytest

from apartment_tracker.models import Listing
from apartment_tracker.scoring import ScoringConfig, compute_score


@pytest.fixture
def config() -> ScoringConfig:
    return ScoringConfig.from_dict(
        {
            "version": "test",
            "weights": {
                "price_per_m2": 25,
                "metro_distance": 15,
                "floor": 10,
                "area_total": 10,
                "renovation": 10,
                "year_built": 10,
                "rooms": 10,
                "seller_type": 5,
                "photos_count": 5,
            },
            "thresholds": {
                "price_per_m2": {"best": 200000, "worst": 500000},
                "metro_distance": {"best": 5, "worst": 30},
                "floor": {
                    "penalty_first": 0.2,
                    "penalty_last": 0.2,
                    "penalty_second_or_prelast": 0.7,
                },
                "area_total": {"ideal_min": 40, "ideal_max": 80, "tolerance": 20},
                "year_built": {"best": 2020, "worst": 1960},
                "rooms": {"target": 2, "tolerance": 1},
                "photos_count": {"best": 20, "worst": 0},
            },
            "renovation_scores": {
                "designer": 1.0, "euro": 0.8, "cosmetic": 0.5, "none": 0.2, "unknown": 0.4,
            },
            "seller_scores": {"owner": 1.0, "agent": 0.5, "agency": 0.3, "unknown": 0.5},
            "missing_policy": "neutral",
        }
    )


def _make_listing(**kwargs) -> Listing:
    base: dict = {
        "id": "test:1",
        "source": "test",
        "url": "https://example.com",
        "rooms": 2,
        "area_total": 60.0,
        "floor": 5,
        "floors_total": 9,
        "year_built": 2020,
        "renovation": "euro",
        "metro_distance_min": 10,
        "seller_type": "owner",
        "photos_count": 15,
    }
    base.update(kwargs)
    return Listing(**base)


def test_score_ideal_listing(config):
    """Лот в идеальных пределах → скоринг около 80-100."""
    listing = _make_listing(area_total=60, year_built=2022, metro_distance_min=5, renovation="designer", photos_count=20)
    score = compute_score(listing, price=12_000_000, config=config)
    assert score.score > 80
    assert score.config_version == "test"


def test_score_terrible_listing(config):
    """Лот плохой по всем критериям → скоринг низкий."""
    listing = _make_listing(
        area_total=150,
        year_built=1955,
        metro_distance_min=40,
        renovation="none",
        floor=1,
        floors_total=5,
        photos_count=1,
        rooms=5,
        seller_type="agency",
    )
    score = compute_score(listing, price=80_000_000, config=config)
    assert score.score < 30


def test_score_first_floor_penalty(config):
    """Первый этаж даёт штраф."""
    a = _make_listing(floor=1, floors_total=10)
    b = _make_listing(floor=5, floors_total=10)
    sa = compute_score(a, price=12_000_000, config=config).breakdown["floor"]
    sb = compute_score(b, price=12_000_000, config=config).breakdown["floor"]
    assert sa < sb


def test_score_missing_neutral(config):
    """Если поле отсутствует, при policy=neutral берётся 0.5."""
    config.missing_policy = "neutral"
    listing = _make_listing(metro_distance_min=None, renovation=None)
    score = compute_score(listing, price=12_000_000, config=config)
    # 0.5 * (вес метро 15 + вес ремонта 10) = 12.5 в breakdown
    assert score.breakdown["metro_distance"] == pytest.approx(15 * 0.5, abs=0.01)
    assert score.breakdown["renovation"] == pytest.approx(10 * 0.5, abs=0.01)


def test_score_missing_skip(config):
    """policy=skip — критерий выбрасывается, веса перенормируются."""
    config.missing_policy = "skip"
    listing = _make_listing(metro_distance_min=None)
    score = compute_score(listing, price=12_000_000, config=config)
    assert "metro_distance" not in score.breakdown


def test_price_per_m2_normalization(config):
    """Чем выше ₽/м², тем ниже вклад этого критерия."""
    a = _make_listing(area_total=60)
    cheap = compute_score(a, price=12_000_000, config=config).breakdown["price_per_m2"]  # 200к/м²
    expensive = compute_score(a, price=30_000_000, config=config).breakdown["price_per_m2"]  # 500к/м²
    assert cheap > expensive
    assert expensive < 1.0  # не максимум


def test_rooms_exact_match(config):
    """Точное совпадение комнат = 1.0, ±1 = 0.5, дальше = 0."""
    a = _make_listing(rooms=2)
    b = _make_listing(rooms=3)
    c = _make_listing(rooms=5)
    sa = compute_score(a, price=12_000_000, config=config).breakdown["rooms"]
    sb = compute_score(b, price=12_000_000, config=config).breakdown["rooms"]
    sc = compute_score(c, price=12_000_000, config=config).breakdown["rooms"]
    assert sa > sb > sc
    assert sc == 0.0


def test_score_zero_total_weight():
    """Защита от деления на ноль когда все веса = 0."""
    config = ScoringConfig.from_dict(
        {
            "version": "zero",
            "weights": {"price_per_m2": 0},
            "thresholds": {"price_per_m2": {"best": 100000, "worst": 200000}},
            "renovation_scores": {},
            "seller_scores": {},
        }
    )
    listing = _make_listing()
    score = compute_score(listing, price=12_000_000, config=config)
    assert score.score == 0.0
