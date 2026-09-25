# Email Schedule Frontend

The React client for Email Schedule. It provides authenticated access to the compose flow, scheduled and sent message views, recipient-list import, attachments, and email detail pages.

## Features

- Google OAuth entry point with local email/password sign-up and sign-in.
- Protected routes for the dashboard, compose page, and message details.
- Compose messages for one or many recipients.
- Import recipients from `.csv` and `.txt` files.
- Send immediately or choose a future local date and time.
- Configure the gap between messages and the hourly sending limit.
- Attach documents and images, with client-side size and type feedback.
- Review scheduled, sent, and failed messages.
- Search the message list and review scheduled or sent status.
- Render sanitized HTML email content in the detail view.

## Stack

- React 19
- TypeScript
- React Router
- Vite
- Tailwind CSS
- Oxlint

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- The Email Schedule backend running and reachable
- A browser with JavaScript enabled

## Run locally

From the repository root:

```bash
cd frontend
npm install
npm run dev
```

Vite prints the local URL after startup. The default API base URL is `http://localhost:4000`.

To point the client at another API, create `frontend/.env` or provide the variable through the shell:

```dotenv
VITE_API_URL=http://localhost:4000
```

Vite variables must use the `VITE_` prefix and are bundled into the client. Never put server secrets in this file.

## Routes

| Route | Access | Purpose |
| --- | --- | --- |
| `/login` | Public | Sign in or create an account |
| `/` | Authenticated | Scheduled and pending messages |
| `/sent` | Authenticated | Sent and failed messages |
| `/compose` | Authenticated | Create and schedule a message |
| `/email/:id` | Authenticated | View one message and its attachments |

Unauthenticated visits to protected routes are redirected to `/login`. After signing in, the user returns to the application shell.

## API integration

All API calls are centralized in `src/lib/api.ts` and use `credentials: "include"` so the browser sends the session cookie.

| Client method | Endpoint | Purpose |
| --- | --- | --- |
| `me()` | `GET /api/auth/me` | Load the current user |
| `loginUrl()` | `GET /api/auth/google` | Start Google OAuth |
| `login()` | `POST /api/auth/login` | Sign in with email/password |
| `signup()` | `POST /api/auth/signup` | Create a local account |
| `logout()` | `POST /api/auth/logout` | End the session |
| `scheduled()` | `GET /api/emails/scheduled` | Load scheduled messages |
| `sent()` | `GET /api/emails/sent` | Load sent and failed messages |
| `email(id)` | `GET /api/emails/:id` | Load one message |
| `schedule(payload)` | `POST /api/emails/schedule` | Send or schedule messages |

The compose payload supports:

- `subject`
- `body`
- `recipients`
- `sender`
- `startAt`
- `delayBetweenEmails`
- `hourlyLimit`
- `attachments`

## Project structure

```text
src/
  components/
    email/       Message row and list presentation
    layout/      Sidebar and application shell
    ui/          Reusable controls
  lib/
    api.ts       Typed API client and HTML helpers
    csv.ts       Recipient-list parsing
  pages/
    Compose.tsx
    Dashboard.tsx
    EmailDetail.tsx
    Login.tsx
  types/
    email.ts     API and compose types
  App.tsx        Routes and authentication guard
  main.tsx       React entry point
  index.css      Global styles
```

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

The production build is emitted to `frontend/dist`. A static host must serve `index.html` as the fallback for client-side routes such as `/compose` and `/email/:id`.

## Validation and security

- The compose form validates sender and recipient email addresses before submission.
- The client sanitizes HTML before rendering email content.
- The backend remains the authority for authentication, request validation, sanitization, limits, and delivery.
- API errors are surfaced to the user instead of being silently ignored.
- Attachments are read in the browser and sent as base64 content to the backend.

## Troubleshooting

### The page loads but API requests fail

Confirm that the backend is running on port `4000` and that `VITE_API_URL` points to its public URL. Restart Vite after changing an environment variable.

### Sign-in redirects back to the login page

Check that the API is reachable, the browser is allowing credentials, and the backend has a valid session configuration. For Google sign-in, also verify the OAuth callback URL in the backend environment and Google Cloud.

### Vite reports a port conflict

Choose another port when starting the development server:

```bash
npm run dev -- --port 5174
```

## Testing

The frontend currently has no test script or browser test suite. Run backend unit and Redis integration tests from the repository root:

```bash
cd backend
npm test
```

For the complete setup, environment variables, API contract, and operational guidance, see the [root README](../README.md) and [`ARCHITECTURE.md`](../ARCHITECTURE.md).
