# Email Schedule

A full-stack email scheduling workspace for composing, scheduling, and delivering email campaigns. The application keeps delivery state in MySQL, uses BullMQ and Redis for durable delayed jobs, and sends through Nodemailer with Ethereal for development.

## Highlights

- Compose a message for one or many recipients.
- Import recipients from `.csv` and `.txt` files.
- Send immediately or schedule delivery for a future local date and time.
- Attach up to 10 files, with a 10 MB limit per file.
- Track scheduled, sent, and failed messages in separate views.
- Enforce per-sender hourly limits and a shared minimum gap between sends.
- Survive process restarts because delayed jobs live in Redis and email state lives in MySQL.
- Authenticate with Google OAuth or the local email/password flow.
- Use an additional standalone worker process when API and worker capacity need to scale independently.

## Stack

| Layer | Technology |
| --- | --- |
| Web app | React 19, React Router, Vite, TypeScript, Tailwind CSS |
| API | Express, TypeScript, Passport, `express-session` |
| Queue | BullMQ 5, Redis 7 |
| Database | MySQL 8, `mysql2` |
| Email | Nodemailer, Ethereal SMTP for development |
| Validation | Zod-free request validation with explicit limits and server-side HTML sanitization |

## How delivery works

```text
Compose
  → POST /api/emails/schedule
  → validate, sanitize, and store recipient rows in MySQL
  → enqueue one delayed BullMQ job per recipient
  → worker claims the job
  → shared Redis send gate and hourly limiter
  → SMTP delivery
  → update the message status and preview URL
```

MySQL is the source of truth for message state. BullMQ is the delivery mechanism. A worker uses the database row id as its BullMQ job id and skips rows already marked as sent, which makes retries and duplicate enqueue attempts safe in normal operation.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- MySQL 8
- Redis 7+
- Google OAuth credentials for Google sign-in
- Docker Desktop if using the included local service stack

Redis 7 is required by the current BullMQ and queue coordination setup. The native Windows Redis 3.x service is not suitable for this project.

## Quick start

### 1. Start MySQL and Redis

You can use existing local services or start the included containers:

```bash
cd backend
docker compose up -d
```

The compose file publishes MySQL on `3306` and Redis on `6379`. When using it, set these values in `backend/.env`:

```dotenv
DB_PASSWORD=root123
REDIS_URL=redis://localhost:6379
```

If native services are already running, use their existing host and port values instead. Stop either native service or change the published ports before starting the containers to avoid port conflicts.

### 2. Configure and start the backend

```bash
cd backend
copy .env.example .env
npm install
npm run migrate
npm run dev
```

On macOS and Linux, use `cp .env.example .env` instead of `copy`.

`npm run dev` starts the API and an in-process worker on port `4000`. Database migrations are also run during startup, so the explicit migration command is optional but useful for a clean setup.

For a separate worker process, use:

```bash
cd backend
npm run dev:worker
```

The standalone worker does not start the HTTP API. Run it alongside an API process only when you intentionally want separate worker capacity.

### 3. Start the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local Vite URL shown in the terminal. The frontend defaults to `http://localhost:4000` for API requests. Set `VITE_API_URL` in `frontend/.env` when the API is hosted elsewhere:

```dotenv
VITE_API_URL=http://localhost:4000
```

## Authentication

### Google OAuth

1. Create a Google Cloud project and configure the OAuth consent screen.
2. Add the `profile` and `email` scopes.
3. Create a Web application OAuth client.
4. Register the exact callback URL in Google Cloud.
5. Add the credentials to `backend/.env`.

For local development, the callback is normally:

```text
http://localhost:4000/api/auth/callback
```

Set the same value in `GOOGLE_CALLBACK_URL`. The browser returns to the origin configured by `FRONTEND_URL`, normally `http://localhost:5173`.

The client secret stays on the server. Never place it in frontend environment variables or commit it to the repository.

### Email and password

The login screen also provides local email/password registration and sign-in. This is useful for development when Google OAuth is not configured. Production startup validates the Google OAuth and session configuration.

## Configuration

### Backend environment

