"""Telegram-уведомления."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

import requests

from .db import Database
from .models import Listing, Score
from .tracker import IngestEvent


@dataclass
class TelegramConfig:
    bot_token: Optional[str]
    chat_id: Optional[str]
    notify_on: dict
    rate_limit_per_listing: int = 3600

    @property
    def enabled(self) -> bool:
        return bool(self.bot_token and self.chat_id)

    @classmethod
    def from_dict(cls, d: dict) -> "TelegramConfig":
        token = os.getenv(d.get("bot_token_env", "TELEGRAM_BOT_TOKEN"))
        chat = os.getenv(d.get("chat_id_env", "TELEGRAM_CHAT_ID"))
        return cls(
            bot_token=token,
            chat_id=chat,
            notify_on=dict(d.get("notify_on", {})),
            rate_limit_per_listing=int(d.get("rate_limit_per_listing", 3600)),
        )


def _format_event(event: IngestEvent, score: Optional[Score]) -> str:
    l = event.listing
    price_str = f"{event.price:,} ₽".replace(",", " ")
    score_str = f" | скоринг {score.score:.0f}" if score else ""

    if event.kind == "new":
        prefix = "🆕 Новый лот"
    elif event.kind == "price_drop":
        delta = abs(event.price - (event.previous_price or event.price))
        prefix = f"📉 Цена снижена на {delta:,} ₽".replace(",", " ")
    elif event.kind == "price_increase":
        delta = event.price - (event.previous_price or event.price)
        prefix = f"📈 Цена выросла на {delta:,} ₽".replace(",", " ")
    elif event.kind == "reappeared":
        prefix = "🔄 Лот появился снова"
    elif event.kind == "removed":
        prefix = "❌ Лот снят"
    else:
        prefix = "ℹ Изменение"

    parts = [
        f"<b>{prefix}</b>{score_str}",
        l.title or l.address or l.id,
    ]
    meta_bits = []
    if l.rooms is not None:
        meta_bits.append(f"{l.rooms}-комн")
    if l.area_total:
        meta_bits.append(f"{l.area_total:g} м²")
    if l.floor and l.floors_total:
        meta_bits.append(f"эт. {l.floor}/{l.floors_total}")
    if l.metro_name:
        meta_bits.append(f"м. {l.metro_name}")
        if l.metro_distance_min:
            meta_bits[-1] += f" ({l.metro_distance_min} мин)"
    if meta_bits:
        parts.append(" · ".join(meta_bits))
    parts.append(price_str)
    parts.append(f'<a href="{l.url}">открыть</a>')
    return "\n".join(parts)


def _format_removed(listing: Listing) -> str:
    return (
        f"<b>❌ Лот снят</b>\n"
        f"{listing.title or listing.address or listing.id}\n"
        f'<a href="{listing.url}">открыть</a>'
    )


class Notifier:
    def __init__(self, db: Database, config: TelegramConfig):
        self.db = db
        self.config = config

    def should_notify_event(self, event: IngestEvent, score: Optional[Score]) -> bool:
        cfg = self.config.notify_on
        kind = event.kind
        if kind == "new" and not cfg.get("new_listing", True):
            return False
        if kind == "price_drop" and not cfg.get("price_drop", True):
            return False
        if kind == "price_increase" and not cfg.get("price_increase", False):
            return False
        if kind == "reappeared" and not cfg.get("status_change", True):
            return False
        if kind == "unchanged":
            return False
        threshold = float(cfg.get("score_above", 0) or 0)
        if threshold > 0 and (score is None or score.score < threshold):
            return False

        # rate limit
        last = self.db.last_notification(event.listing.id, kind)
        if last and datetime.utcnow() - last < timedelta(seconds=self.config.rate_limit_per_listing):
            return False
        return True

    def notify_event(self, event: IngestEvent, score: Optional[Score]) -> bool:
        if not self.config.enabled:
            return False
        if not self.should_notify_event(event, score):
            return False
        text = _format_event(event, score)
        ok = self._send(text)
        if ok:
            self.db.log_notification(event.listing.id, event.kind)
        return ok

    def notify_removed(self, listing: Listing) -> bool:
        if not self.config.enabled:
            return False
        if not self.config.notify_on.get("status_change", True):
            return False
        last = self.db.last_notification(listing.id, "removed")
        if last and datetime.utcnow() - last < timedelta(seconds=self.config.rate_limit_per_listing):
            return False
        ok = self._send(_format_removed(listing))
        if ok:
            self.db.log_notification(listing.id, "removed")
        return ok

    def _send(self, text: str) -> bool:
        url = f"https://api.telegram.org/bot{self.config.bot_token}/sendMessage"
        try:
            r = requests.post(
                url,
                json={
                    "chat_id": self.config.chat_id,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": False,
                },
                timeout=10,
            )
            return r.ok
        except requests.RequestException:
            return False
