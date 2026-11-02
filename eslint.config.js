// @ts-check
// El paquete es CommonJS (sin "type": "module"), así que esta config usa `require`.
const js = require('@eslint/js')
const prettier = require('eslint-config-prettier')
const boundaries = require('eslint-plugin-boundaries')
const { defineConfig, globalIgnores } = require('eslint/config')
const tseslint = require('typescript-eslint')

/** Globals de Node para los archivos JavaScript sueltos (configs y scripts). */
const nodeGlobals = {
  __dirname: 'readonly',
  __filename: 'readonly',
  console: 'readonly',
  module: 'writable',
  process: 'readonly',
  require: 'readonly',
  URL: 'readonly',
}

/** Capas de cada módulo (spec §3.1), en `src/modules/<módulo>/` y en `src/shared/`. */
const LAYERS = ['domain', 'application', 'infrastructure', 'interface']

/** Paquetes externos que `domain` puede usar: funciones puras, sin framework ni I/O. */
const DOMAIN_EXTERNALS = ['uuid']

module.exports = defineConfig(
  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**']),
  {
    files: ['**/*.{ts,mts,js,mjs}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      'no-console': 'error',
      // Los módulos de Nest son clases vacías con decorador (`@Module({...}) class X {}`).
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: nodeGlobals },
  },
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Fronteras hexagonales (spec §3.1): `domain` no importa nada externo; `application` solo
    // `domain` (y define los puertos); `infrastructure` implementa los puertos; `interface` llama
    // a `application`. Nest conecta puertos y adaptadores en el `*.module.ts` de cada módulo, que
    // queda fuera de las capas y puede importar cualquiera de ellas.
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': __dirname,
      'import/resolver': { node: { extensions: ['.ts', '.js', '.json'] } },
      'boundaries/elements': LAYERS.flatMap((layer) => [
        { type: layer, pattern: `src/modules/*/${layer}`, capture: ['module'] },
        { type: layer, pattern: `src/shared/${layer}` },
      ]),
      'boundaries/files': [{ pattern: '**/*.spec.ts', category: 'test' }],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          // Revisa también paquetes externos y módulos de Node, y los archivos locales que no
          // son de ninguna capa (por ejemplo `src/config`), para que nada se cuele por ahí.
          checkAllOrigins: true,
          checkUnknownLocals: true,
          message:
            'La capa {{ from.element.types.[0] }} no puede importar "{{ dependency.source }}": domain no importa nada externo, application solo domain, infrastructure implementa los puertos e interface llama a application (spec §3.1).',
          policies: [
            {
              from: { element: { type: 'domain' } },
              allow: [
                { to: { element: { type: 'domain' } } },
                { to: { module: { origin: 'external', source: DOMAIN_EXTERNALS } } },
              ],
            },
            {
              from: { element: { type: 'application' } },
              allow: { to: { element: { type: ['domain', 'application'] } } },
            },
            {
              from: { element: { type: 'infrastructure' } },
              allow: [
                { to: { element: { type: ['domain', 'application', 'infrastructure'] } } },
                { to: { element: { isUnknown: true } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { element: { type: 'interface' } },
              allow: [
                { to: { element: { type: ['domain', 'application', 'interface'] } } },
                // Solo la infraestructura compartida (filtros, DTOs de paginación, decoradores).
                { to: { element: { type: 'infrastructure', path: 'src/shared/infrastructure' } } },
                { to: { element: { isUnknown: true } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              // Los tests de cada capa pueden usar vitest, dobles y fixtures.
              from: { file: { categories: 'test' } },
              allow: { to: { module: { origin: ['local', 'external', 'core'] } } },
            },
          ],
        },
      ],
    },
  },
  prettier,
)
