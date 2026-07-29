# Docker Compose Guide for Stellar Card

This guide explains how to use Docker Compose for unified local development of the Stellar Card project.

## Overview

The Stellar Card Docker Compose setup provides:

- **Backend**: Node.js Express API server with SQLite (default) or PostgreSQL
- **Frontend**: Next.js web application
- **Contract**: Rust/Soroban smart contract build environment (tools profile)
- **SDK**: TypeScript SDK testing environment (tools profile)
- **Optional Services**: PostgreSQL and Redis (db profile)

## Architecture

The setup uses a multi-stage approach:

1. **Base configuration** (`docker-compose.yml`): Production-like images with health checks
2. **Development overlay** (`docker-compose.dev.yml`): Hot-reload with bind mounts
3. **Profile-based services**: Optional tools and databases

## Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/Menjay7/Stellar_Card.git
cd Stellar_Card
```

### 2. Start Development Stack

```bash
# Start with hot-reload development
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This starts:
- Backend on http://localhost:4000 with hot-reload
- Frontend on http://localhost:3000 with hot-reload
- Uses SQLite database (default)

### 3. Access Services

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:4000
- **Backend Health**: http://localhost:4000/health

## Common Commands

### Development Mode

```bash
# Start with hot-reload
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Start in detached mode
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# View logs
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f

# Stop services
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

### Production Mode

```bash
# Start production-like images
docker compose up

# Start in detached mode
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

### With Optional Databases

```bash
# Start with PostgreSQL and Redis
docker compose --profile db up

# Start development with databases
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile db up
```

### Tooling Services

```bash
# Build and test SDK
docker compose --profile tools run --rm sdk

# Build contract WASM
docker compose --profile tools run --rm contract

# Build contract with development overlay
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile tools run --rm contract
```

### Service Management

```bash
# Rebuild specific service
docker compose build backend
docker compose build frontend

# Rebuild all services
docker compose build

# Restart service
docker compose restart backend

# Execute command in container
docker compose exec backend sh
docker compose exec frontend sh

# Clean up (remove containers and volumes)
docker compose down -v
```

## Service Details

### Backend

- **Port**: 4000
- **Default Database**: SQLite (`/app/data/stellar_card.db`)
- **Health Check**: http://localhost:4000/health
- **Hot-reload**: Enabled in development mode via `node --watch`

**Development behavior:**
- Source code bind-mounted from `./stellar_card-backend/src`
- Changes trigger automatic restart
- Uses SQLite by default

### Frontend

- **Port**: 3000
- **API URL**: http://localhost:4000 (configured via `NEXT_PUBLIC_API_BASE_URL`)
- **Health Check**: http://localhost:3000
- **Hot-reload**: Enabled in development mode via polling

**Development behavior:**
- Entire frontend directory bind-mounted
- Uses polling for file system events (required for Docker bind mounts)
- `.next` directory kept container-side to avoid platform conflicts

### Contract (Tools Profile)

- **Purpose**: Build Soroban smart contracts without local Rust installation
- **Output**: WASM file in `target/wasm32-unknown-unknown/release/`
- **Usage**: Run-to-completion for building contracts

```bash
docker compose --profile tools run --rm contract
```

### SDK (Tools Profile)

- **Purpose**: Test TypeScript SDK without local Node installation
- **Usage**: Run-to-completion for running tests
- **Environment**: Allows insecure base URL for local development

```bash
docker compose --profile tools run --rm sdk
```

### PostgreSQL (DB Profile)

- **Port**: 5432
- **User**: stellar_card
- **Password**: stellar_card_dev
- **Database**: stellar_card
- **Data**: Persisted in `postgres-data` volume

**Enable with:**
```bash
docker compose --profile db up
```

### Redis (DB Profile)

- **Port**: 6379
- **Data**: Persisted in `redis-data` volume

**Enable with:**
```bash
docker compose --profile db up
```

## Environment Configuration

### Backend Environment

The backend loads environment variables from:

1. `stellar_card-backend/.env.example` (committed defaults)
2. `stellar_card-backend/.env` (local overrides, optional)
3. Docker Compose `environment:` section

**Key variables:**
- `PORT`: Server port (default: 4000)
- `NODE_ENV`: Environment (development/production)
- `DB_PATH`: SQLite database path (default: `/app/data/stellar_card.db`)
- `STELLAR_NETWORK`: Stellar network (testnet/mainnet)
- `VCC_API_BASE`: VCC fulfillment service URL

