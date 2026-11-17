# syntax=docker/dockerfile:1

# Imagen del back de Galpón Mates (NestJS). El contexto es la carpeta `backend`.
# La usa `deploy/docker-compose.yml`, con dos etapas:
#
#   - `runtime` (la última, la del servicio `api`): `dist` y las dependencias de producción. Al
#     arrancar aplica las migraciones pendientes (`npx prisma migrate deploy`) y levanta la API.
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
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# `prepare` instala los hooks de git (lefthook) y en la imagen no hay repositorio: se quita.
# `postinstall` sí corre: genera el cliente de Prisma en `src/generated/prisma`.
RUN npm pkg delete scripts.prepare && npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Las mismas dependencias sin las de desarrollo, para copiarlas a la imagen final.
FROM tools AS prune
RUN npm prune --omit=dev --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prune --chown=node:node /app/package.json /app/prisma.config.ts ./
COPY --from=prune --chown=node:node /app/node_modules ./node_modules
COPY --from=prune --chown=node:node /app/prisma ./prisma
COPY --from=prune --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
# `exec` deja a Node como proceso principal: recibe el SIGTERM de `docker stop` y cierra ordenado.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main"]
