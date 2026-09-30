@echo off
setlocal

rem Stratum - the front door.
rem
rem   run.bat            set up if needed, start everything, open FULLSCREEN (kiosk)
rem   run.bat windowed   the same, in an ordinary browser tab
rem   run.bat check      check the install and stop
rem   run.bat setup      set up and stop
rem   run.bat models     fetch the inference runtime / models and write stratum.yaml
rem   run.bat stop       stop the workbench, the backend and the inference runtime
rem
rem Ports: workbench 3090, backend 8642, llama-swap 8090 (Faraday uses 3080/8080).

cd /d "%~dp0"
set "DSH_HOME=%USERPROFILE%\.dsh-stratum"
rem The Python venv, model cache and data live on D: (this repo sits in OneDrive).
if exist "D:\" (
  set "UV_PROJECT_ENVIRONMENT=D:\stratum\venv"
  set "UV_CACHE_DIR=D:\stratum\uv-cache"
  set "HF_HOME=D:\stratum\hf"
)

echo.
echo   Stratum - evidence-first coal document intelligence
echo   ---------------------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed or not on PATH. Install the LTS from https://nodejs.org.
  pause
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo   Installing pnpm...
  call npm install -g pnpm
)
where uv >nul 2>nul
if errorlevel 1 (
  echo   uv is not installed. Install it with:  pip install uv
  pause
  exit /b 1
)

if exist "D:\" (set "RUNTIME_ROOT=D:\ai") else (set "RUNTIME_ROOT=%LOCALAPPDATA%\stratum-runtime")
set "LLAMA_SWAP_EXE=%RUNTIME_ROOT%\llama-swap\llama-swap.exe"
set "SWAP_CONFIG=%RUNTIME_ROOT%\llama-swap\stratum.yaml"
set "PS=pwsh"
where pwsh >nul 2>nul || set "PS=powershell"

if /i "%~1"=="stop" (
  echo   Stopping Stratum...
  for %%P in (3090 8642 8090) do (
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"127.0.0.1:%%P .*LISTENING"') do taskkill /f /t /pid %%p >nul 2>nul
  )
  echo   Stopped.
  exit /b 0
)
if /i "%~1"=="models" (
  call %PS% -NoProfile -ExecutionPolicy Bypass -File "scripts\fetch-runtime.ps1"
  exit /b %errorlevel%
)
if /i "%~1"=="check" (
  call npm run doctor
  pause
  exit /b %errorlevel%
)
if /i "%~1"=="setup" (
  call npm run setup
  exit /b %errorlevel%
)

if not exist "%LLAMA_SWAP_EXE%" goto :fetchruntime
if not exist "%SWAP_CONFIG%" goto :fetchruntime
goto :runtimeready
:fetchruntime
echo   Fetching the inference runtime / writing stratum.yaml ...
call %PS% -NoProfile -ExecutionPolicy Bypass -File "scripts\fetch-runtime.ps1"
if errorlevel 1 (
  echo   Fetching the runtime failed; the message above says why.
  pause
  exit /b 1
)
:runtimeready

netstat -ano | findstr /r /c:"127.0.0.1:8090 .*LISTENING" >nul 2>nul
if errorlevel 1 (
  echo   Starting the inference runtime on 127.0.0.1:8090 ...
  start "Stratum - inference" /min "%LLAMA_SWAP_EXE%" --config "%SWAP_CONFIG%" --listen 127.0.0.1:8090
) else (
  echo   Inference runtime already running on 127.0.0.1:8090.
)

netstat -ano | findstr /r /c:"127.0.0.1:8642 .*LISTENING" >nul 2>nul
if errorlevel 1 (
  echo   Starting the Stratum backend on 127.0.0.1:8642 ...
  if exist "D:\stratum\venv\Scripts\python.exe" (
    start "Stratum - backend" /min cmd /c "cd /d "%~dp0backend" && "D:\stratum\venv\Scripts\python.exe" -m uvicorn stratum.api:app --host 127.0.0.1 --port 8642"
  ) else (
    start "Stratum - backend" /min cmd /c "cd /d "%~dp0backend" && uv run --python 3.12 uvicorn stratum.api:app --host 127.0.0.1 --port 8642"
  )
) else (
  echo   Backend already running on 127.0.0.1:8642.
)

call npm run setup
if errorlevel 1 (
  echo   Setup did not finish; the message above says what stopped it.
  pause
  exit /b 1
)

if /i "%~1"=="windowed" (
  echo   Starting the workbench at http://127.0.0.1:3090
  call npm start
  exit /b %errorlevel%
)

echo   Starting the workbench fullscreen. Alt+F4 closes it; Ctrl+C here stops it.
call npm run kiosk
set "EXITCODE=%errorlevel%"
if not "%EXITCODE%"=="0" pause
endlocal
exit /b %EXITCODE%
