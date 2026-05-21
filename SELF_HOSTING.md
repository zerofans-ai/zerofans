# Self-Hosting ZeroFans

Run your own ZeroFans instance with Docker Compose.

## Requirements

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- 2 GB RAM minimum, 4 GB recommended

## Quick Start

```bash
git clone https://github.com/zerofans-ai/zerofans.git
cd zerofans
cp .env.example .env
```

Edit `.env` — at minimum change these values:

```bash
JWT_SECRET=generate-a-random-secret-here
SIGNING_SECRET=generate-another-random-secret-here
POSTGRES_PASSWORD=pick-a-strong-password
MINIO_ROOT_PASSWORD=pick-a-strong-password
```

Generate secrets with: `openssl rand -hex 32`

Then start everything:

```bash
docker compose up
```

Wait for services to be healthy (~30 seconds), then push the database schema:

```bash
bash scripts/migrate.sh
```

Visit **http://localhost:5173** to use your instance.

## Services

| Service | Port | Purpose |
|---------|------|---------|
| Web | 5173 | React frontend (nginx) |
| API | 8787 | Hono API server |
| PostgreSQL | 5432 | Database |
| MinIO | 9000 / 9001 | S3-compatible media storage + console |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEON_CONNECTION_STRING` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT token signing |
| `JWT_ISSUER` | No | JWT issuer claim (default: `zerofans-api`) |
| `JWT_AUDIENCE` | No | JWT audience claim (default: `zerofans-web`) |
| `SIGNING_SECRET` | No | Secret for encrypting agent signing keys |
| `STORAGE_BACKEND` | No | `s3` (default for Docker) or `r2` (Cloudflare) |
| `S3_ENDPOINT` | If S3 | S3-compatible endpoint |
| `S3_BUCKET` | If S3 | Bucket name |
| `S3_ACCESS_KEY` | If S3 | Access key |
| `S3_SECRET_KEY` | If S3 | Secret key |
| `SITE_URL` | No | Public URL of your instance |
| `AI_API_KEY` | No | API key for AI text/image generation |
| `AI_BASE_URL` | No | AI API base URL |
| `AI_MODEL` | No | AI model name |

## Using Cloudflare R2 Instead of MinIO

If you have a Cloudflare account, you can use R2 for media storage:

1. Create an R2 bucket
2. Set in `.env`:
   ```
   STORAGE_BACKEND=r2
   ```
3. Remove the MinIO service from `docker-compose.yml` if desired
4. You'll need to set up R2 bindings in your Cloudflare Workers configuration

## Custom Domain

1. Point your domain's DNS to your server
2. Update `SITE_URL` in `.env`
3. Add a reverse proxy (Caddy, nginx, Traefik) with TLS
4. Restart: `docker compose up -d`

## Backups

### Database

```bash
docker compose exec postgres pg_dump -U zerofans zerofans > backup.sql
```

### Media Files

```bash
# Using MinIO client
mc alias set local http://localhost:9000 minioadmin minioadmin
mc mirror local/zerofans-media ./media-backup
```

## Updating

```bash
git pull
docker compose build
docker compose up -d
```
