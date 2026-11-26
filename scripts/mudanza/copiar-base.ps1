# Copia la base de produccion (Render) a esta compu y comprueba, tabla por tabla, que la copia
# quedo igual a la original. No modifica nada en Render: solo lee.
#
# Uso, desde la carpeta del back:
#   powershell -ExecutionPolicy Bypass -File scripts\mudanza\copiar-base.ps1
#
# Pide la External Database URL de la base ORIGEN (Render > la base > Connect > External) sin
# mostrarla en pantalla. Deja en C:\galpon-copia:
#   galpon-AAAAMMDD-HHMM.dump          la copia (formato de pg_dump, se carga con restaurar-base.ps1)
#   galpon-AAAAMMDD-HHMM.conteo.txt    cuantas filas tiene cada tabla y de que servidor salio
#
# La copia tiene datos de clientes: no se sube a ningun lado ni se guarda en el repo.
param(
  [string]$Carpeta = 'C:\galpon-copia',
  # Solo para ensayar contra una base local: en produccion se deja vacio y el script pregunta.
  [string]$UrlDePrueba = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comun.ps1')

Exigir-Docker
$url = if ($UrlDePrueba) { $UrlDePrueba } else { Leer-Secreto 'Pega la External Database URL de la base ORIGEN (no se va a ver) y Enter' }
$servidor = Servidor-De $url

New-Item -ItemType Directory -Force $Carpeta | Out-Null
Escribir-Conteo $Carpeta
$nombre = 'galpon-' + (Get-Date -Format 'yyyyMMdd-HHmm')
$archivo = "$nombre.dump"

Write-Host ''
Write-Host "1/3  Copiando la base de $servidor ..."
# Sin --schema=public (lo que sugiere la guia general de Render): con esa opcion, pg_restore --clean
# intenta borrar el esquema public y falla, porque la extension citext vive ahi (ensayado).
docker run --rm -v "${Carpeta}:/copia" $ImagenPostgres pg_dump $url --format=custom --no-owner --no-privileges "--file=/copia/$archivo"
if ($LASTEXITCODE -ne 0) { Fallar 'pg_dump fallo: la copia NO esta hecha. Mandale a Claude lo que salio arriba (no tiene la clave).' }
$peso = (Get-Item (Join-Path $Carpeta $archivo)).Length
if ($peso -lt 10000) { Fallar "La copia pesa $peso bytes: es demasiado chica para ser la base entera." }

Write-Host '2/3  Contando las filas de la base original ...'
$origen = Contar-Remota $url $Carpeta

Write-Host '3/3  Cargando la copia en una base de prueba de esta compu para comprobarla ...'
$contenedor = "galpon-verif-$PID"
docker run -d --name $contenedor -e POSTGRES_USER=galpon -e POSTGRES_PASSWORD=verif -e POSTGRES_DB=galpon -v "${Carpeta}:/copia" $ImagenPostgres | Out-Null
if ($LASTEXITCODE -ne 0) { Fallar 'No pude crear la base de prueba en Docker: la copia NO esta comprobada.' }
try {
  $lista = $false
  foreach ($i in 1..60) {
    Callado { docker exec $contenedor pg_isready -U galpon -d galpon -h 127.0.0.1 }
    if ($LASTEXITCODE -eq 0) { $lista = $true; break }
    Start-Sleep -Milliseconds 1000
  }
  if (-not $lista) { Fallar 'La base de prueba no arranco.' }
  docker exec $contenedor pg_restore --no-owner --no-privileges --exit-on-error -U galpon -d galpon "/copia/$archivo"
  if ($LASTEXITCODE -ne 0) { Fallar 'La copia no se pudo cargar en la base de prueba: NO sirve. Mandale a Claude lo que salio arriba.' }
  $salida = docker exec $contenedor psql -U galpon -d galpon -At -v ON_ERROR_STOP=1 -f /copia/conteo.sql
  if ($LASTEXITCODE -ne 0) { Fallar 'No pude contar las filas de la copia: NO esta comprobada.' }
  $copia = @($salida | Where-Object { $_ -match '=' })
}
finally {
  # -v borra tambien el volumen de la base de prueba: adentro hay datos de clientes.
  Callado { docker rm -f -v $contenedor }
}
if ($copia.Count -eq 0 -or $origen.Count -eq 0) { Fallar 'El conteo vino vacio: la copia NO esta comprobada.' }

$informe = @("origen-servidor=$servidor", "archivo=$archivo", "bytes=$peso", "fecha=$(Get-Date -Format 'yyyy-MM-dd HH:mm')", '--- filas por tabla en la copia ---') + $copia
Set-Content -Path (Join-Path $Carpeta "$nombre.conteo.txt") -Value $informe -Encoding ASCII

Write-Host ''
Write-Host 'Filas por tabla en la copia:'
$copia | ForEach-Object { Write-Host "   $_" }
Write-Host ''
$dif = Comparar-Conteos $origen $copia
if ($dif.Count -eq 0) {
  Bien "COPIA COMPLETA Y COMPROBADA: $($copia.Count) tablas, todas con la misma cantidad de filas que la original."
} else {
  Aviso 'La copia se hizo, pero estas tablas cambiaron en la original mientras se copiaba (original -> copia):'
  $dif | ForEach-Object { Aviso "   $_" }
  Aviso 'Si son tablas de registro (audit_logs, outbox_events, webhook_events, idempotency_keys) es normal. Mandale captura a Claude.'
}
Write-Host "Archivo: $(Join-Path $Carpeta $archivo)  ($([math]::Round($peso / 1KB)) KB)"
