# Email Schedule — System Architecture

This document describes the implemented Email Schedule system: the React client, Express API, MySQL persistence, BullMQ delayed jobs, Redis coordination, SMTP delivery, authentication, and the operational boundaries between them.

The diagrams use Mermaid so they can be rendered by GitHub, VS Code Markdown Preview with Mermaid support, or other Mermaid-compatible documentation tools.

## 1. System purpose

Email Schedule lets an authenticated user compose one message for many recipients, choose immediate or future delivery, apply a per-sender hourly limit and a minimum gap between sends, attach files, and inspect scheduled, sent, or failed messages.

### Design goals

- Keep message state durable in MySQL.
- Keep delayed work durable in BullMQ/Redis.
- Coordinate multiple workers without process-local counters or timers.
- Prevent duplicate delivery during normal retries and duplicate enqueue attempts.
- Keep server secrets, sessions, OAuth state, and SMTP credentials outside the browser.
- Make restart behavior, recovery boundaries, and failure semantics explicit.

### Non-goals and known boundaries

- The worker provides at-least-once delivery, not mathematically exactly-once SMTP delivery.
- A database insert and a BullMQ enqueue are separate operations; a queue outage can leave rows pending for recovery.
- Redis loss removes delayed jobs even though MySQL rows remain.
- The current filter icon, archive action, delete action, and star action are visual or local UI state rather than persisted server features.
- The current email/password flow is intended for local development and can be enabled in any environment where the operator accepts that authentication policy.

## 2. Architecture at a glance

### 2.1 System context

```mermaid
flowchart LR
    User["User"]
    Browser["Browser"]
    Web["React + Vite web app"]
    API["Express API"]
    OAuth["Google OAuth2"]
    DB[("MySQL 8")]
    Redis[("Redis 7")]
    Worker["BullMQ worker"]
    Disk[("Attachment storage")]
    SMTP["Ethereal or SMTP provider"]

    User --> Browser
    Browser --> Web
    Web -->|"JSON, credentials: include"| API
    API <-->|"OAuth redirect"| OAuth
    API <-->|"sessions and state"| Redis
    API <-->|"message rows and users"| DB
    API -->|"stores attachment bytes"| Disk
    API -->|"enqueues delayed jobs"| Redis
    Redis --> Worker
    Worker --> DB
    Worker --> Disk
    Worker -->|"SMTP"| SMTP
    SMTP -->|"preview URL"| Worker
    Worker --> DB
```

### 2.2 Runtime containers

```mermaid
flowchart TB
    subgraph Client["Client container"]
        UI["React pages and components"]
        Router["React Router"]
        ApiClient["Typed API client"]
        UI --> Router
        UI --> ApiClient
    end

    subgraph Backend["Backend application"]
        Http["Express HTTP server"]
        Auth["Passport and session middleware"]
        EmailApi["Email scheduling routes"]
        AuthApi["Authentication routes"]
        Queue["BullMQ queue producer"]
        Worker["BullMQ worker"]
        Http --> Auth
        Auth --> EmailApi
        Auth --> AuthApi
        EmailApi --> Queue
    end

    subgraph Data["Stateful services"]
        MySQL[("MySQL")]
        Redis[("Redis")]
        Files[("Local attachment directory")]
    end

    subgraph External["External services"]
        Google["Google OAuth"]
        Mail["Ethereal/SMTP"]
    end

    ApiClient -->|"HTTPS"| Http
    AuthApi <--> Google
    Auth --> Redis
    EmailApi --> MySQL
    EmailApi --> Files
    Queue --> Redis
    Redis --> Worker
    Worker --> MySQL
    Worker --> Files
    Worker --> Mail
```

### 2.3 Deployment topology

The included Docker Compose file provides Redis and MySQL. The API, worker, and frontend normally run as application processes on the host or another deployment platform.

```mermaid
flowchart LR
    subgraph Host["Application host or deployment service"]
        Frontend["Vite development server or static frontend"]
        API["Node.js API process"]
        Worker["Node.js worker process"]
    end

    subgraph Services["Stateful services"]
        Redis[("Redis 7 container")]
        MySQL[("MySQL 8 container")]
    end

    Browser["Browser"] --> Frontend
    Frontend -->|"HTTP JSON"| API
    API --> Redis
    API --> MySQL
    API -->|"enqueue"| Redis
    Redis --> Worker
    Worker --> MySQL
    Worker --> Redis
    Worker -->|"SMTP"| Mailer["Ethereal or SMTP"]
```

