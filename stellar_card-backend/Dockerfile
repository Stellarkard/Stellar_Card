# Stage 1: Dependencies
#
# better-sqlite3 is a native module, so the toolchain has to be present when
# `npm ci` runs. It is confined to this stage so the runtime image does not
# ship a C compiler.
FROM node:20-alpine AS base

WORKDIR /app

# Install build dependencies for native modules (e.g. better-sqlite3)
RUN apk add --no-cache python3 make g++ sqlite-dev

# Copy package descriptors
COPY package*.json ./

# Install all dependencies
RUN npm ci

# Copy application source code
COPY src ./src
COPY jsconfig.json ./

# Create directory for SQLite database
RUN mkdir -p /app/data

EXPOSE 4000

ENV PORT=4000 \
    NODE_ENV=production \
    DB_PATH=/app/data/stellar_card.db

CMD ["npm", "start"]

# Stage 2: Development
#
# Target this stage from docker-compose.dev.yml. It reuses the dependency
# layer above, then relies on a bind mount for `src/`, so an edit on the host
# restarts the server in the container without a rebuild.
#
# The CMD deliberately does not reuse the `dev` npm script: that script passes
# `--env-file=.env`, and Node exits non-zero when that file is missing. Under
# Compose the environment arrives from `environment:`/`env_file:` instead, and
# a developer who has not created a local `.env` should still get a working
# container.
FROM base AS dev

ENV NODE_ENV=development

CMD ["node", "--watch", "src/index.js"]
