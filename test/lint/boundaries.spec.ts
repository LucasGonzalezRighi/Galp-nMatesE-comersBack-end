import { ESLint, type Linter } from 'eslint'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Test negativo de las fronteras hexagonales (spec §3.1): escribe un módulo de prueba en
 * `src/modules/_lint_probe/` (nombre reservado para este test), corre ESLint por API con la misma
 * config que `npm run lint` y espera que la regla de `eslint-plugin-boundaries` rechace que
 * `domain` importe `@prisma/client`. El módulo se borra al terminar, también si el test falla.
 *
 * La regla es `boundaries/dependencies`: desde la 6 del plugin reemplaza a la vieja
 * `boundaries/element-types`, que queda como alias obsoleto.
 */

/** Raíz del repo: ESLint toma de ahí `eslint.config.js` y el plugin resuelve las capas. */
const ROOT = resolve(__dirname, '../..')
const PROBE_MODULE = join(ROOT, 'src/modules/_lint_probe')
const FORBIDDEN_FILE = join(PROBE_MODULE, 'domain/probe.ts')
const ALLOWED_FILE = join(PROBE_MODULE, 'domain/allowed.ts')
const BOUNDARIES_RULE = 'boundaries/dependencies'

/** Escribe un archivo de la sonda, creando sus carpetas. */
function writeProbe(path: string, source: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source)
}

/** Corre ESLint sobre un archivo y devuelve sus mensajes. */
async function lint(path: string): Promise<Linter.LintMessage[]> {
  const [result] = await new ESLint({ cwd: ROOT }).lintFiles([path])
  if (!result) throw new Error(`ESLint no devolvió resultados para ${path}`)
  return result.messages
}

describe('fronteras hexagonales (eslint-plugin-boundaries)', { timeout: 120_000 }, () => {
  beforeAll(() => {
    writeProbe(
      FORBIDDEN_FILE,
      "import { PrismaClient } from '@prisma/client'\n\nexport const client = PrismaClient\n",
    )
    // Control: lo que `domain` sí puede importar (otro `domain` y el paquete `uuid`).
    writeProbe(
      ALLOWED_FILE,
      "import { v7 } from 'uuid'\n\nimport { isId } from '../../../shared/domain/id'\n\nexport const valid = isId(v7())\n",
    )
  })

  afterAll(() => {
    rmSync(PROBE_MODULE, { recursive: true, force: true })
  })

  it('falla si domain importa @prisma/client', async () => {
    const messages = await lint(FORBIDDEN_FILE)

    expect(messages.filter((message) => message.fatal)).toEqual([])
    const violations = messages.filter((message) => message.ruleId === BOUNDARIES_RULE)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.severity).toBe(2)
    expect(violations[0]?.message).toContain('"@prisma/client"')
  })

  it('deja que domain importe domain y uuid', async () => {
    const messages = await lint(ALLOWED_FILE)

    expect(messages.filter((message) => message.fatal)).toEqual([])
    expect(messages.filter((message) => message.ruleId === BOUNDARIES_RULE)).toEqual([])
  })
})
