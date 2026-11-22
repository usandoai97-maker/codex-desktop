$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Criando atalho na Area de Trabalho..." -ForegroundColor Cyan

$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Codex Desktop.lnk'

$abrir = Join-Path $root 'ABRIR.bat'
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'

$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = "$env:WINDIR\System32\cmd.exe"
$sc.Arguments = '/c "' + $abrir + '"'
$sc.WorkingDirectory = $root
$sc.IconLocation = "$electron,0"
$sc.Description = 'Codex Desktop - agente local'
$sc.Save()

Write-Host "Atalho criado: $lnk" -ForegroundColor Green
