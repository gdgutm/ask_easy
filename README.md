Hey
# AskEasy

A real-time classroom Q&A platform built for live lectures at the University of Toronto. Students post questions anonymously or publicly, upvote what matters most, and get answers from instructors — all updating instantly during class. Professors see exactly what the room is confused about, right now.

## Why AskEasy?

In large lecture halls, most students never raise their hand. Questions go unasked, concepts go unclarified, and instructors are left guessing what landed and what didn't. Tools like Piazza are built for asynchronous discussion — not for the 50 minutes you're actually in the room.

AskEasy is built for that moment. It gives every lecture a live Q&A room where the most important questions surface automatically through upvoting, anonymous posting removes the social barrier to asking, and professors can present slides side-by-side with the chat without switching windows.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Production                           │
│                                                             │
│   Browser ──HTTPS──▶ Apache + mod_shib ──localhost──▶ App  │
│                            │                                │
│                            ▼                                │
│                      U of T IdP (SAML)                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
│                                                             │
│   ┌──────────────────────────────────────────────────────┐  │
│   │              Node.js Custom Server (server.ts)        │  │
│   │                                                      │  │
│   │   ┌─────────────────┐    ┌────────────────────────┐  │  │
│   │   │  Next.js App    │    │   Socket.IO Server     │  │  │
│   │   │  (App Router)   │    │   (real-time events)   │  │  │
│   │   │  - Pages        │    │   - questions          │  │  │
│   │   │  - API routes   │    │   - answers/upvotes    │  │  │
│   │   │  - Auth         │    │   - slide sync         │  │  │
│   │   └────────┬────────┘    └──────────┬─────────────┘  │  │
│   └────────────┼──────────────────────── ┼───────────────┘  │
└────────────────┼─────────────────────────┼──────────────────┘
                 │                         │
        ┌────────▼────────┐     ┌──────────▼──────────┐
        │   PostgreSQL 16  │     │      Redis 7         │
        │   (via Prisma)   │     │  - Socket.IO pub/sub │
        │                  │     │  - Rate limiting     │
        │  Users, Courses  │     │  - Answer mode TTL   │
        │  Sessions, Q&A   │     │  - Session data      │
        │  Upvotes, Slides │     └─────────────────────┘
        └──────────────────┘
