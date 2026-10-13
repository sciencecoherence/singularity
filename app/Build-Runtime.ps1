# Temporal Live — build the desktop app on the Electron already installed for
# Temporal Matrix. Nothing is downloaded and nothing large is duplicated: the
# Electron files are shared with Temporal Matrix by hard link, and this app's
# source is placed in its own resources\app. Run from PowerShell in this folder.
$ErrorActionPreference = 'Stop'
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$source  = Join-Path $here 'source'
$runtime = Join-Path $here 'runtime'
# Temporal Matrix sits beside this folder (cohera\temporal-live) or, since the
# app moved into the singularity repository (cohera\singularity\app), two up.
$donor   = @((Join-Path (Split-Path -Parent $here) 'temporal-matrix\runtime'),
             (Join-Path (Split-Path -Parent (Split-Path -Parent $here)) 'temporal-matrix\runtime')) |
           Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $donor) { $donor = Join-Path (Split-Path -Parent (Split-Path -Parent $here)) 'temporal-matrix\runtime' }

if (-not (Test-Path $donor)) { throw "Temporal Matrix runtime not found at $donor" }

# Temporal Live and Temporal Matrix run the same Electron. Rather than keep two
# copies of it (about 370 MB each), every Electron file here is a hard link to
# the same file in Temporal Matrix's runtime: one copy on disk, two names. Only
# resources\app — each app's own code — is separate. Hard links need both
# folders on the same drive; if that is not so, the file is copied instead.
# Deleting either folder later is safe: the other keeps its files.
$donorExe = (Get-ChildItem $donor -Filter '*.exe' | Select-Object -First 1).Name
function Link-Or-Copy($target, $from) {
  try { New-Item -ItemType HardLink -Path $target -Value $from -ErrorAction Stop | Out-Null }
  catch {
    cmd /c mklink /H "$target" "$from" | Out-Null
    if (-not (Test-Path $target)) { Copy-Item $from $target }
  }
}
# Any program running from this runtime holds its files open.
$users = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($runtime, 'OrdinalIgnoreCase') }
if ($users) {
  throw ('Close ' + (($users | Select-Object -ExpandProperty ProcessName -Unique) -join ', ') + ' first, then run Build Runtime again.')
}
$linked = 0; $kept = 0; $busy = @()
foreach ($f in Get-ChildItem $donor -Recurse -File) {
  $rel = $f.FullName.Substring($donor.Length).TrimStart('\')
  if ($rel -like 'resources\app\*' -or $f.Extension -eq '.scr') { continue }
  if ($f.Name -eq $donorExe -and $rel -eq $donorExe) { $rel = 'Temporal Live.exe' }
  $target = Join-Path $runtime $rel
  $dir = Split-Path -Parent $target
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  if (Test-Path $target) {
    $t = Get-Item $target
    if ($t.LinkType -eq 'HardLink') { $kept++; continue }          # already shared
    if ($t.Length -ne $f.Length -or (Get-FileHash $target).Hash -ne (Get-FileHash $f.FullName).Hash) {
      Write-Host ('  differs from Temporal Matrix, left as its own copy: ' + $rel); continue
    }
    # An identical copy: replace it with a link. A file another program has
    # open (an antivirus scan, the search indexer) is left as it is this time;
    # the app works either way, and the next build tries again.
    try { Remove-Item $target -Force -ErrorAction Stop }
    catch { $busy += $rel; continue }
  }
  Link-Or-Copy $target $f.FullName
  $linked++
}
if ($linked) { Write-Host ("Electron shared with Temporal Matrix: $linked file(s) linked, $kept already shared.") }
if ($busy.Count) { Write-Host ('  in use by another program, left as a copy for now: ' + ($busy -join ', ')) }

# Temporal Live is no longer a screensaver. If Windows still has it registered
# as one, put back what was set before it (or turn the screensaver off), then
# remove the .scr copy. Nothing is changed if Temporal Live is not registered.
$key = 'HKCU:\Control Panel\Desktop'
$current = (Get-ItemProperty -Path $key -Name 'SCRNSAVE.EXE' -ErrorAction SilentlyContinue).'SCRNSAVE.EXE'
if ($current -and $current -like '*Temporal Live.scr') {
  $store = Join-Path $env:APPDATA 'Science Coherence\Temporal Live\previous-screensaver.json'
  if (Test-Path $store) {
    $saved = Get-Content $store -Raw | ConvertFrom-Json
    Set-ItemProperty -Path $key -Name 'SCRNSAVE.EXE' -Value $saved.previous
    Remove-Item $store
    Write-Host ('Screensaver restored to ' + $saved.previous)
  } else {
    Remove-ItemProperty -Path $key -Name 'SCRNSAVE.EXE' -ErrorAction SilentlyContinue
    Set-ItemProperty -Path $key -Name 'ScreenSaveActive' -Value '0'
    Write-Host 'Temporal Live was the screensaver; the screensaver is now off.'
  }
}
Get-ChildItem $runtime -Filter '*.scr' -ErrorAction SilentlyContinue | Remove-Item -Force

$app = Join-Path $runtime 'resources\app'
Write-Host 'Placing the Temporal Live source into the runtime...'
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
New-Item -ItemType Directory -Path $app -Force | Out-Null
Copy-Item (Join-Path $source '*') $app -Recurse -Force

Write-Host ''
$version = (Get-Content (Join-Path $source 'package.json') -Raw | ConvertFrom-Json).version
Write-Host ('Done. Singularity Monitor ' + $version + ' (see CHANGELOG.md).')
Write-Host ('  App: ' + (Join-Path $runtime 'Temporal Live.exe'))
Write-Host 'Opening it is one key away (or run Open App.cmd later).'
