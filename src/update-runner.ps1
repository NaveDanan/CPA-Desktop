$ErrorActionPreference = 'Stop'
trap {
  # Preserve startup failures for the app before it removes the failed job.
  try { [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'helper.log'), $_.ToString()) } catch {}
  exit 1
}
$jobDir = $PSScriptRoot
$job = Get-Content -LiteralPath (Join-Path $jobDir 'job.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$cacheDir = [IO.Path]::GetFullPath($job.cacheDir).TrimEnd('\')
$targetDir = [IO.Path]::GetFullPath($job.directory).TrimEnd('\')

# Limit all deletion to the app-owned, immediate temporary job directory.
if ($targetDir -ne $jobDir.TrimEnd('\') -or
    [IO.Path]::GetDirectoryName($targetDir) -ne $cacheDir -or
    [IO.Path]::GetFileName($targetDir) -notmatch '^update-[A-Za-z0-9]+$' -or
    [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($job.installer)) -ne $targetDir) {
  throw 'Invalid update job paths.'
}
if ((Get-Item -LiteralPath $targetDir).Attributes -band [IO.FileAttributes]::ReparsePoint) {
  throw 'The update directory cannot be a link.'
}

function Write-ResultJson($file, $value) {
  # Windows PowerShell's Set-Content -Encoding UTF8 adds a BOM that JSON.parse rejects.
  [IO.File]::WriteAllText($file, ($value | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}

function Get-InstallerHash {
  $stream = [IO.File]::OpenRead($job.installer)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $hash.Dispose() }
}

function Quote-Argument([string]$value) {
  $escaped = [regex]::Replace($value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

if ((Get-InstallerHash) -ne $job.sha256) { throw 'Installer checksum mismatch.' }
Write-ResultJson (Join-Path $jobDir 'ready.json') @{ pid = $PID }

$success = $false
$message = ''
try {
  $parent = Get-Process -Id $job.parentPid -ErrorAction SilentlyContinue
  if ($parent) { $parent | Wait-Process }
  # The parent has already stopped its proxy and released its instance lock.
  if ((Get-InstallerHash) -ne $job.sha256) { throw 'Installer checksum mismatch.' }
  $installer = Start-Process -FilePath $job.installer -ArgumentList @('/S', '--updated') -WindowStyle Hidden -Wait -PassThru
  if ($installer.ExitCode -ne 0) { throw ('Installer exited with code ' + $installer.ExitCode) }
  $success = $true
} catch {
  $message = $_.Exception.Message
} finally {
  Write-ResultJson (Join-Path $cacheDir 'last-install.json') @{ version = $job.version; success = $success; error = $message }
  # Antivirus may briefly retain a handle after the installer exits.
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try { Remove-Item -LiteralPath $targetDir -Recurse -Force; break }
    catch { Start-Sleep -Milliseconds 250 }
  }
  # If cleanup was interrupted, the next app startup removes this job.
  if (Test-Path -LiteralPath $job.appPath) {
    $restartArgs = @($job.restartArgs | ForEach-Object { Quote-Argument $_ })
    Start-Process -FilePath $job.appPath -ArgumentList $restartArgs -WindowStyle Hidden
  }
}
