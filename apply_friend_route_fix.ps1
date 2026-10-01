$ErrorActionPreference = "Stop"

$projectRoot = (Get-Location).Path

$oldPath = Join-Path $projectRoot "app\api\friends\[friendshipId]"
if (Test-Path -LiteralPath $oldPath) {
    Write-Host "Removing conflicting route folder: $oldPath"
    Remove-Item -LiteralPath $oldPath -Recurse -Force
}

Write-Host ""
Write-Host "Conflict folder removed."
Write-Host "Correct routes should now be under:"
Write-Host "  app\api\friends\[id]\accept\route.ts"
Write-Host "  app\api\friends\[id]\reject\route.ts"
Write-Host ""
Write-Host "Next:"
Write-Host "  npm run build"
