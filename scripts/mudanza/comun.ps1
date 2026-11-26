# Funciones compartidas por copiar-base.ps1 y restaurar-base.ps1 (mudanza de la base entre cuentas
# de Render). Solo texto ASCII: Windows PowerShell 5.1 lee los .ps1 sin BOM como ANSI.

$ImagenPostgres = 'postgres:17' # la misma version mayor que la base de Render

function Fallar([string]$mensaje) {
  Write-Host ''
  Write-Host "ERROR: $mensaje" -ForegroundColor Red
  exit 1
}

function Aviso([string]$mensaje) { Write-Host $mensaje -ForegroundColor Yellow }
function Bien([string]$mensaje) { Write-Host $mensaje -ForegroundColor Green }

# Pide un dato sin mostrarlo en pantalla ni dejarlo en el historial de PowerShell.
function Leer-Secreto([string]$texto) {
  $seguro = Read-Host $texto -AsSecureString
  $puntero = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($puntero).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($puntero) }
}

# Saca el puerto por omision y pasa a minusculas, para comparar dos servidores sin que una
# diferencia de forma (la misma base escrita con :5432 o sin puerto) los haga parecer distintos.
function Normalizar-Servidor([string]$servidor) {
  return ($servidor -replace ':5432$', '').ToLower()
}

# Devuelve el servidor (host y, si no es el 5432, puerto; sin usuario ni clave) de una direccion de
# Postgres, o falla con un mensaje claro si no es una External Database URL.
function Servidor-De([string]$url) {
  if ($url -notmatch '^postgres(ql)?://[^:/@\s]+:[^@\s]+@([^/@\s]+)/[^\s]+$') {
    Fallar 'Eso no parece una direccion de base de datos. Tiene que empezar con postgresql:// y la copias de Render: la base > Connect > External > External Database URL.'
  }
  $servidor = $Matches[2]
  if ($servidor -notmatch '\.') {
    Fallar 'Pegaste la Internal Database URL. Necesito la External (en Render: Connect > pestana External).'
  }
  return (Normalizar-Servidor $servidor)
}

# Corre un comando sin mostrar nada. Baja $ErrorActionPreference dentro de la funcion: en Windows
# PowerShell 5.1, con 'Stop', lo que un programa escribe en stderr al redirigirlo corta el script.
function Callado([scriptblock]$bloque) {
  $ErrorActionPreference = 'Continue'
  & $bloque *> $null
}

function Exigir-Docker {
  Callado { docker version --format '{{.Server.Version}}' }
  if ($LASTEXITCODE -ne 0) { Fallar 'Docker no responde. Abri Docker Desktop y espera a que diga "Engine running".' }
}

# La consulta que cuenta las filas de cada tabla. Se guarda en la carpeta de la copia para pasarsela
# a psql como archivo (asi no hay comillas que se rompan en el camino).
function Escribir-Conteo([string]$carpeta) {
  $sql = @'
select table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
'@
  Set-Content -Path (Join-Path $carpeta 'conteo.sql') -Value $sql -Encoding ASCII
}

# Cuenta las filas de cada tabla de una base remota. Devuelve lineas "tabla=cantidad".
function Contar-Remota(
  [string]$url,
  [string]$carpeta,
  [string]$siFalla = 'No pude leer la base. Revisa que la direccion sea la External Database URL completa y que tengas internet.'
) {
  $lineas = docker run --rm -v "${carpeta}:/copia" $ImagenPostgres psql $url -At -v ON_ERROR_STOP=1 -f /copia/conteo.sql
  if ($LASTEXITCODE -ne 0) { Fallar $siFalla }
  return @($lineas | Where-Object { $_ -match '=' })
}

# Devuelve las diferencias entre dos conteos como lineas "tabla: A -> B" (vacio si son iguales).
function Comparar-Conteos([string[]]$a, [string[]]$b) {
  $ta = @{}; foreach ($l in $a) { $k, $v = $l -split '=', 2; $ta[$k] = $v }
  $tb = @{}; foreach ($l in $b) { $k, $v = $l -split '=', 2; $tb[$k] = $v }
  $dif = @()
  foreach ($k in (@($ta.Keys) + @($tb.Keys) | Sort-Object -Unique)) {
    $va = if ($ta.ContainsKey($k)) { $ta[$k] } else { 'no existe' }
    $vb = if ($tb.ContainsKey($k)) { $tb[$k] } else { 'no existe' }
    if ($va -ne $vb) { $dif += "${k}: $va -> $vb" }
  }
  return $dif
}
