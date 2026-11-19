# Downloads a portable GCC (WinLibs MinGW-w64 build) into the .\gcc folder
# so the website can compile code without GCC being installed on the PC.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$url  = 'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-23.1.3-14.0.0-ucrt-r3/winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r3.zip'
$dest = Join-Path $PSScriptRoot 'gcc'
$gcc  = Join-Path $dest 'mingw64\bin\gcc.exe'
$zip  = Join-Path $env:TEMP 'winlibs-gcc.zip'

if (Test-Path $gcc) {
    Write-Host 'GCC is already installed:'
    & $gcc --version | Select-Object -First 1
    exit 0
}

Write-Host 'Downloading GCC (about 263 MB, this can take a few minutes)...'
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

Write-Host 'Checking the download...'
$shaFile = "$zip.sha256"
Invoke-WebRequest -Uri "$url.sha256" -OutFile $shaFile -UseBasicParsing
$expected = ((Get-Content $shaFile -Raw).Trim() -split '\s+')[0].ToUpper()
Remove-Item $shaFile -Force
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToUpper()
if ($expected -ne $actual) {
    Remove-Item $zip -Force
    throw "Checksum mismatch (expected $expected, got $actual). Download was corrupted; please run again."
}

Write-Host 'Extracting into the gcc folder...'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
tar.exe -xf $zip -C $dest
Remove-Item $zip -Force

Write-Host 'Done. Installed:'
& $gcc --version | Select-Object -First 1
