import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

/**
 * Tests unitarios (`npm test`): los `*.spec.ts` de `src/` y el test de fronteras de
 * `test/lint/` (ESLint por API), sin red, base ni Docker.
 *
 * `unplugin-swc` compila con SWC para que los decoradores de Nest emitan su metadata
 * (`emitDecoratorMetadata`), que el compilador por defecto de Vite no genera.
 */
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.spec.ts', 'test/lint/**/*.spec.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
})
