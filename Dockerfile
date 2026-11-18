# syntax=docker/dockerfile:1

# Imagen del back de Galpón Mates (NestJS). El contexto es la carpeta `backend`.
# La usan `deploy/docker-compose.yml` y Render, con dos etapas:
#
#   - `runtime` (la última, la del servicio `api`): `dist`, las dependencias de producción y el
#     seed y `admin:password` compilados (`dist-scripts`: acá no hay `tsx`, se corren con
#     `npm run db:seed:prod` y `npm run admin:password:prod`). Al arrancar aplica las migraciones
#     pendientes (`npx prisma migrate deploy`), con `SEED_IF_EMPTY=true` siembra la base si está
#     vacía y levanta la API.
#   - `tools` (el servicio `tools`): el proyecto entero con las dependencias de desarrollo, para
#     las tareas que se corren a mano (`npm run db:seed`, que usa `tsx`).

FROM node:22-bookworm-slim AS base
# `openssl` lo necesita el motor de migraciones de Prisma; `ca-certificates`, las conexiones TLS
# hacia Mercado Pago y el servidor de mails.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS tools
COPY package.json package-lock.json prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
# `prepare` instala los hooks de git (lefthook) y en la imagen no hay repositorio: se quita.
# `postinstall` sí corre: genera el cliente de Prisma en `src/generated/prisma`. Necesita el
# `tsconfig.json` al lado: de ahí saca la extensión de sus imports (`.js`); sin él los escribe con
# `.ts` y el back compilado no arranca.
RUN npm pkg delete scripts.prepare && npm ci --no-audit --no-fund
COPY . .
# Después de compilar se carga el cliente de Prisma compilado: si no abre, la imagen no se construye.
# `build:scripts` compila el seed y `admin:password` a `dist-scripts`, para correrlos con `node` en
# la imagen final (sin `tsx`); también se cargan acá, por lo mismo.
RUN npm run build && node -e "require('./dist/generated/prisma/client.js')" \
  && npm run build:scripts && node -e "require('./dist-scripts/prisma/admin-password.js')"

# Las mismas dependencias sin las de desarrollo, para copiarlas a la imagen final.
FROM tools AS prune
RUN npm prune --omit=dev --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prune --chown=node:node /app/package.json /app/prisma.config.ts ./
COPY --from=prune --chown=node:node /app/node_modules ./node_modules
COPY --from=prune --chown=node:node /app/prisma ./prisma
COPY --from=prune --chown=node:node /app/dist ./dist
COPY --from=prune --chown=node:node /app/dist-scripts ./dist-scripts
# La consola de Render entra por SSH con el usuario `node` y necesita su `~/.ssh` (0700 y suya).
RUN install -d -m 0700 -o node -g node /home/node/.ssh
USER node
EXPOSE 3001
# Un solo `sh -c` encadenado con `&&`: si las migraciones o el seed fallan, la API no arranca. Con
# `SEED_IF_EMPTY=true` (exacto) corre el seed con `--if-empty`: siembra solo una base sin productos
# ni admin y si no, no toca nada; es para un hosting sin consola (el plan gratis de Render).
# `exec` deja a Node como proceso principal: recibe el SIGTERM de `docker stop` y cierra ordenado.
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$SEED_IF_EMPTY\" = \"true\" ]; then node dist-scripts/prisma/seed.js --if-empty; fi && exec node dist/main"]
