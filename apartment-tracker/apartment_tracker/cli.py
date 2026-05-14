"""CLI entry point — `apartment-tracker <command>`."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Optional

import click
from rich.console import Console
from rich.table import Table

from .config_loader import load_config, load_env
from .db import Database
from .exporter import export as do_export
from .models import FilterSpec
from .notifier import Notifier, TelegramConfig
from .scoring import ScoringConfig, compute_score
from .sources.cian import CianSource
from .sources.manual import ManualSource
from .sources.yandex import YandexSource
from .tracker import Tracker


console = Console()


@click.group(help="Трекер-анализатор поиска квартиры.")
@click.option("--config", "config_path", default=None, help="Путь к config.yaml")
@click.pass_context
def main(ctx: click.Context, config_path: Optional[str]) -> None:
    load_env()
    try:
        cfg = load_config(config_path)
    except FileNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        sys.exit(1)
    ctx.ensure_object(dict)
    ctx.obj["config"] = cfg
    db_path = cfg.get("database", {}).get("path", "data/apartments.sqlite")
    ctx.obj["db"] = Database(db_path)


@main.command(help="Инициализировать БД (создать таблицы).")
@click.pass_context
def init(ctx: click.Context) -> None:
    db: Database = ctx.obj["db"]
    db.init_schema()
    console.print(f"[green]БД готова:[/green] {db.path}")


@main.command(help="Добавить лот (ручной ввод или из HTML-файла).")
@click.option("--source", default=None, help="cian/yandex/avito/manual")
@click.option("--url", required=True)
@click.option("--html-file", default=None, help="Сохранённая HTML-страница (для Yandex после капчи)")
@click.option("--price", type=int, default=None)
@click.option("--rooms", type=int, default=None)
@click.option("--area", type=float, default=None)
@click.pass_context
def add(ctx, source, url, html_file, price, rooms, area):
    db: Database = ctx.obj["db"]
    db.init_schema()

    if (source or "").lower() == "yandex" or "yandex" in url:
        yandex = YandexSource()
        try:
            result = yandex.fetch_single(url, html_file=html_file)
            console.print("[green]Парсинг Yandex Realty: OK[/green]")
        except Exception as e:
            console.print(f"[yellow]Не удалось спарсить автоматически:[/yellow] {e}")
            console.print("Переключаюсь на ручной ввод.")
            prefill: dict[str, Any] = {}
            if price is not None:
                prefill["price"] = price
            if rooms is not None:
                prefill["rooms"] = rooms
            if area is not None:
                prefill["area_total"] = area
            manual = ManualSource()
            result = manual.fetch_single(url, prefill=prefill, source_hint="yandex")
    else:
        prefill = {}
        if price is not None:
            prefill["price"] = price
        if rooms is not None:
            prefill["rooms"] = rooms
        if area is not None:
            prefill["area_total"] = area
        manual = ManualSource()
        result = manual.fetch_single(url, prefill=prefill, source_hint=source)

    tracker = Tracker(db)
    event = tracker.ingest(result)
    console.print(f"[green]{event.kind}[/green] {event.listing.id} · {event.price} ₽")


@main.command(help="Спарсить CIAN по сохранённому фильтру.")
@click.option("--filter", "filter_name", required=True)
@click.pass_context
def scrape(ctx, filter_name: str) -> None:
    db: Database = ctx.obj["db"]
    db.init_schema()
    filters = {f.name: f for f in db.list_filters()}
    spec = filters.get(filter_name)
    if not spec:
        console.print(f"[red]Фильтр '{filter_name}' не найден.[/red]")
        sys.exit(1)
    if spec.source != "cian":
        console.print(f"[red]Источник '{spec.source}' пока не поддерживается через scrape (только cian).[/red]")
        sys.exit(1)

    cian = CianSource()
    console.print(f"Прогон фильтра [bold]{spec.name}[/bold]: location={spec.location}, deal_type={spec.deal_type}, rooms={spec.rooms}")
    results = cian.fetch_filter(
        location=spec.location or "Москва",
        deal_type=spec.deal_type or "sale",
        rooms=spec.rooms if spec.rooms is not None else "all",
        additional_settings=spec.additional_settings or {},
    )
    console.print(f"Получено карточек: {len(results)}")

    tracker = Tracker(db)
    seen_ids: list[str] = []
    counters = {"new": 0, "price_drop": 0, "price_increase": 0, "unchanged": 0, "reappeared": 0}
    for res in results:
        ev = tracker.ingest(res)
        seen_ids.append(res.listing.id)
        counters[ev.kind] = counters.get(ev.kind, 0) + 1

    removed = tracker.finalize_run("cian", seen_ids)
    db.mark_filter_run(spec.name)
    console.print(
        f"[green]{counters['new']} новых[/green] · "
        f"{counters.get('price_drop', 0)} ↓ · "
        f"{counters.get('price_increase', 0)} ↑ · "
        f"{counters.get('reappeared', 0)} вернулись · "
        f"{len(removed)} сняты"
    )


@main.command(help="Пересчитать скоринг для всех активных лотов.")
@click.pass_context
def score(ctx) -> None:
    db: Database = ctx.obj["db"]
    db.init_schema()
    cfg = ctx.obj["config"]
    sc_cfg = ScoringConfig.from_dict(cfg.get("scoring", {}))

    listings = db.all_listings()
    for l in listings:
        price = db.latest_price(l.id)
        sc = compute_score(l, price.price if price else None, sc_cfg)
        db.save_score(sc)

    console.print(f"[green]Пересчитано {len(listings)} лотов.[/green] config_version={sc_cfg.version}")


@main.command(help="Экспорт в Excel.")
@click.option("--out", default="exports/apartments.xlsx")
@click.pass_context
def export(ctx, out: str) -> None:
    db: Database = ctx.obj["db"]
    db.init_schema()
    threshold = float(ctx.obj["config"].get("telegram", {}).get("notify_on", {}).get("score_above", 70) or 70)
    path = do_export(db, out, score_threshold_high=threshold)
    console.print(f"[green]Excel сохранён:[/green] {path}")


@main.command(help="Прогон уведомлений по событиям с прошлого запуска.")
@click.pass_context
def notify(ctx) -> None:
    db: Database = ctx.obj["db"]
    db.init_schema()
    cfg = ctx.obj["config"]
    tg = TelegramConfig.from_dict(cfg.get("telegram", {}))
    if not tg.enabled:
        console.print("[yellow]Telegram не настроен (нет TOKEN/CHAT_ID в .env). Уведомления пропущены.[/yellow]")
        return

    notifier = Notifier(db, tg)
    sc_cfg = ScoringConfig.from_dict(cfg.get("scoring", {}))

    scores_by_id = {s.listing_id: s for s in db.all_scores()}
    listings = db.all_listings()
    sent_total = 0

    for l in listings:
        price = db.latest_price(l.id)
        if not price:
            continue
        sc = scores_by_id.get(l.id) or compute_score(l, price.price, sc_cfg)
        from .tracker import IngestEvent
        history = db.price_history(l.id)
        # Простой эвристический пробой: если уведомление о new ещё не слали — слать.
        kind: Optional[str] = None
        previous_price: Optional[int] = None
        if db.last_notification(l.id, "new") is None and len(history) == 1:
            kind = "new"
        elif len(history) >= 2 and db.last_notification(l.id, "price_drop") is None and history[-1].price < history[-2].price:
            kind = "price_drop"
            previous_price = history[-2].price
        elif l.status == "removed" and db.last_notification(l.id, "removed") is None:
            notifier.notify_removed(l)
            sent_total += 1
            continue

        if kind:
            event = IngestEvent(listing=l, kind=kind, price=price.price, previous_price=previous_price)
            if notifier.notify_event(event, sc):
                sent_total += 1

    console.print(f"[green]Отправлено уведомлений: {sent_total}[/green]")


@main.command(name="history", help="История цены одного лота.")
@click.option("--id", "listing_id", required=True)
@click.pass_context
def history_cmd(ctx, listing_id: str) -> None:
    db: Database = ctx.obj["db"]
    points = db.price_history(listing_id)
    if not points:
        console.print(f"[yellow]Нет истории для {listing_id}[/yellow]")
        return
    table = Table(title=f"История цены {listing_id}")
    table.add_column("Время")
    table.add_column("Цена, ₽", justify="right")
    table.add_column("Δ", justify="right")
    prev = None
    for p in points:
        delta = "" if prev is None else f"{p.price - prev:+,}".replace(",", " ")
        table.add_row(p.seen_at.isoformat(timespec="seconds"), f"{p.price:,}".replace(",", " "), delta)
        prev = p.price
    console.print(table)


@main.command(name="filter-add", help="Добавить/обновить сохранённый фильтр поиска.")
@click.option("--name", required=True)
@click.option("--source", required=True, type=click.Choice(["cian", "yandex"]))
@click.option("--location", default="Москва")
@click.option("--deal-type", default="sale", type=click.Choice(["sale", "rent_long"]))
@click.option("--rooms", default="all", help="число, 'studio', 'all'")
@click.option("--url", default=None, help="URL поиска (для yandex)")
@click.option("--start-page", type=int, default=1)
@click.option("--end-page", type=int, default=1)
@click.option("--min-price", type=int, default=None)
@click.option("--max-price", type=int, default=None)
@click.option("--enabled/--disabled", default=True)
@click.pass_context
def filter_add(ctx, name, source, location, deal_type, rooms, url, start_page, end_page, min_price, max_price, enabled):
    db: Database = ctx.obj["db"]
    db.init_schema()

    add_settings: dict[str, Any] = {"start_page": start_page, "end_page": end_page}
    if min_price is not None:
        add_settings["min_price"] = min_price
    if max_price is not None:
        add_settings["max_price"] = max_price

    try:
        rooms_val: Any = int(rooms)
    except ValueError:
        rooms_val = rooms

    spec = FilterSpec(
        name=name,
        source=source,
        enabled=enabled,
        location=location,
        deal_type=deal_type,
        rooms=rooms_val,
        url=url,
        additional_settings=add_settings,
    )
    db.upsert_filter(spec)
    console.print(f"[green]Фильтр сохранён:[/green] {name}")


@main.command(name="filter-list", help="Показать все сохранённые фильтры.")
@click.pass_context
def filter_list(ctx):
    db: Database = ctx.obj["db"]
    db.init_schema()
    filters = db.list_filters()
    if not filters:
        console.print("[yellow]Фильтров пока нет.[/yellow]")
        return
    table = Table(title="Фильтры")
    table.add_column("Имя")
    table.add_column("Источник")
    table.add_column("Параметры")
    table.add_column("Включён")
    table.add_column("Последний прогон")
    for f in filters:
        params = (
            f"loc={f.location} · deal={f.deal_type} · rooms={f.rooms} · "
            f"{json.dumps(f.additional_settings, ensure_ascii=False)}"
        )
        table.add_row(f.name, f.source, params, "✓" if f.enabled else "✗", f.last_run.isoformat() if f.last_run else "—")
    console.print(table)


@main.command(name="list", help="Показать топ лотов по скорингу.")
@click.option("--limit", type=int, default=20)
@click.option("--status", default="active")
@click.pass_context
def list_cmd(ctx, limit, status):
    db: Database = ctx.obj["db"]
    db.init_schema()
    listings = {l.id: l for l in db.all_listings(status=status)}
    scores = sorted(db.all_scores(), key=lambda s: s.score, reverse=True)
    table = Table(title=f"Топ {limit} лотов (status={status})")
    table.add_column("Скоринг", justify="right")
    table.add_column("Цена, ₽", justify="right")
    table.add_column("Комнаты")
    table.add_column("м²")
    table.add_column("Метро")
    table.add_column("ID")
    table.add_column("URL", overflow="fold")
    n = 0
    for s in scores:
        if s.listing_id not in listings:
            continue
        l = listings[s.listing_id]
        price = db.latest_price(l.id)
        table.add_row(
            f"{s.score:.1f}",
            f"{price.price:,}".replace(",", " ") if price else "—",
            str(l.rooms or "—"),
            f"{l.area_total or '—'}",
            f"{l.metro_name or ''} {l.metro_distance_min or ''}".strip() or "—",
            l.id,
            l.url,
        )
        n += 1
        if n >= limit:
            break
    console.print(table)


if __name__ == "__main__":
    main()
