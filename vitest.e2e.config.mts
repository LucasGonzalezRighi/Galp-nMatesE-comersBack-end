import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

/**
 * Tests E2E y de contrato (`npm run test:e2e`): HTTP con supertest contra la app armada como en
 * `main.ts` y, cuando hagan falta, Postgres y Redis reales con Testcontainers.
 *
 * Corren de a un archivo (`fileParallelism: false`) porque comparten Docker y levantar
 * contenedores puede tardar: por eso el `testTimeout` de dos minutos.
 */
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.e2e-spec.ts', 'test/contract/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
