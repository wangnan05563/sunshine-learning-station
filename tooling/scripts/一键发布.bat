@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM One-click build + package + publish to GitHub Releases
REM ------------------------------------------------------------
REM This launcher is pure ASCII on purpose: cmd.exe parses .bat bytes
REM as the system ANSI codepage, so any non-ASCII byte here would be
REM mis-decoded. All human-readable Chinese output is owned by the
REM companion PowerShell logic file, UTF-8 with BOM, written by the
REM generator - edit templates plus config.json, not this file.
REM
REM Every parameter - project name, paths, version source, release repo,
REM gates, token lookup - lives in config.json. Nothing is hardcoded here.
REM
REM Usage:
REM   double-click, or from the repository root:
REM     tooling\scripts\<launcher>.bat --dry-run    build and assemble, print plan, no network
REM     tooling\scripts\<launcher>.bat --yes        skip the interactive publish confirmation
REM     tooling\scripts\<launcher>.bat --selftest   structure smoke only, used by verify.ps1
REM
REM Safety: publishing is an outward-facing action. Unless --yes is given
REM the logic file asks for a literal YES before touching GitHub.
REM ============================================================

set "SCRIPT_DIR=%~dp0"
REM Relative depth from this launcher up to the repository root, injected
REM by the generator from config.paths.repo_root_depth, then normalized to
REM an absolute path because %~dp0 already ends with a backslash.
set "REPO_ROOT=%SCRIPT_DIR%..\.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"

if not defined CONFIG_PATH set "CONFIG_PATH=%SCRIPT_DIR%config.json"

REM Console codepage must match the OutputEncoding set in the logic file.
chcp 65001 >nul

echo [publish] repo root : %REPO_ROOT%
echo [publish] config    : %CONFIG_PATH%

REM Flag scan without goto or loops - cmd goto under codepage 65001 is fragile.
set "PS_ARGS="
if "%~1"=="--dry-run"   set "PS_ARGS=-DryRun"
if "%~2"=="--dry-run"   set "PS_ARGS=-DryRun"
if "%~3"=="--dry-run"   set "PS_ARGS=-DryRun"
if "%~1"=="--yes"       set "PS_ARGS=!PS_ARGS! -Force"
if "%~2"=="--yes"       set "PS_ARGS=!PS_ARGS! -Force"
if "%~3"=="--yes"       set "PS_ARGS=!PS_ARGS! -Force"
if "%~1"=="--selftest"  set "PS_ARGS=-SelfTest"
if "%~2"=="--selftest"  set "PS_ARGS=-SelfTest"

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build-publish.ps1" -ConfigPath "%CONFIG_PATH%" -RepoRoot "%REPO_ROOT%" !PS_ARGS!
if errorlevel 1 (
  echo [publish] FAILED - see the log above
  if not "!PS_ARGS!"=="-SelfTest" pause
  exit /b 1
)

echo.
echo [publish] DONE.
if not "!PS_ARGS!"=="-SelfTest" pause
endlocal
exit /b 0
