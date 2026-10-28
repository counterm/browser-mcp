@echo off
chcp 936 >nul 2>&1
setlocal

rem 无论从哪个位置调用（双击、快捷方式、其它目录的命令行），都切换到脚本所在目录
pushd "%~dp0"
if errorlevel 1 (
  echo [错误] 无法进入脚本所在目录：%~dp0
  pause
  exit /b 1
)

rem 可选参数：第一个参数作为端口，例如 start-broker.bat 9000
if not "%~1"=="" set "BRIDGE_PORT=%~1"

rem 优先使用项目内的虚拟环境，其次使用系统 Python
set "PY="
if exist "%~dp0.venv\Scripts\python.exe" set "PY=%~dp0.venv\Scripts\python.exe"
if not defined PY if exist "%~dp0venv\Scripts\python.exe" set "PY=%~dp0venv\Scripts\python.exe"
if not defined PY (
  where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
  where py >nul 2>&1 && set "PY=py -3"
)
if not defined PY (
  echo [错误] 未找到 Python，请先安装 Python 3 并加入 PATH。
  pause
  exit /b 1
)

rem 检查依赖 aiohttp，缺失则安装
"%PY%" -c "import aiohttp" >nul 2>&1
if errorlevel 1 (
  echo [提示] 缺少依赖 aiohttp，正在安装 requirements.txt ...
  "%PY%" -m pip install -r "%~dp0requirements.txt"
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请手动执行：pip install -r requirements.txt
    pause
    exit /b 1
  )
)

echo [启动] 工作目录：%CD%
echo [启动] Python：%PY%
if defined BRIDGE_PORT echo [启动] 端口：%BRIDGE_PORT%
if defined BRIDGE_TOKEN echo [启动] 鉴权：已开启

"%PY%" "%~dp0broker.py"
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo [错误] broker.py 已退出，退出码 %EXITCODE%（端口被占用或启动异常）
  pause
)

popd
exit /b %EXITCODE%
