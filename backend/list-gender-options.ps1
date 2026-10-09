$src = "C:\Users\admin\Desktop\Glorious managment\frontend\src"
Write-Host "== lines rendering gender <option> values (male/female/other/prefer_not_to_say) in ALL jsx =="
Get-ChildItem -LiteralPath $src -Recurse -File -Include *.jsx | ForEach-Object {
  $file = $_
  $n = 0
  Get-Content -LiteralPath $file.FullName | ForEach-Object {
    $n++
    if ($_ -match "<option" -and $_ -match "(male|female|other|prefer_not_to_say)") {
      "{0}:{1}: {2}" -f $file.Name, $n, $_.Trim()
    }
  }
}
