# Carga en la base DESTINO (la de la cuenta nueva de Render) la copia hecha con copiar-base.ps1.
# REEMPLAZA todo lo que haya en la base destino. Va en una sola transaccion: si algo falla, la
# base destino queda exactamente como estaba.
#
# Uso, desde la carpeta del back:
#   powershell -ExecutionPolicy Bypass -File scripts\mudanza\restaurar-base.ps1
#
# Pide la External Database URL de la base DESTINO sin mostrarla. Se niega a seguir si es el mismo
# servidor del que salio la copia. Al final compara las filas de cada tabla con las de la copia.
param(
  [string]$Carpeta = 'C:\galpon-copia',
  # La copia a cargar; por omision, la mas nueva de la carpeta.
  [string]$Archivo = '',
  # Solo para ensayar contra una base local: en produccion se dejan vacios y el script pregunta.
  [string]$UrlDePrueba = '',
  [switch]$SinPreguntar
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comun.ps1')

Exigir-Docker
if (-not (Test-Path $Carpeta)) { Fallar "No existe $Carpeta. Primero corre copiar-base.ps1." }
if (-not $Archivo) {
  $ultimo = Get-ChildItem $Carpeta -Filter 'galpon-*.dump' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $ultimo) { Fallar "No hay ninguna copia en $Carpeta. Primero corre copiar-base.ps1." }
  $Archivo = $ultimo.Name
}
$rutaConteo = Join-Path $Carpeta ($Archivo -replace '\.dump$', '.conteo.txt')
if (-not (Test-Path (Join-Path $Carpeta $Archivo))) { Fallar "No encuentro la copia $Archivo en $Carpeta." }
if (-not (Test-Path $rutaConteo)) { Fallar "Falta ${rutaConteo}: la copia no fue comprobada. Volve a correr copiar-base.ps1." }
$informe = Get-Content $rutaConteo
$servidorOrigen = ($informe | Where-Object { $_ -like 'origen-servidor=*' }) -replace '^origen-servidor=', ''
$esperado = @($informe | Where-Object { $_ -match '^[A-Za-z0-9_]+=\d+$' -and $_ -notlike 'bytes=*' })
if ($esperado.Count -eq 0) { Fallar "El archivo $rutaConteo no tiene el conteo de tablas. Volve a correr copiar-base.ps1." }

$url = if ($UrlDePrueba) { $UrlDePrueba } else { Leer-Secreto 'Pega la External Database URL de la base DESTINO, la de la cuenta NUEVA (no se va a ver) y Enter' }
$servidor = Servidor-De $url
if ($servidor -eq $servidorOrigen) {
  Fallar 'Esa es la base ORIGEN (la misma de la que salio la copia). Necesito la de la cuenta NUEVA.'
}

Escribir-Conteo $Carpeta
Write-Host ''
Write-Host "Copia a cargar : $Archivo  (sacada de $servidorOrigen)"
Write-Host "Base destino   : $servidor"
Write-Host ''
Write-Host 'Lo que hay hoy en la base destino (se va a REEMPLAZAR):'
$antes = Contar-Remota $url $Carpeta
if ($antes.Count -eq 0) { Write-Host '   (vacia: ninguna tabla)' } else { $antes | ForEach-Object { Write-Host "   $_" } }
Write-Host ''
if (-not ($UrlDePrueba -and $SinPreguntar)) {
  $respuesta = Read-Host 'Para reemplazar el contenido de la base destino escribi REEMPLAZAR y Enter'
  if ($respuesta -cne 'REEMPLAZAR') { Fallar 'Cancelado: no se toco nada.' }
}

Write-Host '1/2  Cargando la copia (una sola transaccion) ...'
docker run --rm -v "${Carpeta}:/copia" $ImagenPostgres pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction "--dbname=$url" "/copia/$Archivo"
if ($LASTEXITCODE -ne 0) { Fallar 'pg_restore fallo. Como va en una sola transaccion, la base destino quedo como estaba. Mandale a Claude lo que salio arriba (no tiene la clave).' }

Write-Host '2/2  Comprobando las filas de cada tabla ...'
$despues = Contar-Remota $url $Carpeta
$dif = Comparar-Conteos $esperado $despues
Write-Host ''
if ($dif.Count -eq 0) {
  Bien "BASE CARGADA Y COMPROBADA: $($despues.Count) tablas, todas con la misma cantidad de filas que la copia."
  Write-Host 'Ahora reinicia el back en Render: galpon-mates-api > Manual Deploy > Restart service.'
} else {
  Aviso 'La carga termino, pero estas tablas no coinciden con la copia (copia -> destino):'
  $dif | ForEach-Object { Aviso "   $_" }
  Aviso 'Si el back nuevo ya estaba andando, puede haber escrito algo (outbox_events, audit_logs). Mandale captura a Claude.'
}
