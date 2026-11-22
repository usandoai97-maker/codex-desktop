@echo off
cd /d "%~dp0"
echo ============================================
echo   Instalando Codex Desktop
echo ============================================
echo.
echo [1/3] Instalando dependencias (npm)...
call npm install
if errorlevel 1 goto erro

echo.
echo [2/3] Baixando o binario do Electron...
call node node_modules\electron\install.js
if errorlevel 1 goto erro

echo.
echo [3/3] Criando atalho na Area de Trabalho...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
if errorlevel 1 goto erro

echo.
echo ============================================
echo   PRONTO!
echo   Use o atalho "Codex Desktop" na Area de Trabalho.
echo ============================================
pause
exit /b 0

:erro
echo.
echo ERRO na instalacao. Verifique se o Node.js esta instalado.
pause
exit /b 1
