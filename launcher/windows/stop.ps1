# Stop Lecture Studio from a terminal — same rules as the sidebar power button:
# refuses while anything is processing, uploading or exporting.
#   powershell -ExecutionPolicy Bypass -File launcher\windows\stop.ps1

. (Join-Path $PSScriptRoot 'common.ps1')
try {
    $null = Invoke-RestMethod -Method Post -Uri "$ApiUrl/api/system/shutdown" -TimeoutSec 5
    Write-Host 'Lecture Studio останавливается.'
} catch {
    $resp = $_.Exception.Response
    if ($resp -and [int]$resp.StatusCode -eq 409) {
        Write-Host 'Нельзя остановить — система занята:'
        Write-Host $_.ErrorDetails.Message
        exit 1
    }
    Write-Host 'API не отвечает: останавливаю интерфейс (5173), если он остался.'
    Stop-Pids (Get-ListeningPids @($UiPort))
}
