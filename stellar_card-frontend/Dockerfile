# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/app ./app

USER nextjs

EXPOSE 3000

CMD ["npm", "start"]

# Stage 4: Development
#
# Target this stage from docker-compose.dev.yml. It stops after the dependency
# stage — no `next build` — because the dev server compiles on demand, and
# baking a production build into an image that is about to be shadowed by a
# bind mount would only slow the first `up` down.
#
# Runs as root rather than the `nextjs` user from the runner stage: the bind
# mount carries the host's uid, and a mismatched uid makes `.next/` unwritable,
# which breaks the dev server's incremental compilation.
FROM node:20-alpine AS dev
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=development \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["npm", "run", "dev"]
