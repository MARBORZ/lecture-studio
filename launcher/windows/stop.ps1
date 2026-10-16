# Stop Lecture Studio from a terminal — same rules as the sidebar power button:
# refuses while anything is processing, uploading or exporting.
#   powershell -ExecutionPolicy Bypass -File launcher\windows\stop.ps1

. (Join-Path $PSScriptRoot 'common.ps1')
try {
    $null = Invoke-RestMethod -Method Post -Uri "$ApiUrl/api/system/shutdown" -TimeoutSec 5
    Write-Host (L 'Lecture Studio останавливается.' 'Lecture Studio is shutting down.')
} catch {
    $resp = $_.Exception.Response
    if ($resp -and [int]$resp.StatusCode -eq 409) {
        Write-Host (L 'Нельзя остановить — система занята:' 'Cannot shut down — the app is busy:')
        Write-Host $_.ErrorDetails.Message
        exit 1
    }
    Write-Host (L 'API не отвечает: останавливаю то, что слушает порт интерфейса (5173), если оно осталось.' 'The API does not answer: stopping whatever still listens on the interface port (5173).')
    Stop-Pids (Get-ListeningPids @($UiPort))
}