### Frontend Environment

The frontend uses Docker Compose `environment:` section:

**Key variables:**
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)
- `NEXT_PUBLIC_API_BASE_URL`: Backend API URL

### Development-Specific Variables

The dev overlay adds:
- `WATCHPACK_POLLING=true`: Enable file watching via polling
- `CHOKIDAR_USEPOLLING=true`: Enable polling for hot-reload

## Development Workflow

### 1. Make Code Changes

Edit files in your local directory. Changes are automatically reflected due to bind mounts.

### 2. Backend Development

```bash
# Edit files in stellar_card-backend/src/
# Backend auto-restarts on file changes
# View logs to see restart status
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f backend
```

### 3. Frontend Development

```bash
# Edit files in stellar_card-frontend/
# Frontend auto-reloads on file changes
# View logs to see rebuild status
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f frontend
```

### 4. Contract Development

```bash
# Edit contract files in stellar_card-contract/
# Build contract
docker compose --profile tools run --rm contract

# Or enter container for interactive development
docker compose --profile tools run --rm contract sh
```

### 5. SDK Development

```bash
# Edit SDK files in stellar_card-sdk/
# Run tests
docker compose --profile tools run --rm sdk
```

## Troubleshooting

### Port Conflicts

If ports are already in use, modify them in `docker-compose.yml`:

```yaml
services:
  backend:
    ports:
      - "4001:4000"  # Change to 4001
  frontend:
    ports:
      - "3001:3000"  # Change to 3001
```

### Hot-reload Not Working

If hot-reload fails:

1. **Backend**: Check logs for `node --watch` errors
2. **Frontend**: Polling is enabled by default in dev mode
3. **Volume mounts**: Ensure bind mounts are correct

```bash
# Check volume mounts
docker compose config

# Restart services
docker compose restart
```

### Database Issues

**SQLite (default):**
- Data persists in `backend-data` volume
- Reset database: `docker compose down -v && docker compose up`

**PostgreSQL:**
```bash
# Check PostgreSQL health
docker compose ps postgres

# View PostgreSQL logs
docker compose logs postgres

# Reset database
docker compose down -v postgres-data
docker compose --profile db up
```

### Build Errors

If you encounter build errors:

```bash
# Clean rebuild
docker compose down
docker compose build --no-cache
docker compose up
```

### Permission Issues

If you encounter permission issues with volumes:

```bash
# Reset volumes
docker compose down -v
docker compose up
```

### Container Won't Start

Check health checks and dependencies:

```bash
# Check service status
docker compose ps

# View service logs
docker compose logs backend
docker compose logs frontend

# Check health status
docker compose exec backend node -e "fetch('http://localhost:4000/health')"
```

## Advanced Usage

### Custom Networks

The setup uses a custom network `stellar_card-net`. All services communicate via this network.

### Volume Management

**List volumes:**
```bash
docker volume ls
```

**Remove specific volume:**
```bash
docker volume rm stellar_card_postgres-data
```

**Backup volumes:**
```bash
docker run --rm -v stellar_card_backend-data:/data -v $(pwd):/backup alpine tar czf /backup/backend-data.tar.gz /data
```

### Multi-Profile Usage

Combine multiple profiles:

```bash
# Start with databases and tools
docker compose --profile db --profile tools up

# Start development with databases
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile db up
```

### Resource Limits

Add resource limits to `docker-compose.yml`:

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
```

## Production Considerations

For production deployment:

1. **Use production images**: Don't use dev overlay
2. **Environment variables**: Set all required secrets
3. **Database**: Use PostgreSQL instead of SQLite
4. **SSL/TLS**: Configure SSL termination
5. **Monitoring**: Add health check monitoring
6. **Logging**: Configure centralized logging
7. **Security**: Scan images for vulnerabilities

```bash
# Production deployment
docker compose up -d
```

## Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Stellar Card Backend README](./stellar_card-backend/README.md)
- [Stellar Card Frontend README](./stellar_card-frontend/README.md)
- [Stellar Card Contract README](./stellar_card-contract/README.md)

## Support

For issues or questions:
- Open an issue on GitHub
- Check existing documentation
- Review Docker logs: `docker compose logs`
