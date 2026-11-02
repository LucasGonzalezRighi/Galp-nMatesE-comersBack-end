// Muestra el diff legible entre el contrato del front (`openapi.yaml`) y el Swagger que genera el
// back para una ruta, con todos sus métodos:
//
//   node scripts/openapi-diff.mjs /products
//   node scripts/openapi-diff.mjs products/{slug}       (sin la barra inicial también vale)
//
// Corre el test de contrato (`test/contract/openapi.contract.spec.ts`, filtrado a "diff de una
// ruta") porque armar la app de Nest necesita la metadata de decoradores que emite SWC en vitest.
// No necesita Docker. `CONTRACT_PATH` cambia la ubicación del contrato, igual que en el test.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const usage = 'Uso: node scripts/openapi-diff.mjs /products (ruta relativa a /api/v1)\n'
const input = process.argv[2]

if (input === undefined || input.trim() === '') {
  process.stderr.write(usage)
  process.exit(1)
}
// Git Bash (MSYS) convierte `/products` en `C:/Program Files/Git/products` antes de llegar acá.
if (/^[A-Za-z]:[\\/]/.test(input)) {
  process.stderr.write(
    `La ruta llegó como "${input}" (Git Bash la convirtió en una ruta de Windows).\n` +
      'Pasala sin la barra inicial (products) o con MSYS_NO_PATHCONV=1 adelante.\n',
  )
  process.exit(1)
}

const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs')
if (!existsSync(vitest)) {
  process.stderr.write('No se encontró vitest en node_modules: corré npm install primero.\n')
  process.exit(1)
}

const path = input.startsWith('/') ? input : `/${input}`
const result = spawnSync(
  process.execPath,
  [
    vitest,
    'run',
    '-c',
    'vitest.e2e.config.mts',
    'test/contract/openapi.contract.spec.ts',
    '-t',
    'diff de una ruta',
    '--silent=false',
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, OPENAPI_DIFF_PATH: path } },
)
process.exitCode = result.status ?? 1
