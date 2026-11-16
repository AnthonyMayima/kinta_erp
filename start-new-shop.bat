@echo off
setlocal
title Kinta - New shop (port 3001)
set "PORT=3001"
set "NODE_ENV=production"
set "ALLOW_BOUTIQUE_REGISTRATION=true"
set "ALLOW_TEST_CLOCK=true"
set "JWT_SECRET=kinta-new-shop-local-2026-8f4d2a9c7e1b6f3a"
set "DB_PATH=%~dp0kinta-backend\database\kinta-new.db"
set "INITIAL_ADMIN_PASSWORD="
cd /d "%~dp0kinta-backend"
echo New Kinta instance: http://localhost:3001
echo Separate database: %DB_PATH%
echo The Poto-Poto server on port 3000 stays independent.
echo.
node src\server.js
endlocal
