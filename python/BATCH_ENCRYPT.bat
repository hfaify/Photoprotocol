@echo off
chcp 65001 > nul
cd /d "%~dp0"

:: Создаем папки, если их нет
if not exist "input" mkdir "input"
if not exist "output" mkdir "output"

:: Проверка python
set "PY_CMD=python"
where python >nul 2>nul
if %errorlevel% neq 0 (
    where py >nul 2>nul
    if %errorlevel% equ 0 set "PY_CMD=py"
)

echo ======================================================
echo           Photoprotocol: Пакетная обработка
echo ======================================================
echo.
echo [1] Режим шифрования:
echo   1. Мозаика (Тайлинг 32px) - для обычной ленты (JPEG)
echo   2. Попиксельный шум (XOR) - для документов (PNG)
set /p "M_CHOICE=Выберите [1 или 2, по умолчанию 1]: "
set "ENC_MODE=tiles"
if "%M_CHOICE%"=="2" set "ENC_MODE=noise"

echo.
echo [2] Сортировка исходников:
echo   1. По дате изменения (старые - новые)
echo   2. По дате изменения (новые - старые)
echo   3. По имени файла (алфавитный порядок)
set /p "S_CHOICE=Выберите [1, 2 или 3, по умолчанию 1]: "
set "SORT_MODE=date"
if "%S_CHOICE%"=="2" set "SORT_MODE=date_desc"
if "%S_CHOICE%"=="3" set "SORT_MODE=name"

echo.
set "DEFAULT_KEY=0000"
set /p "USER_KEY=Введите секретный ключ (Enter для ключа по умолчанию): "
if not defined USER_KEY set "USER_KEY=%DEFAULT_KEY%"

echo.
echo ------------------------------------------------------
%PY_CMD% "%~dp0batch_shield.py" "%ENC_MODE%" "%SORT_MODE%" "%USER_KEY%"
echo ------------------------------------------------------
echo.
pause