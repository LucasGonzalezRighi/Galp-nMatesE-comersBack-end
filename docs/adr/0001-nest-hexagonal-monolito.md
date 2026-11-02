# ADR 0001 · Monolito modular en NestJS con arquitectura hexagonal

- **Estado:** aceptada (Lucas, 2026-10-20; aplicada en B1 y B2, 2026-11-02).
- **Spec:** [`docs/superpowers/specs/2026-10-20-galpon-backend-design.md`](../superpowers/specs/2026-10-20-galpon-backend-design.md) §1, §2 y §3.

## Contexto

La API sostiene la tienda y el dashboard de Galpón Mates, una tienda chica que se usa todos los
días. Tiene que ser fácil de operar (un servicio, Postgres y Redis), correcta con el dinero y
desacoplada de los proveedores: cambiar Mercado Pago por Stripe, Prisma por otro ORM o Redis por
otra caché no debería tocar las reglas del negocio. El front ya fija el contrato (`openapi.yaml`)
y el equipo es una sola persona.

## Decisión

1. **Un solo servicio NestJS 12** (monolito modular): un módulo por área de negocio en
   `src/modules/<módulo>/` (`catalog`, `content`, `reviews`, `settings`, `health` en B2) y lo
   transversal en `src/shared/`. Nada de microservicios ni colas entre servicios.
2. **Cuatro capas por módulo** (puertos y adaptadores):
   - `domain/`: entidades, value objects y reglas en TypeScript puro. Solo puede importar otro
     `domain` y el paquete `uuid` (ids v7).
   - `application/`: casos de uso (queries y, desde B3, commands) y los **puertos** que necesitan
     (interfaces + token `Symbol`). Solo importa `domain` y `application`: **ni siquiera
     `@nestjs/*`**, así que los casos de uso no llevan `@Injectable()`.
   - `infrastructure/`: adaptadores que implementan los puertos (Prisma, Redis, caché, adaptadores
     entre módulos).
   - `interface/`: controladores REST y DTOs (Swagger, `class-validator`). Llaman a `application`
     y solo pueden usar la infraestructura **compartida** (`src/shared/infrastructure`: filtro de
     errores, paginación, decoradores), nunca la de su propio módulo.
3. **El cableado vive en el `*.module.ts`** de cada módulo, fuera de las capas: registra los
   adaptadores con `useClass` y los casos de uso con `useFactory` + `inject` de los tokens.
4. **La regla la vigila ESLint** con `eslint-plugin-boundaries` 7 (`boundaries/dependencies`,
   con `checkAllOrigins` y `checkUnknownLocals`, así también se revisan paquetes externos, módulos
   de Node y archivos locales sin capa). `npm run lint` falla ante una violación y
   `test/lint/boundaries.spec.ts` prueba que `domain` → `@prisma/client` da error.
5. **El contrato del front manda:** el Swagger que genera Nest se compara, normalizado, con
   `../frontend/docs/api/openapi.yaml` (`npm run contract:check`).

## Consecuencias

- El dominio y los casos de uso se prueban sin Nest ni base (dobles en memoria de los puertos);
  los adaptadores Prisma, contra Postgres real con Testcontainers.
- Hay más archivos y algo de ceremonia (token + interfaz + `useFactory` por caso de uso). Es el
  precio aceptado por poder cambiar un proveedor escribiendo un adaptador nuevo.
- Las lecturas entre módulos pasan por puertos con adaptadores (por ejemplo, `catalog` lee el IVA
  de `settings` con `SettingsPriceDisplayAdapter`). Para no crear ciclos, un repositorio puede
  leer otra tabla directamente cuando es solo lectura (el rating de los productos sale de
  `reviews` dentro del repo del catálogo, spec §3.2).
- Operación simple: un proceso, Postgres y Redis; escala vertical primero.

## Alternativas descartadas

- **Microservicios:** sobrecarga de operación y de consistencia para una tienda chica (spec §12).
- **Capas "planas" de Nest (controller → service → Prisma):** acopla el negocio a Prisma y a Nest,
  y hace más caro cambiar de proveedor de pagos.
- **`dependency-cruiser` en CI** en vez de ESLint: la regla ya corre en `npm run lint` y en el
  hook de pre-commit, sin otra herramienta.
