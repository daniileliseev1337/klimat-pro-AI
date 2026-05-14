"""Загрузка конфига и .env."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv


DEFAULT_CONFIG_PATHS = ["config.yaml", "config_examples/config.example.yaml"]


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    if path:
        cfg_path = Path(path)
    else:
        cfg_path = None
        for candidate in DEFAULT_CONFIG_PATHS:
            p = Path(candidate)
            if p.exists():
                cfg_path = p
                break
        if cfg_path is None:
            raise FileNotFoundError(
                "Не найден config.yaml. Скопируй config_examples/config.example.yaml в config.yaml."
            )
    with cfg_path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_env(path: str | Path = ".env") -> None:
    """Грузит .env если он есть, иначе тихо игнорирует."""
    p = Path(path)
    if p.exists():
        load_dotenv(p)
