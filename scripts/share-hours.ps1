#Requires -Version 5.1
<#
.SYNOPSIS
  约定时段分享：检测本机 Studio 已启动后，用 cloudflared 暴露 :5180。
.NOTES
  同事打开终端打印的 https://….trycloudflare.com 即可，操作方式与本机相同。
#>
$ErrorActionPreference = 'Stop'
$portFe = 5180
$portApi = 2025

function Test-Listen([int]$Port) {
  $line = netstat -ano | findstr "LISTENING" | findstr ":$Port"
  return [bool]$line
}

Write-Host "== Sci Teaching Studio · 约定时段分享 ==" -ForegroundColor Cyan

if (-not (Test-Listen $portApi)) {
  Write-Host "API :$portApi 未在监听。请先按 RUN.md 启动 backend。" -ForegroundColor Red
  exit 1
}
if (-not (Test-Listen $portFe)) {
  Write-Host "前端 :$portFe 未在监听。请先按 RUN.md 启动 frontend。" -ForegroundColor Red
  exit 1
}

$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  Write-Host "未找到 cloudflared，正在尝试 winget 安装…" -ForegroundColor Yellow
  winget install --id Cloudflare.cloudflared -e --accept-package-agreements --accept-source-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
    [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
  if (-not $cf) {
    Write-Host "安装后仍找不到 cloudflared，请新开终端再跑本脚本。" -ForegroundColor Red
    exit 1
  }
}

Write-Host "API/前端已就绪。启动临时隧道 → 把下面打印的 https://… 发给同事。" -ForegroundColor Green
Write-Host "时段结束：Ctrl+C 停隧道。" -ForegroundColor Green
Write-Host ""
& cloudflared tunnel --url "http://127.0.0.1:$portFe"
