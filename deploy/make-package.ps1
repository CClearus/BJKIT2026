# Builds bjkit-upload.tar.gz (next to the project folder) to upload to the VPS.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File deploy\make-package.ps1
# Leaves out Game/ (Unity project), gcc/ (Windows compiler) and the .bat files.
$ErrorActionPreference = 'Stop'
$root  = Split-Path -Parent $PSScriptRoot
$out   = Join-Path (Split-Path -Parent $root) 'bjkit-upload.tar.gz'
$stage = Join-Path $env:TEMP ('bjkit-stage-' + [guid]::NewGuid().ToString('N'))
$pkg   = Join-Path $stage 'bjkit'

New-Item -ItemType Directory -Force $pkg | Out-Null
foreach ($f in 'server.js', 'clans.js', 'students.js') { Copy-Item (Join-Path $root $f) $pkg }
foreach ($d in 'public', 'data', 'deploy') { Copy-Item (Join-Path $root $d) $pkg -Recurse }

# Linux needs LF line endings in the scripts and configs
Get-ChildItem (Join-Path $pkg 'deploy') -File | Where-Object { $_.Extension -in '.sh', '.service', '.conf' } | ForEach-Object {
  $text = [IO.File]::ReadAllText($_.FullName) -replace "`r`n", "`n"
  [IO.File]::WriteAllText($_.FullName, $text, (New-Object Text.UTF8Encoding $false))
}

if (Test-Path $out) { Remove-Item $out -Force }
& tar.exe -czf $out -C $stage bjkit
if ($LASTEXITCODE -ne 0) { throw "tar failed" }
Remove-Item $stage -Recurse -Force
"{0}  ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB)
