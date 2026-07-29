# Stage 1: Build & Dependencies
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
