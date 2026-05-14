"""Telegram-бот — основной UI для apartment-tracker.

Запуск: `apartment-bot` (после установки) или `python -m apartment_tracker.bot`.
Требует TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env.

ВАЖНО: бот работает только с одним пользователем (whitelist по chat_id).
Это специально — личный инструмент.
"""

from __future__ import annotations

import io
import logging
import os
import re
from datetime import datetime, time
from pathlib import Path
from typing import Any, Optional

from telegram import Document, InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from .config_loader import load_config, load_env
from .db import Database
from .exporter import export as do_export
from .models import FilterSpec, Listing, PricePoint, Score, make_listing_id
from .scoring import ScoringConfig, compute_score
from .sources.cian import CianSource
from .sources.manual import _extract_external_id, _guess_source
from .sources.yandex import YandexSource, _parse_from_html
from .tracker import IngestEvent, Tracker


logger = logging.getLogger("apartment_tracker.bot")

# Conversation states
ADD_URL, ADD_FIELDS = range(2)
FILTER_NAME, FILTER_URL, FILTER_CONFIRM = range(2, 5)

# Поля, которые опрашиваем при ручном вводе. Порядок имеет значение.
FIELDS_TO_PROMPT: list[tuple[str, str, type]] = [
    ("price", "💰 Цена в рублях (обязательно)", int),
    ("rooms", "🚪 Количество комнат (0 = студия)", int),
    ("area_total", "📐 Общая площадь в м²", float),
    ("floor", "🏢 Этаж", int),
    ("floors_total", "🏗 Всего этажей в доме", int),
    ("year_built", "📅 Год постройки", int),
    ("renovation", "🛠 Ремонт: designer / euro / cosmetic / none", str),
    ("metro_distance_min", "🚇 Минут пешком до метро", int),
    ("metro_name", "🚉 Название станции метро", str),
    ("seller_type", "👤 Продавец: owner / agent / agency", str),
    ("address", "📍 Адрес (необязательно)", str),
    ("photos_count", "📷 Количество фото (необязательно)", int),
]

REQUIRED_FIELDS = {"price"}


def _build_app_state(application: Application) -> None:
    """Создаёт shared state (db, config) для всех handlers."""
    load_env()
    cfg = load_config()
    db = Database(cfg.get("database", {}).get("path", "data/apartments.sqlite"))
    db.init_schema()

    application.bot_data["config"] = cfg
    application.bot_data["scoring_config"] = ScoringConfig.from_dict(cfg.get("scoring", {}))
    application.bot_data["db"] = db
    application.bot_data["tracker"] = Tracker(db)
    application.bot_data["cian"] = CianSource()
    application.bot_data["yandex"] = YandexSource()

    # Whitelist по chat_id — бот должен общаться только с владельцем.
    chat_id_env = cfg.get("telegram", {}).get("chat_id_env", "TELEGRAM_CHAT_ID")
    raw = os.getenv(chat_id_env)
    application.bot_data["allowed_chat_id"] = int(raw) if raw else None


def _is_allowed(update: Update, application_state: dict) -> bool:
    allowed = application_state.get("allowed_chat_id")
    if allowed is None:
        return True  # если не задан — разрешено всем (на свой страх)
    chat = update.effective_chat
    return bool(chat and chat.id == allowed)