A normal `backend/src/index.ts` process starts the API and an in-process worker. `backend/src/worker-entry.ts` is the standalone worker entry point for intentional process separation.

## 3. Component architecture

### 3.1 Backend components

```mermaid
flowchart TB
    subgraph Entry["Process entry points"]
        Index["src/index.ts\nAPI + worker"]
        WorkerEntry["src/worker-entry.ts\nworker only"]
        WorkerCore["startWorker\nBullMQ worker"]
    end

    subgraph HttpLayer["HTTP layer"]
        App["src/app.ts\nExpress application"]
        Session["RedisSessionStore\nrolling 7-day sessions"]
        Passport["Passport\nGoogle and local auth"]
        RequireAuth["requireAuth\nsession guard"]
        ScheduleRoutes["schedule.routes.ts\nemail API"]
        AuthRoutes["auth.routes.ts\nOAuth and password API"]
    end

    subgraph Domain["Application services"]
        Sanitize["sanitizeBody"]
        Attachments["save/read attachments"]
        Mailer["sendEmail\nNodemailer"]
        Hourly["checkHourlyLimit"]
        SendGate["reserve/complete/release slot"]
        Queue["enqueueEmail"]
    end

    subgraph Persistence["Persistence and coordination"]
        DB["MySQL pool and schema"]
        Redis["Redis connections"]
        Bull["BullMQ email-send queue"]
        Uploads["backend/uploads"]
    end

    Index --> App
    Index --> WorkerCore
    WorkerEntry --> WorkerCore
    App --> Session
    App --> Passport
    App --> RequireAuth
    RequireAuth --> ScheduleRoutes
    App --> AuthRoutes
    ScheduleRoutes --> Sanitize
    ScheduleRoutes --> Attachments
    ScheduleRoutes --> DB
    ScheduleRoutes --> Queue
    Queue --> Bull
    Bull --> Redis
    WorkerCore --> Bull
    WorkerCore --> Hourly
    WorkerCore --> SendGate
    Hourly --> Redis
    SendGate --> Redis
    WorkerCore --> Mailer
    WorkerCore --> DB
    Attachments --> Uploads
```

### 3.2 Frontend components

```mermaid
flowchart TB
    App["App\nBrowserRouter"]
    RequireAuth["RequireAuth\n/me session check"]
    Login["Login\nGoogle and email/password"]
    Dashboard["Dashboard\nscheduled or sent"]
    Sidebar["Sidebar\nnavigation and logout"]
    EmailRow["EmailRow\nlist row"]
    Compose["Compose\nrecipients, schedule, files"]
    Detail["EmailDetail\nmessage detail"]
    Button["Button\nshared variants"]
    Api["lib/api.ts\nrequest and HTML helpers"]
    Csv["lib/csv.ts\nrecipient parser"]
    Types["types/email.ts\nAPI contracts"]

    App --> Login
    App --> RequireAuth
    RequireAuth --> Dashboard
    RequireAuth --> Compose
    RequireAuth --> Detail
    Dashboard --> Sidebar
    Dashboard --> EmailRow
    Dashboard --> Api
    Compose --> Api
    Compose --> Csv
    Compose --> Button
    Detail --> Api
    Login --> Api
    Api --> Types
    Csv --> Types
```

### 3.3 Frontend route map

```mermaid
flowchart LR
    Root["/"] --> RequireAuth
    Sent["/sent"] --> RequireAuth
    ComposeRoute["/compose"] --> RequireAuth
    DetailRoute["/email/:id"] --> RequireAuth
    LoginRoute["/login"] --> LoginPage["Login page"]
    RequireAuth -->|authenticated| Dashboard
    RequireAuth -->|guest| LoginPage
    Dashboard -->|scheduled| ScheduledView["Dashboard variant=scheduled"]
    Dashboard -->|sent| SentView["Dashboard variant=sent"]
```

## 4. UML models

### 4.1 Domain and job class diagram

The attachment class is a logical record. The current implementation stores its metadata in the `emails.attachments` JSON column and its bytes in generated files under `backend/uploads`.

