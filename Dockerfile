# fluyo-mcp — imagen para Cloud Run.
#
# Multi-stage: la etapa `build` instala TODAS las dependencias (necesita
# TypeScript, que es devDependency) y compila; la etapa final parte de una
# imagen limpia y solo recibe `dist/` y las dependencias de producción. El
# compilador y los tests no llegan al contenedor que se despliega.

# ═══════════════════════════════════════════════════════════════════════════
# Etapa 1 — compilar
# ═══════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS build

WORKDIR /app

# Los manifiestos primero y en su propia capa: mientras no cambien, Docker
# reutiliza la caché del `npm ci`, que es lo más lento del build.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ═══════════════════════════════════════════════════════════════════════════
# Etapa 2 — imagen final
# ═══════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS runtime

# `dumb-init` como PID 1. Sin él, Node corre como PID 1 y en Linux ese PID
# ignora las señales por defecto: Cloud Run mandaría SIGTERM al reducir
# instancias, el proceso no se enteraría y la plataforma acabaría matándolo
# a los 10 s. Con dumb-init la señal se propaga y el contenedor sale limpio.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
WORKDIR /app

# Solo las dependencias de producción: fuera TypeScript y @types/node.
# `npm ci --omit=dev` sobre el mismo lockfile, así que las versiones son
# exactamente las que se compilaron y verificaron.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Usuario no-root. La imagen de node trae `node` (uid 1000) ya creado; se
# reutiliza en vez de inventar otro. `--chown` en el COPY sería equivalente,
# pero así queda explícito que nada del contenedor necesita escribir: el
# servidor es stateless y no toca disco.
USER node

# Cloud Run inyecta PORT y espera que el contenedor escuche ahí. El 8080 es
# solo el valor por defecto para `docker run` en local; startHttpServer() lee
# process.env.PORT y este valor queda ignorado en Cloud Run.
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/http.js"]
