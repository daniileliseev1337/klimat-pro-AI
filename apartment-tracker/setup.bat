@echo off
chcp 65001 > nul
setlocal

REM ===========================================================================
REM Установка apartment-tracker. Запусти двойным кликом ОДИН РАЗ.
REM Требует установленного Python 3.10+ (https://www.python.org/downloads/).
REM ===========================================================================

cd /d "%~dp0"

echo === Проверяю Python ===
where python >nul 2>&1
if errorlevel 1 (
    echo.
    echo [!] Python не найден в PATH.
    echo     Установи Python 3.10 или новее с https://www.python.org/downloads/
    echo     При установке поставь галку "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

echo === Создаю виртуальное окружение .venv ===
if not exist ".venv" (
    python -m venv .venv
    if errorlevel 1 (
        echo [!] Не получилось создать venv. Проверь права доступа к папке.
        pause
        exit /b 1
    )
)

echo === Обновляю pip ===
".venv\Scripts\python.exe" -m pip install --upgrade pip

echo === Устанавливаю apartment-tracker и зависимости ===
".venv\Scripts\python.exe" -m pip install -e ".[dev]"
if errorlevel 1 (
    echo [!] Установка не прошла. Подробности выше.
    pause
    exit /b 1
)

echo === Готовлю config.yaml ===
if not exist "config.yaml" (
    copy /Y "config_examples\config.example.yaml" "config.yaml" >nul
    echo [+] Создан config.yaml (отредактируй веса скоринга под себя).
) else (
    echo [=] config.yaml уже есть, не трогаю.
)

echo === Готовлю .env ===
if not exist ".env" (
    copy /Y "config_examples\.env.example" ".env" >nul
    echo [+] Создан .env. ОТКРОЙ ЕГО и впиши TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.
) else (
    echo [=] .env уже есть, не трогаю.
)

echo === Инициализирую базу данных ===
".venv\Scripts\apartment-tracker.exe" init

echo.
echo =========================================================================
echo Готово.
echo.
echo Дальше:
echo   1) Создай бота: напиши @BotFather в Telegram, команда /newbot. Скопируй токен.
echo   2) Узнай свой chat_id: напиши боту @userinfobot — он пришлёт твой ID.
echo   3) Открой файл .env, впиши TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.
echo   4) (опц.) Отредактируй config.yaml — веса скоринга под себя.
echo   5) Запусти бота двойным кликом на run.bat.
echo =========================================================================
pause