```mermaid
classDiagram
    class User {
        +string id
        +string email
        +string name
        +string avatarUrl
        +string passwordHash
        +string googleId
    }

    class Email {
        +string id
        +string userId
        +string recipient
        +string sender
        +string subject
        +string body
        +datetime sendAt
        +datetime sentAt
        +EmailStatus status
        +int attempts
        +string lastError
        +string previewUrl
        +Attachment[] attachments
    }

    class Attachment {
        +string name
        +int size
        +string type
        +string file
    }

    class SendEmailJob {
        +string emailId
        +int hourlyLimit
        +int delayBetweenEmailsMs
    }

    class Session {
        +string sid
        +string userId
        +datetime expiresAt
    }

    class EmailStatus {
        <<enumeration>>
        pending
        scheduled
        processing
        sent
        failed
    }

    User "1" --> "0..*" Email : owns
    Email "1" *-- "0..*" Attachment : references
    SendEmailJob "0..1" --> "1" Email : references
    Session "0..1" --> "1" User : authenticates
    Email --> EmailStatus
```

Fields such as `avatarUrl`, `passwordHash`, `googleId`, `sentAt`, `lastError`, and `previewUrl` are nullable in the persistence model.

### 4.2 Email state machine

The scheduling route currently inserts new rows as `scheduled`. The schema also supports `pending` for rows created by earlier versions or manual recovery. A worker can defer a job without changing its logical delivery state.

```mermaid
stateDiagram-v2
    [*] --> Scheduled: schedule route inserts row
    Scheduled --> Scheduled: send gap or hourly limit defers job
    Scheduled --> Processing: worker reserves delivery path
    Processing --> Sent: SMTP succeeds and status update succeeds
    Processing --> Failed: terminal delivery failure
    Sent --> [*]
    Failed --> [*]
```

State semantics:

| State | Meaning |
| --- | --- |
| `pending` | Persisted state supported by the schema and included in scheduled reads. |
| `scheduled` | Row is waiting for a delayed BullMQ job. |
| `processing` | Worker has reserved the send path and is preparing SMTP delivery. |
| `sent` | SMTP completed and the database status and preview URL were updated. |
| `failed` | The worker exhausted its retry policy and marked the row terminally failed. |

### 4.3 Persistence entity relationship diagram

```mermaid
erDiagram
    USERS ||--o{ EMAILS : "owns through user_id"
    EMAILS ||--o{ ATTACHMENT_FILES : "references through JSON metadata"

    USERS {
        varchar id PK
        varchar google_id UK
        varchar email UK
        varchar name
        text avatar_url
        varchar password_hash
        timestamp created_at
        timestamp updated_at
    }

    EMAILS {
        varchar id PK
        varchar user_id
        varchar recipient
        varchar subject
        mediumtext body
        varchar sender
        datetime send_at
        datetime sent_at
        enum status
        int attempts
        text last_error
        text preview_url
        json attachments
        varchar idempotency_key UK
        timestamp created_at
        timestamp updated_at
    }

    ATTACHMENT_FILES {
        varchar name
        int size
        varchar type
        varchar file
    }
```

`ATTACHMENT_FILES` is a logical representation, not a separate MySQL table. The database stores the metadata record, while the filesystem stores the bytes. The `emails.user_id` relationship is also logical in the current schema: queries scope access by user id, but the SQL schema does not declare a foreign-key constraint.

## 5. Runtime workflows

### 5.1 Authentication workflow

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant Web as React app
    participant API as Express API
    participant Session as Redis session store
    participant Google as Google OAuth
    participant DB as MySQL

    User->>Web: Open protected route
    Web->>API: GET /api/auth/me with session cookie
    API->>Session: Load session
    alt Authenticated session
        Session-->>API: User id
        API-->>Web: Current user
        Web-->>User: Show requested page
    else No session
        API-->>Web: user = null
        Web-->>User: Redirect to /login
    end

    opt Google sign-in
        User->>Web: Continue with Google
        Web->>Browser: Navigate to /api/auth/google
        Browser->>Google: Authenticate and authorize
        Google->>API: GET /api/auth/callback with state
        API->>Session: Validate and update OAuth state
        API->>DB: Find or provision verified Google user
        API->>Session: Create authenticated session
        API-->>Browser: Redirect to FRONTEND_URL
    end

    opt Email/password sign-in
        User->>Web: Submit email and password
        Web->>API: POST /api/auth/login
        API->>DB: Find user and compare bcrypt hash
        API->>Session: Create authenticated session
        API-->>Web: Public user
    end
