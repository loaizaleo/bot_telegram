@echo off
chcp 65001 > nul
title 🤖 Bot Bodega Telegram - Local 55
color 0A

echo.
echo 🚀 Iniciando Bot de Bodega Telegram...
echo 📍 Ruta: C:\Users\LENOVO\Documents\bot_telegram
echo ⏰ %date% %time%
echo.

REM Cambiar al directorio correcto
cd /d "C:\Users\LENOVO\Documents\bot_telegram"

REM Verificar archivo principal
if not exist "index_telegram_V27.js" (
    echo ❌ ERROR: index_telegram_V27.js no encontrado
    pause
    exit /b 1
)

REM Verificar archivo .env
if not exist ".env" (
    echo ⚠️  ADVERTENCIA: .env no encontrado
    echo    El sistema puede no funcionar correctamente
    echo.
)

echo 🌐 Iniciando servidor en: http://localhost:3000
echo 📸 Fotos: http://localhost:3000/fotos/
echo 📊 Reportes: http://localhost:3000/reportes/
echo.
echo ⚠️  Presiona Ctrl+C para detener
echo.

node index_telegram_V27.js

echo.
echo 🛑 Bot detenido
echo 📅 %date% - %time%
echo.
pause