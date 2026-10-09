$src = "C:\Users\admin\Desktop\Glorious managment\frontend\src"
Set-StrictMode -Off
Write-Host "== every place GENDER_OPTIONS is REFERENCED (not just defined) =="
Get-ChildItem -LiteralPath $src -Recurse -File -Include *.jsx | ForEach-Object {
  $f = $_
  $n = 0
  foreach ($line in Get-Content -LiteralPath $f.FullName) {
    $n++
    if ($line -match 'GENDER_OPTIONS' -and $line -notmatch 'const GENDER_OPTIONS|const GENDER_OPTIONS =') {
      "{0}:{1}: {2}" -f $f.Name, $n, $line.Trim()
    }
  }
}
Write-Host ""
Write-Host "== also any inline gender <select> that lists an 'other'/'prefer_not_to_say' option (label = gender) =="
Get-ChildItem -LiteralPath $src -Recurse -File -Include *.jsx | ForEach-Object {
  $f = $_
  $t = Get-Content -Raw -LiteralPath $f.FullName
  if ($t -match 'Prefer not to say') { "GENDER-ish inline in {0}" -f $f.Name }
}