```

### How the pieces connect

| Component | Role |
|-----------|------|
| **Custom server (`server.ts`)** | Single Node.js process that boots both Next.js and Socket.IO on the same port. Strips Shibboleth headers from non-localhost connections to prevent spoofing. |
| **Next.js App Router** | Serves all pages and REST API routes (`/api/*`). Server Components fetch from PostgreSQL via Prisma; API routes handle auth, course/session management, and slide uploads. |
| **Socket.IO** | Handles all real-time events (questions, answers, upvotes, slide page changes). Uses a Redis adapter so multiple app instances share the same pub/sub channel. |
| **PostgreSQL + Prisma** | Single source of truth for all persistent data. Prisma handles the schema, migrations, and typed queries. |
| **Redis** | Three jobs: Socket.IO pub/sub adapter, rate-limit counters (per-user sliding windows), and ephemeral answer-mode state (24-hour TTL). |
| **Apache + mod_shib** *(prod only)* | Terminates TLS, enforces Shibboleth SSO, and injects `utorid`/`mail`/`cn` headers before proxying to the app. |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, Radix UI |
| Backend | Next.js API routes + custom Node.js HTTP server |
| Real-time | Socket.IO with Redis adapter |
| Database | PostgreSQL 16 (via Prisma ORM) |
| Cache / Pub-sub | Redis 7 |
| Auth | iron-session + Shibboleth header-based SSO |
| Testing | Vitest, Testing Library |
| Containerization | Docker & Docker Compose |

---

## Environment Variables

### `.env` — used by Docker Compose and production

```bash
# PostgreSQL
DATABASE_URL=postgresql://postgres:<password>@postgres:5432/ask_easy
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=ask_easy

# Redis
REDIS_URL=redis://:<redis-password>@redis:6379
REDIS_PASSWORD=<redis-password>

# Session encryption key — generate with: openssl rand -hex 32
SESSION_SECRET=<64-char-hex>

# Cron job auth (for /api/cron/cleanup-sessions)
CRON_SECRET=<random-secret>
```

### `.env.local` — local dev only (overrides hosts to `localhost`)

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ask_easy
REDIS_URL=redis://:changeme@localhost:6379

# Fake SSO identity for local login
DEV_UTORID=yourutorid
DEV_NAME=Your Name
DEV_EMAIL=your.email@mail.utoronto.ca
DEV_ROLE=PROFESSOR   # or STUDENT
```

> **Note:** In Docker Compose the database and Redis hosts are the service names (`postgres`, `redis`). In `pnpm dev` they must be `localhost` because the app runs outside Docker.

| Variable | Required | Description |
|----------|:--------:|-------------|
| `DATABASE_URL` | Yes | Prisma connection string |
| `POSTGRES_USER` / `PASSWORD` / `DB` | Yes | Postgres container credentials |
| `REDIS_URL` | Yes | Redis connection (include password if set) |
| `REDIS_PASSWORD` | Yes (Docker) | Passed to the Redis container |
| `SESSION_SECRET` | Yes | 64-char hex key for iron-session cookie encryption |
| `CRON_SECRET` | Prod | Bearer token for the cleanup-sessions cron endpoint |
| `DEV_UTORID` | Dev | Fake UTORid injected when Shibboleth is not present |
| `DEV_NAME` | Dev | Display name for the fake dev user |
| `DEV_EMAIL` | Dev | Email for the fake dev user |
| `DEV_ROLE` | Dev | `PROFESSOR` or `STUDENT` — overrides whitelist lookup |

---

## Running Locally (Development)

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v8+
- [Docker](https://www.docker.com/) and Docker Compose

### 1. Clone and install dependencies

```bash
git clone https://github.com/jadenScali/ask_easy.git
cd ask_easy
pnpm install
```

### 2. Configure environment

Copy the example and edit as needed:

```bash
cp .env .env.local
```

Set `DEV_UTORID`, `DEV_NAME`, and `DEV_ROLE` in `.env.local` to control which user you log in as during development. Set `DEV_ROLE=PROFESSOR` to access course management features.

### 3. Start the database and Redis

```bash
docker-compose up -d postgres redis
```

### 4. Set up the database schema

```bash
pnpm db:setup   # generates Prisma client and pushes schema
```

### 5. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The app auto-reloads on changes.

---

## Running in Production

Production uses a pre-built Docker image from Docker Hub layered with the `docker-compose.prod.yml` override. This mounts the auth route, server entry, whitelist, and uploads directory from the host so they can be updated without rebuilding the image.

### 1. Configure `.env`

Create `.env` in the project root with production values (see [Environment Variables](#environment-variables) above). Use the Docker service names as hosts:

```
DATABASE_URL=postgresql://postgres:<password>@postgres:5432/ask_easy
REDIS_URL=redis://:<redis-password>@redis:6379
```

### 2. Pull and start

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

This starts three containers: `app` (Next.js on port 3000, bound to `127.0.0.1`), `postgres`, and `redis`. The app is not publicly exposed — Apache sits in front of it.

### 3. Apply database migrations

```bash
docker exec ask_easy-app-1 npx prisma migrate deploy
```

### 4. Set up Apache + Shibboleth (first time)

Speak to UofT IT Admin.

### Updating the running app

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml pull app
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d app
```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start development server with hot reload |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Format code with Prettier |
| `pnpm test` | Run unit tests (Vitest) |
| `pnpm test:integration` | Run integration tests |
| `pnpm db:setup` | Generate Prisma client + push schema |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:studio` | Open Prisma Studio GUI |
| `pnpm db:seed` | Reset database (clears all tables — destructive) |

---

## Project Structure

```
src/
├── app/                  # Next.js App Router pages & API routes
│   ├── api/              # REST endpoints (auth, courses, sessions, questions, cron)
│   ├── classes/          # Course listing & management UI
│   ├── create-class/     # Course creation flow
│   ├── room/             # Live session room (chat + slide viewer)
│   └── admin/            # Admin dashboard (data overview, table wipe)
├── components/ui/        # Shared UI components (Radix-based)
├── lib/                  # Server utilities (auth, caching, validation, Prisma, Redis)
├── socket/               # Socket.IO server setup, event handlers, middleware
├── services/             # Business logic (sessions, questions, answers, slides)
└── utils/                # Shared types and helpers
prisma/
├── schema.prisma         # Database schema
├── migrations/           # Migration history
└── seed.ts               # Resets all tables (dev use only)
whitelist.txt
admin_whitelist.txt
```

Check out docs/admin_whitelist.txt for more details on setting up admin permissions.

---

## Team

Built by the AskEasy team at **GDG on Campus — UTM** (University of Toronto Mississauga).

- Marwan Yousef
- Jaden Scali
- Phineas Truong
- Jack Le
- Jad El Asmar
- Manjyot Birdi