| Variable | Purpose | Development default |
| --- | --- | --- |
| `PORT` | Express API port | `4000` |
| `FRONTEND_URL` | Allowed browser origin and post-login redirect | `http://localhost:5173` |
| `DB_HOST`, `DB_PORT` | MySQL connection | `localhost`, `3306` |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL credentials and database | See `backend/.env.example` |
| `REDIS_URL` | Redis connection for BullMQ, sessions, limits, and send coordination | `redis://localhost:6380` |
| `WORKER_CONCURRENCY` | Jobs processed concurrently by one worker | `5` |
| `MAX_EMAILS_PER_HOUR` | Default per-sender hourly limit | `50` |
| `MIN_SEND_DELAY_MS` | Minimum gap enforced between actual sends | `1000` |
| `SESSION_SECRET` | Random value used to protect sessions | Required in production |
| `GOOGLE_CLIENT_ID` | Google OAuth client id | Empty |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Empty |
| `GOOGLE_CALLBACK_URL` | Exact registered OAuth callback | `http://localhost:4000/api/auth/callback` |
| `ETHEREAL_HOST`, `ETHEREAL_PORT` | Development SMTP endpoint | Ethereal defaults |
| `ETHEREAL_USER`, `ETHEREAL_PASS` | Ethereal credentials | Auto-created when blank |

### Frontend environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_API_URL` | Base URL for API requests | `http://localhost:4000` |

## API overview

All email routes require an authenticated session and scope queries to the current user.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service health check |
| `GET` | `/api/auth/me` | Return the current user or `null` |
| `GET` | `/api/auth/google` | Start Google OAuth |
| `GET` | `/api/auth/callback` | Complete Google OAuth |
| `POST` | `/api/auth/login` | Sign in with email and password |
| `POST` | `/api/auth/signup` | Create a local account |
| `POST` | `/api/auth/logout` | Destroy the current session |
| `POST` | `/api/emails/schedule` | Validate and enqueue one or more messages |
| `GET` | `/api/emails/scheduled` | List pending messages ordered by send time |
| `GET` | `/api/emails/sent` | List sent and failed messages newest first |
| `GET` | `/api/emails/:id` | Fetch one message owned by the current user |
| `GET` | `/api/emails/:id/attachments/:index` | Stream one stored attachment |

The schedule request accepts `subject`, `body`, `recipients`, `sender`, `startAt`, `delayBetweenEmails`, `hourlyLimit`, and optional `attachments`. A request can contain up to 1,000 recipients and 10 attachments.

## Useful commands

### Backend

```bash
npm run dev
npm run dev:worker
npm run migrate
npm run build
npm start
npm run start:worker
npm test
npm run test:watch
```

### Frontend

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

## Project structure

```text
backend/
  src/api/          Express routes for authentication and email scheduling
  src/config/       Environment and Redis configuration
  src/db/           MySQL pool, schema, and migrations
  src/queue/        BullMQ queue, worker, and shared send gate
  src/rateLimiter/  Redis-backed hourly limiter
  src/lib/          Mailer, attachments, sanitization, and shared helpers
  src/__tests__/    Unit and Redis integration tests
frontend/
  src/pages/        Login, dashboard, compose, and email detail views
  src/components/   Layout, email rows, and shared UI
  src/lib/          API client, HTML helpers, and recipient parsing
  src/types/        Shared frontend request and response types
```

## Operations and troubleshooting

### Port 4000 is already in use

The API exits when another process owns its port. Stop the old process or run:

```bash
npx kill-port 4000
```

Then start the backend again.

### Redis is unavailable

Confirm that Redis 7 is running and that `REDIS_URL` points to the correct host and port. The API, BullMQ jobs, sessions, hourly counters, and send gate all depend on Redis coordination.

### Google sign-in returns 503

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in `backend/.env`, then restart the backend. The callback URL must match the value registered in Google Cloud exactly.

### Email delivery is delayed

The worker can intentionally defer a job when the hourly limit or minimum send gap is reached. Check the worker logs, Redis availability, and the relevant `MAX_EMAILS_PER_HOUR` and `MIN_SEND_DELAY_MS` values.

## Security and data handling

- Keep `.env` files local and out of version control.
- Use a long random `SESSION_SECRET` in every deployed environment.
- Use HTTPS for production frontend and OAuth callback URLs.
- Do not expose `GOOGLE_CLIENT_SECRET` or SMTP credentials to the browser.
- Message HTML is sanitized on the server before storage and delivery.
- Attachment paths are generated server-side and are never accepted from the client.
- Email queries are scoped to the authenticated user.

## Further reading

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the data flow, restart behavior, idempotency model, rate limiting, concurrency, and design trade-offs.