```

### 5.2 Schedule-a-message workflow

```mermaid
sequenceDiagram
    actor User
    participant Web as Compose page
    participant API as Email routes
    participant Auth as requireAuth
    participant Sanitize as Sanitizer
    participant Files as Attachment storage
    participant DB as MySQL
    participant Queue as BullMQ producer
    participant Redis as Redis

    User->>Web: Enter message and recipients
    Web->>Web: Parse CSV/TXT and validate addresses
    User->>Web: Choose Send now or Send later
    Web->>API: POST /api/emails/schedule
    API->>Auth: Resolve session user
    Auth->>Redis: Read session
    Redis-->>Auth: User id or no session
    Auth-->>API: Authenticated request or 401
    API->>API: Validate subject, body, sender, recipients, dates, and limits
    API->>Sanitize: Sanitize HTML body
    API->>Files: Decode and store attachment bytes
    API->>DB: Insert one scheduled row per recipient
    loop One job per row
        API->>Queue: Add send-email job with jobId = email id
        Queue->>Redis: Persist delayed job
    end
    alt All jobs enqueue
        API-->>Web: 200 with count and ids
    else Queue unavailable after DB insert
        API-->>Web: 503 with enqueuedIds and pendingIds
    end
```

The request limit is 1,000 recipients and 10 attachments. Each attachment is limited to 10 MB. The API accepts a large JSON body because the browser sends attachment bytes as base64.

### 5.3 Worker delivery workflow

```mermaid
sequenceDiagram
    participant Bull as BullMQ
    participant Worker as Email worker
    participant DB as MySQL
    participant Gate as Redis send gate
    participant Limit as Redis hourly limiter
    participant Files as Attachment storage
    participant SMTP as Nodemailer provider

    Bull->>Worker: Activate send-email job
    Worker->>DB: Load email by emailId
    alt Missing, sent, or failed row
        Worker-->>Bull: Complete without sending
    else Deliverable row
        Worker->>Gate: Reserve shared send slot
        alt Slot not ready
            Gate-->>Worker: retryAtMs
            Worker->>Bull: Move job to delayed state
        else Slot reserved
            Gate-->>Worker: token
            Worker->>Limit: Increment sender/hour counter atomically
            alt Hourly limit exceeded
                Limit-->>Worker: retryAfterMs
                Worker->>Gate: Release slot
                Worker->>Bull: Move job to next window
            else Limit allows send
                Worker->>DB: Set status = processing
                Worker->>Files: Read stored attachments
                Worker->>SMTP: Send HTML message and attachments
                SMTP-->>Worker: Message id and preview URL
                Worker->>Gate: Complete slot and record last-send time
                Worker->>DB: Set status = sent and sent_at
                Worker-->>Bull: Complete job
            end
        end
    end
```

If SMTP or the final database update fails, the worker releases the send slot, records the error, and throws. BullMQ retries the job with exponential backoff. After the configured attempt limit, the worker marks the email as failed.

### 5.4 Attachment workflow

```mermaid
sequenceDiagram
    participant Web as Compose or detail page
    participant API as Email API
    participant Files as backend/uploads
    participant DB as MySQL

    Web->>Web: Read selected file as base64
    Web->>API: Attachment metadata plus base64 content
    API->>API: Validate count, metadata, and decoded size
    API->>Files: Write UUID-based safe filename
    API->>DB: Store attachment metadata in JSON
    API-->>Web: Email response without raw file path

    User->>Web: Open email detail
    Web->>API: GET /api/emails/:id/attachments/:index
    API->>DB: Verify email belongs to current user
    API->>Files: Read file using basename only
    API-->>Web: Attachment bytes and content type
```

The API response exposes attachment metadata but not the generated disk filename. The client receives bytes only through the authenticated attachment endpoint.

### 5.5 Logout workflow

```mermaid
sequenceDiagram
    participant Web as React app
    participant API as Auth routes
    participant Session as Redis session store

    Web->>API: POST /api/auth/logout
    API->>Session: Destroy session by sid
    Session-->>API: Session deleted
    API-->>Web: Clear session cookie
    Web->>Web: Navigate to /login
