// @ts-check
/**
 * Verifica que el `package.json` del back use las versiones fijadas en
 * `scripts/dependency-versions.json`, la fuente única de versiones del repo.
 *
 * Ejecutado directo (`npm run lint` lo corre) revisa el `package.json` de la raíz, imprime los
 * problemas y sale con 1 si encuentra alguno; si no, confirma que lo revisó.
 *
 * Mismo patrón que `scripts/check-dependency-versions.mjs` del front, adaptado a un solo
 * `package.json` (el back no es un workspace).
 *
 * @module
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Secciones de un `package.json` que se revisan. */
const SECTIONS = /** @type {const} */ (['dependencies', 'devDependencies', 'peerDependencies'])

/**
 * Busca dependencias que se desvían de las versiones fijadas.
 *
 * Reglas: cada paquete tiene que estar en `dependency-versions.json`, con la versión exacta en
 * `dependencies` y `devDependencies` y con `^` más esa versión en `peerDependencies`.
 *
 * @param {{ path: string, json: object }} manifest - El `package.json` con su ruta relativa a la raíz.
 * @param {Record<string, string>} versions - Versiones fijadas, por nombre de paquete.
 * @returns {string[]} Un mensaje en español por problema; vacío si todo coincide.
 */
export function findVersionProblems(manifest, versions) {
  /** @type {string[]} */
  const problems = []
  const { path, json } = manifest
  for (const section of SECTIONS) {
    const declared = /** @type {Record<string, string> | undefined} */ (
      /** @type {Record<string, unknown>} */ (json)[section]
    )
    for (const [name, range] of Object.entries(declared ?? {})) {
      const pinned = versions[name]
      if (pinned === undefined) {
        problems.push(`${path}: "${name}" no está en scripts/dependency-versions.json`)
        continue
      }
      const expected = section === 'peerDependencies' ? `^${pinned}` : pinned
      if (range !== expected) {
        problems.push(`${path}: "${name}" declara "${range}" y la versión fijada es "${expected}"`)
      }
    }
  }
  return problems
}

/** Error de un archivo que no es JSON válido; su mensaje ya está listo para mostrarse. */
class InvalidJsonError extends Error {}

/**
 * Lee y parsea un archivo JSON del repo.
 *
 * @param {string} root - Carpeta raíz del repo.
 * @param {string} path - Ruta del archivo relativa a la raíz, con `/` (es la que se muestra).
 * @returns {object} El contenido ya parseado, siempre un objeto.
 * @throws {InvalidJsonError} Si el archivo no es JSON válido o no es un objeto (`null`, un arreglo
 *   o un valor suelto): `<ruta>: JSON inválido (<motivo>)`.
 */
function readJson(root, path) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(join(root, path), 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new InvalidJsonError(`${path}: JSON inválido (${error.message})`, { cause: error })
    }
    throw error
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidJsonError(`${path}: JSON inválido (se esperaba un objeto)`)
  }
  return parsed
}

/**
 * Indica si este archivo es el punto de entrada de `node` (y no un import, como en los tests).
 *
 * Compara las rutas reales de los dos lados: Node resuelve los enlaces del punto de entrada y
 * `process.argv[1]` llega sin resolver, así que invocado por una junction o un symlink el
 * chequeo no correría y el proceso saldría con 0 sin revisar nada.
 *
 * @returns {boolean} `true` si se ejecutó con `node scripts/check-dependency-versions.mjs`.
 */
function isEntryPoint() {
  const entry = process.argv[1]
  if (entry === undefined || !existsSync(entry)) return false
  return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
}

if (isEntryPoint()) {
  try {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const versions = /** @type {Record<string, string>} */ (
      readJson(root, 'scripts/dependency-versions.json')
    )
    const manifest = { path: 'package.json', json: readJson(root, 'package.json') }
    const problems = findVersionProblems(manifest, versions)
    if (problems.length > 0) {
      const list = problems.map((problem) => `  - ${problem}\n`).join('')
      process.stderr.write(
        `Versiones de dependencias que no coinciden con scripts/dependency-versions.json:\n${list}`,
      )
      process.exitCode = 1
    } else {
      // Confirma que el chequeo corrió: un guard que no corre también saldría con 0.
      process.stdout.write(
        'Las versiones de package.json coinciden con scripts/dependency-versions.json.\n',
      )
    }
  } catch (error) {
    // Un JSON roto es un problema del repo, no un fallo del script: se informa sin traza.
    if (!(error instanceof InvalidJsonError)) throw error
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
