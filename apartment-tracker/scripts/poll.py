#!/usr/bin/env python3
"""Cron-friendly прогон: scrape всех включённых фильтров + score + notify.

Запуск: python scripts/poll.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from apartment_tracker.config_loader import load_config, load_env
from apartment_tracker.db import Database
from apartment_tracker.notifier import Notifier, TelegramConfig
from apartment_tracker.scoring import ScoringConfig, compute_score
from apartment_tracker.sources.cian import CianSource
from apartment_tracker.tracker import IngestEvent, Tracker


def main() -> int:
    load_env()
    cfg = load_config()
    db = Database(cfg.get("database", {}).get("path", "data/apartments.sqlite"))
    db.init_schema()

    tg = TelegramConfig.from_dict(cfg.get("telegram", {}))
    notifier = Notifier(db, tg) if tg.enabled else None
    sc_cfg = ScoringConfig.from_dict(cfg.get("scoring", {}))

    tracker = Tracker(db)
    cian = CianSource()
    sent = 0

    for spec in db.list_filters(enabled_only=True):
        if spec.source != "cian":
            continue
        print(f"== Фильтр {spec.name} ==")
        try:
            results = cian.fetch_filter(
                location=spec.location or "Москва",
                deal_type=spec.deal_type or "sale",
                rooms=spec.rooms if spec.rooms is not None else "all",
                additional_settings=spec.additional_settings or {},
            )
        except Exception as e:
            print(f"  ошибка: {e}")
            continue

        seen_ids: list[str] = []
        for res in results:
            event = tracker.ingest(res)
            seen_ids.append(res.listing.id)
            sc = compute_score(event.listing, event.price, sc_cfg)
            db.save_score(sc)
            if notifier:
                if notifier.notify_event(event, sc):
                    sent += 1

        removed = tracker.finalize_run("cian", seen_ids)
        if notifier:
            for lid in removed:
                listing = db.get_listing(lid)
                if listing and notifier.notify_removed(listing):
                    sent += 1
        db.mark_filter_run(spec.name)
        print(f"  карточек: {len(results)}, сняты: {len(removed)}")

    print(f"Уведомлений отправлено: {sent}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