```

## 6. Data and coordination architecture

### 6.1 MySQL ownership

| Data | Owner | Purpose |
| --- | --- | --- |
| `users` | MySQL | Local and Google identities, profile, password hash, timestamps |
| `emails` | MySQL | Recipient, content, schedule, status, attempts, preview URL, attachment metadata |
| Session data | Redis | Authenticated session state keyed by session id |
| Delayed jobs | Redis/BullMQ | Retryable delivery work keyed by email id |
| Hourly counters | Redis | Per-sender UTC-hour delivery counts |
| Send-gate lease | Redis | Cross-worker SMTP serialization and last-send timestamp |
| Attachment bytes | Filesystem | Generated files under `backend/uploads` |

### 6.2 Redis keyspace

| Key or namespace | Lifetime | Coordination purpose |
| --- | --- | --- |
| `auth:session:<sid>` | Rolling session TTL, default 7 days | Stores authenticated session data. |
| BullMQ `email-send` queue | Until job completion or retention limit | Stores delayed, active, retried, and completed jobs. |
| `rate:<sender>:<UTC-hour>` | One hour | Atomically counts sends for one sender in one UTC hour. |
| `email-send:send-gate:lock` | Short lease | Ensures only one worker enters the SMTP critical section. |
| `email-send:send-gate:last-send` | Persistent until next process/data cleanup | Stores the last successful send timestamp used to enforce the gap. |

### 6.3 Redis atomic operations

The hourly limiter uses a Lua script to combine `INCR` and first-use `EXPIRE`. The send gate uses Lua scripts to reserve, complete, and release a lease using Redis server time. These operations remain coordinated across multiple worker processes.

### 6.4 Storage flow

```mermaid
flowchart LR
    Browser["Browser file bytes"] -->|base64 JSON| API["Express API"]
    API -->|UUID filename| Disk["backend/uploads"]
    API -->|metadata JSON| MySQL[("MySQL emails.attachments")]
    Worker["Worker"] -->|read by basename| Disk
    Worker -->|attachment bytes| SMTP["Nodemailer"]
```

## 7. Security architecture

### 7.1 Trust boundaries

```mermaid
flowchart TB
    subgraph Internet["Public network"]
        Browser["User browser"]
        Google["Google OAuth provider"]
    end

    subgraph Server["Trusted application server"]
        API["Express API"]
        Session["Session middleware"]
        Sanitizer["HTML sanitizer"]
        Worker["Worker process"]
        Secrets["Server environment secrets"]
    end

    subgraph Private["Private state"]
        Redis[("Redis")]
        MySQL[("MySQL")]
        Disk[("Attachment directory")]
    end

    Browser -->|"HTTPS and session cookie"| API
    Browser -->|"OAuth redirect"| Google
    Google -->|"Verified callback and state"| API
    API --> Session
    Session --> Redis
    API --> Sanitizer
    API --> MySQL
    API --> Disk
    API --> Secrets
    Redis --> Worker
    MySQL --> Worker
    Disk --> Worker
    Worker --> Secrets