async def _guard(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    if not _is_allowed(update, context.application.bot_data):
        await update.effective_message.reply_text(
            "⛔ Этот бот привязан к одному пользователю. Если это твой бот — пропиши свой "
            "chat_id в TELEGRAM_CHAT_ID и перезапусти."
        )
        return False
    return True


# --------------------------- Команды --------------------------- #


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    chat_id = update.effective_chat.id
    if context.application.bot_data.get("allowed_chat_id") is None:
        hint = (
            f"\n\nℹ Твой chat_id: <code>{chat_id}</code>\n"
            f"Пропиши его в файле <code>.env</code> как <code>TELEGRAM_CHAT_ID={chat_id}</code> "
            f"и перезапусти бота — тогда никто кроме тебя писать боту не сможет."
        )
    else:
        hint = ""
    await update.message.reply_text(
        "🏠 <b>Трекер квартир</b>\n\n"
        "Я ищу, отслеживаю и оцениваю квартиры с CIAN и Yandex Недвижимости.\n\n"
        "Главные команды:\n"
        "/add — добавить лот (пришли URL)\n"
        "/list — топ лотов по скорингу\n"
        "/score — пересчитать рейтинг\n"
        "/export — прислать Excel\n"
        "/history — история цены лота\n"
        "/filter_add — сохранить фильтр поиска CIAN\n"
        "/filter_list — мои фильтры\n"
        "/scrape — прогнать фильтры прямо сейчас\n"
        "/help — все команды" + hint,
        parse_mode=ParseMode.HTML,
    )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    await update.message.reply_text(
        "<b>Все команды:</b>\n\n"
        "<b>Лоты:</b>\n"
        "/add &lt;URL&gt; — добавить (CIAN — автомат, Yandex — попытка + вопросы)\n"
        "/list — топ-10 по скорингу\n"
        "/score — пересчитать рейтинг\n"
        "/export — Excel-дашборд\n"
        "/history &lt;ID&gt; — история цены\n"
        "/remove &lt;ID&gt; — удалить лот\n\n"
        "<b>Фильтры (только CIAN):</b>\n"
        "/filter_add — добавить (бот спросит параметры)\n"
        "/filter_list — список\n"
        "/scrape — прогнать включённые фильтры сейчас\n\n"
        "<b>Прочее:</b>\n"
        "/cancel — отмена текущей формы\n"
        "/status — БД и настройки\n\n"
        "<b>HTML Yandex:</b> пришли HTML-файл документом — извлеку поля.",
        parse_mode=ParseMode.HTML,
    )


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    db: Database = context.application.bot_data["db"]
    listings = db.all_listings()
    active = [l for l in listings if l.status == "active"]
    filters_list = db.list_filters()
    enabled = [f for f in filters_list if f.enabled]

    await update.message.reply_text(
        f"📊 <b>Состояние</b>\n"
        f"Всего лотов: <b>{len(listings)}</b> (активных: {len(active)})\n"
        f"Фильтров: <b>{len(filters_list)}</b> (включено: {len(enabled)})\n"
        f"БД: <code>{db.path}</code>",
        parse_mode=ParseMode.HTML,
    )


# --------------------------- /add --------------------------- #


async def cmd_add(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not await _guard(update, context):
        return ConversationHandler.END

    args = context.args
    if args:
        url = " ".join(args).strip()
        return await _add_handle_url(update, context, url)

    await update.message.reply_text("Пришли URL карточки квартиры (CIAN или Yandex Realty).")
    return ADD_URL


async def add_receive_url(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    url = (update.message.text or "").strip()
    return await _add_handle_url(update, context, url)


async def _add_handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE, url: str) -> int:
    if not url.startswith(("http://", "https://")):
        await update.message.reply_text("Это не похоже на URL. Пришли ссылку или /cancel.")
        return ADD_URL

    source = _guess_source(url)
    context.user_data["add_url"] = url
    context.user_data["add_source"] = source
    context.user_data["add_fields"] = {}
    context.user_data["add_field_idx"] = 0

    # Попробовать автопарсинг
    if source == "yandex":
        await update.message.reply_text("🔄 Пробую спарсить Yandex Realty (часто ловит капчу)...")
        try:
            yandex: YandexSource = context.application.bot_data["yandex"]
            result = yandex.fetch_single(url)
            return await _save_parsed_result(update, context, result.listing, result.price, result.deal_type)
        except Exception as e:
            await update.message.reply_text(
                f"⚠ Автопарсинг не получился: {e}\n\n"
                "Варианты:\n"
                "1) Открой страницу в браузере, нажми <b>Ctrl+S</b> (или ⌘S) → "
                "сохрани как <i>Веб-страница, только HTML</i> → пришли мне файл документом.\n"
                "2) Или ответь сейчас на вопросы по полям — спрошу по одному.",
                parse_mode=ParseMode.HTML,
            )
            return await _ask_next_field(update, context)
    elif source == "cian":
        # Для CIAN нет fetch_single (только filter); просим ввести поля вручную.
        await update.message.reply_text(
            "ℹ Прямой парсер одной карточки CIAN пока не реализован — заполни поля вручную "
            "или используй /filter_add для регулярного опроса CIAN по URL поиска."
        )
        return await _ask_next_field(update, context)
    else:
        await update.message.reply_text(
            f"ℹ Источник «{source}» не распознан как автоматический. Заполни поля вручную."
        )
        return await _ask_next_field(update, context)


async def _save_parsed_result(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    listing: Listing,
    price: Optional[int],
    deal_type: str,
) -> int:
    """Если автопарсинг что-то нашёл — спросить про недостающие критичные поля или сохранить."""
    if price is None:
        listing_data = _listing_to_prefill(listing)
        context.user_data["add_fields"] = listing_data
        await update.message.reply_text("Цену не нашёл — введи цифрой:")
        return await _ask_specific_field(update, context, "price")

    # Сохраняем сразу
    return await _finalize_listing(update, context, listing, price, deal_type)


def _listing_to_prefill(listing: Listing) -> dict[str, Any]:
    return {
        "rooms": listing.rooms,
        "area_total": listing.area_total,
        "floor": listing.floor,
        "floors_total": listing.floors_total,
        "year_built": listing.year_built,
        "renovation": listing.renovation,
        "metro_distance_min": listing.metro_distance_min,
        "metro_name": listing.metro_name,
        "seller_type": listing.seller_type,
        "address": listing.address,
        "photos_count": listing.photos_count,
    }


async def _ask_next_field(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    idx = context.user_data.get("add_field_idx", 0)
    while idx < len(FIELDS_TO_PROMPT):
        key, label, _cast = FIELDS_TO_PROMPT[idx]
        # если уже есть значение из автопарсинга — пропускаем
        if context.user_data["add_fields"].get(key) not in (None, ""):
            idx += 1
            continue
        context.user_data["add_field_idx"] = idx
        await update.message.reply_text(
            f"{label}\n<i>Напиши «-» чтобы пропустить.</i>",
            parse_mode=ParseMode.HTML,
        )
        return ADD_FIELDS

    # Все поля собраны
    return await _finalize_manual_add(update, context)


async def _ask_specific_field(update: Update, context: ContextTypes.DEFAULT_TYPE, field_key: str) -> int:
    for idx, (k, _, _) in enumerate(FIELDS_TO_PROMPT):
        if k == field_key:
            context.user_data["add_field_idx"] = idx
            label = FIELDS_TO_PROMPT[idx][1]
            await update.message.reply_text(label)
            return ADD_FIELDS
    return ADD_FIELDS


async def add_receive_field(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    idx = context.user_data.get("add_field_idx", 0)
    if idx >= len(FIELDS_TO_PROMPT):
        return await _finalize_manual_add(update, context)

    key, label, cast = FIELDS_TO_PROMPT[idx]
    raw = (update.message.text or "").strip()

    if raw == "-" or raw == "":
        if key in REQUIRED_FIELDS:
            await update.message.reply_text(f"⛔ Поле обязательное. {label}")
            return ADD_FIELDS
        value = None
    else:
        try:
            if cast is int:
                value = int(re.sub(r"[^\d-]", "", raw))
            elif cast is float:
                value = float(raw.replace(",", "."))
            else:
                value = raw
        except ValueError:
            await update.message.reply_text(f"⚠ Не понял значение. {label}")
            return ADD_FIELDS

    context.user_data["add_fields"][key] = value
    context.user_data["add_field_idx"] = idx + 1
    return await _ask_next_field(update, context)


async def _finalize_manual_add(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    fields = context.user_data["add_fields"]
    url = context.user_data["add_url"]
    source = context.user_data["add_source"]

    external_id = _extract_external_id(url) or _short_hash(url)
    listing = Listing(
        id=make_listing_id(source, external_id),
        source=source,
        external_id=external_id,
        url=url,
        address=fields.get("address"),
        rooms=fields.get("rooms"),
        area_total=fields.get("area_total"),
        floor=fields.get("floor"),
        floors_total=fields.get("floors_total"),
        year_built=fields.get("year_built"),
        renovation=fields.get("renovation"),
        metro_distance_min=fields.get("metro_distance_min"),
        metro_name=fields.get("metro_name"),
        seller_type=fields.get("seller_type"),
        photos_count=fields.get("photos_count"),
    )
    price = fields.get("price")
    return await _finalize_listing(update, context, listing, price, "sale")


async def _finalize_listing(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    listing: Listing,
    price: int,
    deal_type: str,
) -> int:
    db: Database = context.application.bot_data["db"]
    tracker: Tracker = context.application.bot_data["tracker"]
    sc_cfg: ScoringConfig = context.application.bot_data["scoring_config"]

    from .sources.base import FetchResult
    event = tracker.ingest(FetchResult(listing=listing, price=price, deal_type=deal_type))
    sc = compute_score(event.listing, price, sc_cfg)
    db.save_score(sc)

    msg = (
        f"✅ <b>{listing.id}</b>\n"
        f"{price:,} ₽".replace(",", " ") + "\n"
        f"Скоринг: <b>{sc.score:.1f}</b>\n"
    )
    if listing.area_total:
        ppm = price / listing.area_total
        msg += f"₽/м²: {ppm:,.0f}".replace(",", " ") + "\n"
    msg += f'<a href="{listing.url}">открыть карточку</a>'
    await update.message.reply_text(msg, parse_mode=ParseMode.HTML, disable_web_page_preview=False)

    context.user_data.clear()
    return ConversationHandler.END


# --------------------------- HTML document import --------------------------- #


async def on_document(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Принимаем HTML-файл (сохранённая страница Yandex Realty)."""
    if not await _guard(update, context):
        return
    doc: Optional[Document] = update.message.document
    if not doc:
        return
    if not (doc.file_name or "").lower().endswith((".html", ".htm")):
        await update.message.reply_text("Жду HTML-файл (.html). Этот не подойдёт.")
        return

    file = await doc.get_file()
    bio = io.BytesIO()
    await file.download_to_memory(bio)
    html = bio.getvalue().decode("utf-8", errors="ignore")

    url = context.user_data.get("add_url") or _try_extract_canonical_url(html) or "manual:html"
    try:
        listing, price, deal_type = _parse_from_html(html, url)
    except Exception as e:
        await update.message.reply_text(f"⚠ Не смог распарсить HTML: {e}")
        return

    if price is None:
        await update.message.reply_text(
            "✅ HTML прочитан, но цену не нашёл. Команда /add — введи URL и заполнишь руками."
        )
        return

    await _finalize_listing(update, context, listing, price, deal_type)


def _try_extract_canonical_url(html: str) -> Optional[str]:
    m = re.search(r'<link[^>]+rel="canonical"[^>]+href="([^"]+)"', html, re.I)
    return m.group(1) if m else None


def _short_hash(s: str) -> str:
    import hashlib
    return hashlib.md5(s.encode()).hexdigest()[:12]


# --------------------------- /list --------------------------- #


async def cmd_list(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    db: Database = context.application.bot_data["db"]
    listings = {l.id: l for l in db.all_listings(status="active")}
    scores = sorted(db.all_scores(), key=lambda s: s.score, reverse=True)
    lines = []
    n = 0
    for s in scores:
        if s.listing_id not in listings:
            continue
        l = listings[s.listing_id]
        price = db.latest_price(l.id)
        meta = []
        if l.rooms is not None:
            meta.append(f"{l.rooms}-к")
        if l.area_total:
            meta.append(f"{l.area_total:g}м²")
        if l.metro_name:
            meta.append(f"м.{l.metro_name}")
        lines.append(
            f"<b>{s.score:5.1f}</b> · {(price.price if price else 0):,} ₽".replace(",", " ")
            + f" · {' · '.join(meta)}\n<a href=\"{l.url}\">{l.id}</a>"
        )
        n += 1
        if n >= 10:
            break
    if not lines:
        await update.message.reply_text("Пока ничего нет. /add чтобы добавить лот.")
        return
    await update.message.reply_text("\n\n".join(lines), parse_mode=ParseMode.HTML, disable_web_page_preview=True)


# --------------------------- /score, /export, /history, /remove --------------------------- #


async def cmd_score(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    db: Database = context.application.bot_data["db"]
    sc_cfg: ScoringConfig = context.application.bot_data["scoring_config"]
    listings = db.all_listings()
    for l in listings:
        price = db.latest_price(l.id)
        sc = compute_score(l, price.price if price else None, sc_cfg)
        db.save_score(sc)
    await update.message.reply_text(f"♻ Пересчитал {len(listings)} лотов.")


async def cmd_export(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    db: Database = context.application.bot_data["db"]
    threshold = float(
        context.application.bot_data["config"]
        .get("telegram", {})
        .get("notify_on", {})
        .get("score_above", 70) or 70
    )
    path = Path("exports") / f"apartments_{datetime.now():%Y-%m-%d_%H%M}.xlsx"
    do_export(db, path, score_threshold_high=threshold)
    with path.open("rb") as f:
        await update.message.reply_document(document=f, filename=path.name)


async def cmd_history(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    if not context.args:
        await update.message.reply_text("Использование: /history &lt;ID&gt;\nID можно взять из /list.", parse_mode=ParseMode.HTML)
        return
    listing_id = context.args[0]
    db: Database = context.application.bot_data["db"]
    points = db.price_history(listing_id)
    if not points:
        await update.message.reply_text(f"Истории нет для {listing_id}.")
        return
    lines = [f"<b>История цены {listing_id}</b>"]
    prev = None
    for p in points:
        delta = "" if prev is None else f" ({p.price - prev:+,})".replace(",", " ")
        lines.append(f"{p.seen_at:%Y-%m-%d %H:%M} · {p.price:,}".replace(",", " ") + " ₽" + delta)
        prev = p.price
    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.HTML)


async def cmd_remove(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    if not context.args:
        await update.message.reply_text("Использование: /remove &lt;ID&gt;", parse_mode=ParseMode.HTML)
        return
    listing_id = context.args[0]
    db: Database = context.application.bot_data["db"]
    if not db.get_listing(listing_id):
        await update.message.reply_text("Не нашёл такой лот.")
        return
    db.set_status(listing_id, "removed")
    await update.message.reply_text(f"❌ {listing_id} помечен как снятый.")


# --------------------------- /filter_add, /filter_list, /scrape --------------------------- #


async def cmd_filter_add(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not await _guard(update, context):
        return ConversationHandler.END
    await update.message.reply_text(
        "Имя фильтра (латиницей, без пробелов, например <code>moscow_2k_central</code>):",
        parse_mode=ParseMode.HTML,
    )
    return FILTER_NAME


async def filter_receive_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    name = (update.message.text or "").strip()
    if not re.match(r"^[a-zA-Z0-9_-]+$", name):
        await update.message.reply_text("Только латиница, цифры, _ и -. Повтори.")
        return FILTER_NAME
    context.user_data["filter_name"] = name
    await update.message.reply_text(
        "URL поиска CIAN (https://www.cian.ru/cat.php?...).\n"
        "Открой поиск с нужными фильтрами в браузере, скопируй URL — пришли мне.\n"
        "<i>Поддерживается только CIAN.</i>",
        parse_mode=ParseMode.HTML,
    )
    return FILTER_URL


async def filter_receive_url(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    url = (update.message.text or "").strip()
    if "cian.ru" not in url:
        await update.message.reply_text("Сейчас принимаются только URL CIAN. /cancel чтобы отменить.")
        return FILTER_URL
    context.user_data["filter_url"] = url

    # Распарсить базовые параметры из URL
    params = _parse_cian_url(url)
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("✅ Сохранить и включить", callback_data="filter_save_on")],
            [InlineKeyboardButton("💾 Сохранить выключенным", callback_data="filter_save_off")],
            [InlineKeyboardButton("❌ Отмена", callback_data="filter_cancel")],
        ]
    )
    summary = (
        f"<b>{context.user_data['filter_name']}</b>\n"
        f"URL: {url}\n"
        f"Распознано: location={params.get('location', 'Москва')}, "
        f"deal={params.get('deal_type', 'sale')}, rooms={params.get('rooms', 'all')}"
    )
    await update.message.reply_text(summary, reply_markup=keyboard, parse_mode=ParseMode.HTML)
    context.user_data["filter_params"] = params
    return FILTER_CONFIRM


async def filter_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    if query.data == "filter_cancel":
        await query.edit_message_text("Отменено.")
        context.user_data.clear()
        return ConversationHandler.END

    enabled = query.data == "filter_save_on"
    db: Database = context.application.bot_data["db"]
    params = context.user_data.get("filter_params", {})

    spec = FilterSpec(
        name=context.user_data["filter_name"],
        source="cian",
        enabled=enabled,
        location=params.get("location", "Москва"),
        deal_type=params.get("deal_type", "sale"),
        rooms=params.get("rooms", "all"),
        url=context.user_data["filter_url"],
        additional_settings={"start_page": 1, "end_page": 2},
    )
    db.upsert_filter(spec)
    status = "включён" if enabled else "выключен"
    await query.edit_message_text(f"✅ Фильтр {spec.name} сохранён, {status}.")
    context.user_data.clear()
    return ConversationHandler.END


def _parse_cian_url(url: str) -> dict[str, Any]:
    """Грубо распарсить URL CIAN и вернуть параметры для cianparser."""
    from urllib.parse import parse_qs, urlparse

    out: dict[str, Any] = {"location": "Москва", "deal_type": "sale", "rooms": "all"}
    q = parse_qs(urlparse(url).query)
    if "deal_type" in q:
        v = q["deal_type"][0]
        if v == "rent":
            out["deal_type"] = "rent_long"
        elif v == "sale":
            out["deal_type"] = "sale"
    # Комнаты: на CIAN room1=1, room2=1 и т.д.
    rooms_found = [int(k[4:]) for k in q if re.match(r"^room\d$", k)]
    if rooms_found:
        out["rooms"] = rooms_found[0] if len(rooms_found) == 1 else "all"
    return out


async def cmd_filter_list(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    db: Database = context.application.bot_data["db"]
    filters_list = db.list_filters()
    if not filters_list:
        await update.message.reply_text("Фильтров пока нет. /filter_add чтобы добавить.")
        return
    lines = []
    for f in filters_list:
        status_icon = "✅" if f.enabled else "⏸"
        last = f.last_run.strftime("%Y-%m-%d %H:%M") if f.last_run else "никогда"
        lines.append(f"{status_icon} <b>{f.name}</b> · {f.location} · {f.deal_type} · rooms={f.rooms}\n   last_run: {last}")
    await update.message.reply_text("\n\n".join(lines), parse_mode=ParseMode.HTML)


async def cmd_scrape(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    await update.message.reply_text("🔄 Прогоняю фильтры... (может занять минуту)")
    summary = await _run_scrape(context.application, notify_events=False)
    await update.message.reply_text(summary, parse_mode=ParseMode.HTML)


async def _run_scrape(application: Application, *, notify_events: bool) -> str:
    """Прогон по всем включённым фильтрам. Если notify_events — слать уведомления о событиях.

    Возвращает текстовую сводку для итогового сообщения.
    """
    db: Database = application.bot_data["db"]
    tracker: Tracker = application.bot_data["tracker"]
    sc_cfg: ScoringConfig = application.bot_data["scoring_config"]
    cian: CianSource = application.bot_data["cian"]
    chat_id = application.bot_data.get("allowed_chat_id")
    cfg_notify = application.bot_data["config"].get("telegram", {}).get("notify_on", {})

    total_new = total_drop = total_inc = total_removed = 0
    error_lines: list[str] = []
    notifications_sent = 0

    for spec in db.list_filters(enabled_only=True):
        if spec.source != "cian":
            continue
        try:
            results = cian.fetch_filter(
                location=spec.location or "Москва",
                deal_type=spec.deal_type or "sale",
                rooms=spec.rooms if spec.rooms is not None else "all",
                additional_settings=spec.additional_settings or {},
            )
        except Exception as e:
            error_lines.append(f"⚠ {spec.name}: {e}")
            continue

        seen_ids: list[str] = []
        for res in results:
            event = tracker.ingest(res)
            seen_ids.append(res.listing.id)
            sc = compute_score(event.listing, event.price, sc_cfg)
            db.save_score(sc)
            if notify_events and chat_id:
                if await _maybe_notify_event(application, chat_id, event, sc, cfg_notify):
                    notifications_sent += 1
            if event.kind == "new":
                total_new += 1
            elif event.kind == "price_drop":
                total_drop += 1
            elif event.kind == "price_increase":
                total_inc += 1

        removed_ids = tracker.finalize_run("cian", seen_ids)
        total_removed += len(removed_ids)
        if notify_events and chat_id and cfg_notify.get("status_change", True):
            for lid in removed_ids:
                listing = db.get_listing(lid)
                if listing and await _maybe_notify_removed(application, chat_id, listing):
                    notifications_sent += 1

        db.mark_filter_run(spec.name)

    summary = (
        f"📊 Прогон закончен\n"
        f"🆕 новых: <b>{total_new}</b>\n"
        f"📉 цена снижена: <b>{total_drop}</b>\n"
        f"📈 цена выросла: <b>{total_inc}</b>\n"
        f"❌ снято: <b>{total_removed}</b>"
    )
    if notifications_sent:
        summary += f"\n📨 отправлено уведомлений: {notifications_sent}"
    if error_lines:
        summary += "\n\n" + "\n".join(error_lines)
    return summary


async def _maybe_notify_event(
    application: Application,
    chat_id: int,
    event: IngestEvent,
    sc: Score,
    cfg_notify: dict,
) -> bool:
    kind = event.kind
    if kind == "new" and not cfg_notify.get("new_listing", True):
        return False
    if kind == "price_drop" and not cfg_notify.get("price_drop", True):
        return False
    if kind == "price_increase" and not cfg_notify.get("price_increase", False):
        return False
    if kind == "reappeared" and not cfg_notify.get("status_change", True):
        return False
    if kind in ("unchanged",):
        return False
    threshold = float(cfg_notify.get("score_above", 0) or 0)
    if threshold > 0 and sc.score < threshold:
        return False

    l = event.listing
    prefix = {
        "new": "🆕 Новый лот",
        "price_drop": f"📉 Цена снижена на {abs(event.price - (event.previous_price or event.price)):,}".replace(",", " ") + " ₽",
        "price_increase": f"📈 Цена выросла на {event.price - (event.previous_price or event.price):,}".replace(",", " ") + " ₽",
        "reappeared": "🔄 Лот появился снова",
    }.get(kind, "ℹ Изменение")

    meta = []
    if l.rooms is not None:
        meta.append(f"{l.rooms}-к")
    if l.area_total:
        meta.append(f"{l.area_total:g}м²")
    if l.metro_name:
        m = f"м.{l.metro_name}"
        if l.metro_distance_min:
            m += f" ({l.metro_distance_min}мин)"
        meta.append(m)
    text = (
        f"<b>{prefix}</b> · скоринг {sc.score:.0f}\n"
        f"{l.title or l.address or l.id}\n"
        f"{' · '.join(meta)}\n"
        f"{event.price:,} ₽".replace(",", " ") + "\n"
        f'<a href="{l.url}">открыть</a>'
    )
    await application.bot.send_message(
        chat_id=chat_id, text=text, parse_mode=ParseMode.HTML, disable_web_page_preview=True
    )
    application.bot_data["db"].log_notification(l.id, kind)
    return True


async def _maybe_notify_removed(application: Application, chat_id: int, listing: Listing) -> bool:
    text = (
        f"<b>❌ Лот снят</b>\n"
        f"{listing.title or listing.address or listing.id}\n"
        f'<a href="{listing.url}">открыть</a>'
    )
    await application.bot.send_message(
        chat_id=chat_id, text=text, parse_mode=ParseMode.HTML, disable_web_page_preview=True
    )
    application.bot_data["db"].log_notification(listing.id, "removed")
    return True


# --------------------------- /cancel --------------------------- #


async def cmd_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.clear()
    await update.message.reply_text("Окей, отменил.")
    return ConversationHandler.END


# --------------------------- Periodic job --------------------------- #


async def periodic_scrape_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    logger.info("periodic scrape: start")
    summary = await _run_scrape(context.application, notify_events=True)
    chat_id = context.application.bot_data.get("allowed_chat_id")
    # Шлём итоговую сводку только если что-то значимое произошло
    if chat_id and ("новых: <b>0</b>" not in summary or "снижена: <b>0</b>" not in summary):
        try:
            # Тихая сводка без HTML-маркапа в логе
            await context.bot.send_message(chat_id=chat_id, text=summary, parse_mode=ParseMode.HTML)
        except Exception as e:
            logger.warning("can't send scrape summary: %s", e)
    logger.info("periodic scrape: done")


# --------------------------- main --------------------------- #


def main() -> None:
    load_env()
    cfg = load_config()
    tg_cfg = cfg.get("telegram", {})
    token_env = tg_cfg.get("bot_token_env", "TELEGRAM_BOT_TOKEN")
    token = os.getenv(token_env)
    if not token:
        raise SystemExit(
            f"⛔ Переменная {token_env} не задана. Проверь .env (см. config_examples/.env.example)."
        )

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s [%(levelname)s] %(message)s",
    )
    logger.info("Starting bot...")

    application = Application.builder().token(token).build()
    _build_app_state(application)

    # Conversation: /add
    conv_add = ConversationHandler(
        entry_points=[CommandHandler("add", cmd_add)],
        states={
            ADD_URL: [MessageHandler(filters.TEXT & ~filters.COMMAND, add_receive_url)],
            ADD_FIELDS: [MessageHandler(filters.TEXT & ~filters.COMMAND, add_receive_field)],
        },
        fallbacks=[CommandHandler("cancel", cmd_cancel)],
    )
    application.add_handler(conv_add)

    # Conversation: /filter_add
    conv_filter = ConversationHandler(
        entry_points=[CommandHandler("filter_add", cmd_filter_add)],
        states={
            FILTER_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, filter_receive_name)],
            FILTER_URL: [MessageHandler(filters.TEXT & ~filters.COMMAND, filter_receive_url)],
            FILTER_CONFIRM: [CallbackQueryHandler(filter_confirm, pattern=r"^filter_")],
        },
        fallbacks=[CommandHandler("cancel", cmd_cancel)],
    )
    application.add_handler(conv_filter)

    # Простые команды
    application.add_handler(CommandHandler("start", cmd_start))
    application.add_handler(CommandHandler("help", cmd_help))
    application.add_handler(CommandHandler("status", cmd_status))
    application.add_handler(CommandHandler("list", cmd_list))
    application.add_handler(CommandHandler("score", cmd_score))
    application.add_handler(CommandHandler("export", cmd_export))
    application.add_handler(CommandHandler("history", cmd_history))
    application.add_handler(CommandHandler("remove", cmd_remove))
    application.add_handler(CommandHandler("filter_list", cmd_filter_list))
    application.add_handler(CommandHandler("scrape", cmd_scrape))
    application.add_handler(CommandHandler("cancel", cmd_cancel))

    # Документы (HTML)
    application.add_handler(MessageHandler(filters.Document.ALL, on_document))

    # Periodic scrape
    interval_sec = int(cfg.get("telegram", {}).get("scrape_interval_seconds", 3600))
    if interval_sec > 0 and application.job_queue is not None:
        application.job_queue.run_repeating(periodic_scrape_job, interval=interval_sec, first=30)
        logger.info("scheduled periodic scrape every %s sec", interval_sec)

    logger.info("Bot is polling...")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
