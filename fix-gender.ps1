$root = "C:\Users\admin\Desktop\Glorious managment\frontend\src"
$targets = @(
  (Join-Path $root "pages\Dashboard.jsx"),
  (Join-Path $root "components\EditEmployeeModal.jsx"),
  (Join-Path $root "components\EditProfileModal.jsx")
)

$maleFem = @(
  "const GENDER_OPTIONS = [",
  "  { value: 'female', label: 'Female' },",
  "  { value: 'male', label: 'Male' },",
  "];"
)

function RewriteGenderArray($file) {
  $lines = Get-Content -LiteralPath $file
  $start = -1
  $end = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^const GENDER_OPTIONS\s*=\s*\[\s*$') { $start = $i; $end = $i; for ($k = $i; $k -lt $lines.Count; $k++) { if ($lines[$k] -match '^\];\s*$') { $end = $k; break } }; break }
  }
  if ($start -lt 0) { Write-Output "SKIP (no GENDER_OPTIONS block): $file"; return }
  $new = @()
  for ($i = 0; $i -lt $start; $i++) { $new += $lines[$i] }
  foreach ($l in $maleFem) { $new += $l }
  for ($i = $end + 1; $i -lt $lines.Count; $i++) { $new += $lines[$i] }
  Set-Content -LiteralPath $file -Value $new -Encoding UTF8
  Write-Output "REPLACED gender array: $file"
}

foreach ($t in $targets) { if (Test-Path -LiteralPath $t) { RewriteGenderArray $t } else { Write-Output "MISSING: $t" } }
Write-Output "== verify =="
foreach ($t in $targets) {
  $c = Get-Content -LiteralPath $t
  for ($i = 0; $i -lt $c.Count; $i++) {
    if ($c[$i] -match '^const GENDER_OPTIONS\s*=\s*\[\s*$') {
      Write-Output "--- $t"
      for ($k = $i; $k -lt $c.Count; $k++) { if ($c[$k] -match '^\];') { for ($j = $i; $j -le $k; $j++) { Write-Output $c[$j] }; break } }
      break
    }
  }
}