```

### 7.2 Security controls

| Boundary | Control |
| --- | --- |
| Browser to API | CORS allowlist, JSON content type, credentialed session requests |
| Session cookie | `httpOnly`, `sameSite=lax`, `secure` in production, seven-day rolling lifetime |
| OAuth | Passport Google OAuth with `state: true`; verified email provisioning |
| Passwords | bcrypt hashing and comparison |
| Email routes | `requireAuth` middleware and per-user query scoping |
| Development only | `x-user-id` is accepted only outside production; it must not be enabled in deployed environments |
| HTML content | Server-side allowlist sanitization before persistence and delivery |
| Attachments | Count and decoded-size limits, UUID filenames, basename-only reads |
| Email rendering | Client removes scripts, styles, event attributes, and unsafe URL attributes before HTML rendering |
| Secrets | Google and SMTP credentials stay in backend environment variables |
| Production transport | HTTPS frontend and callback URLs are required by startup validation |

### 7.3 Authentication boundary

`requireAuth` first checks the Passport session. In non-production environments it also accepts an `x-user-id` header as a development convenience. The frontend uses the real session flow and does not send that header.

## 8. API surface

| Method | Endpoint | Authentication | Reads or writes |
| --- | --- | --- | --- |
| `GET` | `/api/health` | None | Liveness response |
| `GET` | `/api/auth/me` | Optional session | Current public user or `null` |
| `GET` | `/api/auth/google` | None | Starts Google OAuth or returns 503 when unconfigured |
| `GET` | `/api/auth/callback` | OAuth state | Provisions user and creates session |
| `POST` | `/api/auth/signup` | None | Creates local user and session |
| `POST` | `/api/auth/login` | None | Verifies credentials and creates session |
| `POST` | `/api/auth/logout` | Optional session | Destroys session and clears cookie |
| `POST` | `/api/emails/schedule` | Required | Validates, stores, and enqueues recipient jobs |
| `GET` | `/api/emails/scheduled` | Required | Reads pending and scheduled rows for current user |
| `GET` | `/api/emails/sent` | Required | Reads sent and failed rows for current user |
| `GET` | `/api/emails/:id` | Required | Reads one owned email |
| `GET` | `/api/emails/:id/attachments/:index` | Required | Streams one owned attachment |

## 9. Reliability and failure semantics

### 9.1 Idempotency

- BullMQ uses `jobId = email.id`, so a duplicate enqueue for the same row is rejected by the queue.
- The worker skips rows already marked `sent` or `failed` before attempting delivery.
- The send gate serializes the SMTP entry point even when worker concurrency is greater than one.
- The schema includes an `idempotency_key` column, but the current schedule route uses the email row id as the operational queue identity.

### 9.2 Retry policy

- Each job receives three attempts.
- Retry backoff is exponential with a 5-second base delay.
- A worker error increments the database attempt counter and stores a bounded error message.
- A terminal worker failure marks the email row as `failed`.
- Rate-limit and send-gap deferrals use BullMQ delayed-job movement rather than dropping the email.

### 9.3 Failure windows

| Failure | Result | Recovery implication |
| --- | --- | --- |
| MySQL insert succeeds, queue add fails | Rows remain scheduled; API returns partial enqueue data | Requeue pending rows through an operational recovery procedure. |
| Redis is flushed | Delayed jobs disappear while MySQL rows remain | Requeue from MySQL after restoring Redis. |
| SMTP succeeds, final DB update fails | Provider may have accepted a message while the row remains non-sent | Retry can produce a duplicate; use provider idempotency or an outbox for stronger guarantees. |
| Attachment is saved, DB insert fails | Generated file may remain without an email row | Add lifecycle cleanup or transactional orphan cleanup. |
| Worker process stops | BullMQ lock recovery makes active jobs available according to BullMQ settings | Redis and MySQL remain the recovery sources of truth. |

### 9.4 Why there is no cron poller

A database polling loop would continuously scan for due rows and would need to reconstruct queue state after a restart. BullMQ stores delayed work in Redis, supports retries and delayed movement, and lets the worker coordinate through the same Redis primitives used for rate limits and send gaps.

## 10. Configuration architecture

| Setting | Scope | Default or behavior |
| --- | --- | --- |
| `PORT` | API process | `4000` |
| `FRONTEND_URL` | CORS and OAuth redirect | `http://localhost:5173` |
| `DB_HOST`, `DB_PORT` | MySQL pool | `localhost`, `3306` |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL pool | Backend environment |
| `REDIS_URL` | Queue, sessions, limits, gate | `redis://localhost:6380` in the example environment |
| `WORKER_CONCURRENCY` | Worker | `5` |
| `MAX_EMAILS_PER_HOUR` | Default hourly limit | `50` |
| `MIN_SEND_DELAY_MS` | Worker limiter and send-gap floor | `1000` |
| `SESSION_SECRET` | Session signing | Random fallback in development; required in production |
| `GOOGLE_CLIENT_ID` | OAuth | Empty by default |
| `GOOGLE_CLIENT_SECRET` | OAuth | Empty by default |
| `GOOGLE_CALLBACK_URL` | OAuth | Local callback in the example environment |
| `ETHEREAL_*` | SMTP | Auto-created test account when credentials are blank |
| `VITE_API_URL` | Browser API client | `http://localhost:4000` |

## 11. Source map

### Backend

