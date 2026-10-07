@echo off
chcp 65001 > nul

:: Проверяем, перетащили ли файл
if "%~1"=="" (
    echo [!] Перетащите картинку мышкой на этот файл!
    echo.
    pause
    exit /b
)

cd /d "%~dp0"

:: Ищем рабочий python или py
set "PY_CMD=python"
where python >nul 2>nul
if %errorlevel% neq 0 (
    where py >nul 2>nul
    if %errorlevel% equ 0 (
        set "PY_CMD=py"
    ) else (
        echo [ERR] Python не найден в системе!
        pause
        exit /b
    )
)

:: Проверка Pillow
%PY_CMD% -c "import PIL" >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Устанавливаю Pillow...
    %PY_CMD% -m pip install Pillow
)

echo ======================================================
echo                     ART SHIELD
echo ======================================================
echo Выберите режим шифрования:
echo   [1] Мозаика (Тайлинг 32px) - для обычной ленты (JPEG)
echo   [2] Попиксельный шум (XOR)  - для файлов/документов (PNG)
echo.
set "MODE_CHOICE=1"
set /p "MODE_CHOICE=Выберите вариант [1 или 2, по умолчанию 1]: "

set "CHOSEN_MODE=tiles"
if "%MODE_CHOICE%"=="2" set "CHOSEN_MODE=noise"

echo ------------------------------------------------------
set "DEFAULT_KEY=0000"
set /p "USER_KEY=Введите ключ (Enter для дефолтного): "
if not defined USER_KEY set "USER_KEY=%DEFAULT_KEY%"

echo ------------------------------------------------------
echo Режим: %CHOSEN_MODE%
echo Обработка файлов...
echo.

%PY_CMD% "%~dp0shield_tool.py" "%CHOSEN_MODE%" "%USER_KEY%" %*

echo.
echo ------------------------------------------------------
echo Обработка завершена!
pause
