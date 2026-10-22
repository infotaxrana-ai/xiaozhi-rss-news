
$ErrorActionPreference = "Stop"

$root = "C:\Users\Rana\OneDrive\Desktop\xiaozhi-esp32-music"
$dir = Join-Path $root "NEWS_RADIO_V37"
New-Item -ItemType Directory -Path $dir -Force | Out-Null

$sourceUrl = "https://raw.githubusercontent.com/infotaxrana-ai/xiaozhi-rss-news/main/index.js"
$original = Join-Path $dir "index_v36_backup.js"
$output = Join-Path $dir "index.js"

Write-Host "=== NEWS RADIO v3.7 ===" -ForegroundColor Cyan

Invoke-WebRequest -Uri $sourceUrl -OutFile $original -UseBasicParsing

$text = [IO.File]::ReadAllText($original)

$checks = @(
    'const AUTO_DELAY_MS = 2000;',
    'function newsResponse(text, done = false)',
    '    text,',
    '    suggestedDelayMs: hasMore',
    '              suggested_delay_ms:'
)

foreach ($item in $checks) {
    if (!$text.Contains($item)) {
        throw "Unexpected index.js structure: $item"
    }
}

if ($text.Contains('NEWS_STOP_WINDOW_V37')) {
    throw "Stop window already installed."
}

# Version and suggested interval
$text = $text.Replace(
    'const VERSION = "3.6.0";',
    'const VERSION = "3.7.0";'
)

$text = $text.Replace(
    'const AUTO_DELAY_MS = 2000;',
    'const AUTO_DELAY_MS = 5000;'
)

# Add spoken stop announcement only when more news exists
$old = @'
  return {
    text,
    hasMore,
'@

$new = @'
  // NEWS_STOP_WINDOW_V37
  // Spoken cue only. Real microphone control
  // must be implemented by the Xiaozhi runtime.
  const spokenText = hasMore
    ? text.trim() +
      " রানা ভাই, সংবাদ বন্ধ করতে স্টপ বলুন।"
    : text;

  return {
    text: spokenText,
    hasMore,
'@

if (!$text.Contains($old)) {
    throw "newsResponse insertion point not found."
}

$text = $text.Replace($old, $new)

# Add optional command-window metadata
$oldMeta = @'
              suggested_delay_ms:
                output.suggestedDelayMs,
'@

$newMeta = @'
              suggested_delay_ms:
                output.suggestedDelayMs,
              listening_window_ms:
                output.hasMore ? 5000 : 0,
              requires_listening_window:
                output.hasMore,
'@

if (!$text.Contains($oldMeta)) {
    throw "Metadata insertion point not found."
}

$text = $text.Replace($oldMeta, $newMeta)

# Keep displayed health metadata consistent
$text = $text.Replace(
    'suggested_pause_ms: AUTO_DELAY_MS,',
    'suggested_pause_ms: AUTO_DELAY_MS,'
)

if (!$text.Contains("NEWS_STOP_WINDOW_V37")) {
    throw "Patch verification failed."
}

$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($output, $text, $utf8)

$node = Get-Command node.exe -ErrorAction SilentlyContinue

if ($node) {
    & $node.Source --check $output
    if ($LASTEXITCODE -ne 0) {
        throw "JavaScript syntax check failed."
    }
    Write-Host "NODE SYNTAX: PASSED" -ForegroundColor Green
} else {
    Write-Host "Node.js not available; syntax not verified." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "NEWS RADIO v3.7 FILE CREATED" -ForegroundColor Green
Write-Host "Edited file: $output"
Write-Host "Backup: $original"
Write-Host "GitHub changed: NO"
Write-Host "ESP32 firmware changed: NO"
