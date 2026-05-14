@echo off
chcp 65001 > nul
setlocal

cd /d "%~dp0"

if not exist ".venv\Scripts\apartment-bot.exe" (
    echo [!] Бот не установлен. Сначала запусти setup.bat двойным кликом.
    pause
    exit /b 1
)

if not exist ".env" (
    echo [!] Нет файла .env. Сначала запусти setup.bat и заполни TELEGRAM_BOT_TOKEN.
    pause
    exit /b 1
)

echo === Запускаю apartment-tracker bot ===
echo (Чтобы остановить — закрой это окно или нажми Ctrl+C)
echo.

".venv\Scripts\apartment-bot.exe"

echo.
echo === Бот остановлен ===
pause