| Area | Primary files |
| --- | --- |
| Process startup | `backend/src/index.ts`, `backend/src/worker-entry.ts` |
| HTTP composition | `backend/src/app.ts` |
| Authentication | `backend/src/api/auth.routes.ts`, `backend/src/middleware/requireAuth.ts` |
| Email API | `backend/src/api/schedule.routes.ts` |
| Queue | `backend/src/queue/queue.ts`, `backend/src/queue/worker.ts` |
| Send coordination | `backend/src/queue/sendGate.ts` |
| Hourly limits | `backend/src/rateLimiter/hourlyLimiter.ts` |
| Database | `backend/src/db/client.ts`, `backend/src/db/migrate.ts`, `backend/src/db/schema.sql` |
| Sessions | `backend/src/session/redisSessionStore.ts` |
| SMTP | `backend/src/lib/mailer.ts` |
| Attachments | `backend/src/lib/attachments.ts` |
| Content safety | `backend/src/lib/sanitize.ts` |
| Configuration | `backend/src/config/env.ts`, `backend/src/config/redis.ts` |

### Frontend

| Area | Primary files |
| --- | --- |
| Routes and auth guard | `frontend/src/App.tsx` |
| Login | `frontend/src/pages/Login.tsx` |
| Dashboard | `frontend/src/pages/Dashboard.tsx` |
| Compose | `frontend/src/pages/Compose.tsx` |
| Email detail | `frontend/src/pages/EmailDetail.tsx` |
| Layout | `frontend/src/components/layout/Sidebar.tsx` |
| Email list row | `frontend/src/components/email/EmailRow.tsx` |
| Shared button | `frontend/src/components/ui/Button.tsx` |
| API boundary | `frontend/src/lib/api.ts` |
| Recipient parsing | `frontend/src/lib/csv.ts` |
| Shared types | `frontend/src/types/email.ts` |
| Build configuration | `frontend/vite.config.ts`, `frontend/package.json` |

## 12. Testing and operations

### Test layers

| Layer | Location or command | What it verifies |
| --- | --- | --- |
| Sanitization | `backend/src/__tests__/sanitize.test.ts` | HTML allowlist and unsafe content removal |
| Authentication | `backend/src/__tests__/requireAuth.test.ts` | Session and development identity behavior |
| Mailer | `backend/src/__tests__/mailer.test.ts` | Mailer behavior and test-address handling |
| Send gap | `backend/src/__tests__/sendDelay.test.ts` | Effective delay calculation |
| Send gate | `backend/src/__tests__/sendGate.integration.test.ts` | Cross-worker slot coordination through Redis |
| Hourly limiter | `backend/src/__tests__/rateLimiter.test.ts` | Buckets, limits, and sender isolation |
| Hourly integration | `backend/src/__tests__/hourlyLimiter.integration.test.ts` | Concurrent Redis behavior |
| Idempotency | `backend/src/__tests__/idempotency.test.ts` | Worker sent-state guard |
| End-to-end helper | `backend/src/scripts/test-e2e.ts` | Local scheduling and delivery flow |
| Load helper | `backend/src/scripts/load-test-1000.ts` | Bulk recipient and queue behavior |

### Commands

Backend:

```bash
npm run dev
npm run dev:worker
npm run migrate
npm run build
npm test
```

Frontend:

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

The backend integration tests require a reachable Redis instance. The current frontend package has no browser test script; the backend suite is the primary automated test suite.

## 13. Architectural decisions and trade-offs

| Decision | Benefit | Trade-off |
| --- | --- | --- |
| MySQL for message state | Queryable history and ownership filtering | Queue and database writes are separate operations |
| BullMQ delayed jobs | Durable scheduling, retries, and delayed movement | Redis availability is required for delivery |
| Redis Lua coordination | Atomic behavior across workers | Redis becomes a critical runtime dependency |
| Database row id as job id | Natural duplicate-enqueue protection | A row id must remain stable for the life of the message |
| Ethereal for development | Real SMTP flow without real recipient delivery | Preview URLs are development-oriented and not a production mailbox |
| Google plus local auth | Supports OAuth deployment and local development | Two account-provisioning paths must remain consistent |
| Server-side attachment storage | Keeps raw paths out of the client | Requires filesystem lifecycle and capacity management |
| SPA frontend routing | Simple navigation and static hosting | The static host must provide an `index.html` fallback |
