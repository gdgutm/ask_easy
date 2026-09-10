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
│   Browser ──HTTPS──▶ Apache + mod_shib ──localhost──▶ App   │
│                            │                                │
│                            ▼                                │
│                      U of T IdP (SAML)                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                       │
│                                                             │
│   ┌──────────────────────────────────────────────────────┐  │
│   │              Node.js Custom Server (server.ts)       │  │
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

| Component                           | Role                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Custom server (`server.ts`)**     | Single Node.js process that boots both Next.js and Socket.IO on the same port. Strips Shibboleth headers from non-localhost connections to prevent spoofing.               |
| **Next.js App Router**              | Serves all pages and REST API routes (`/api/*`). Server Components fetch from PostgreSQL via Prisma; API routes handle auth, course/session management, and slide uploads. |
| **Socket.IO**                       | Handles all real-time events (questions, answers, upvotes, slide page changes). Uses a Redis adapter so multiple app instances share the same pub/sub channel.             |
| **PostgreSQL + Prisma**             | Single source of truth for all persistent data. Prisma handles the schema, migrations, and typed queries.                                                                  |
| **Redis**                           | Three jobs: Socket.IO pub/sub adapter, rate-limit counters (per-user sliding windows), and ephemeral answer-mode state (24-hour TTL).                                      |
| **Apache + mod_shib** _(prod only)_ | Terminates TLS, enforces Shibboleth SSO, and injects `utorid`/`mail`/`cn` headers before proxying to the app.                                                              |

---

## Tech Stack

| Layer            | Technology                                      |
| ---------------- | ----------------------------------------------- |
| Frontend         | Next.js 16, React 19, Tailwind CSS 4, Radix UI  |
| Backend          | Next.js API routes + custom Node.js HTTP server |
| Real-time        | Socket.IO with Redis adapter                    |
| Database         | PostgreSQL 16 (via Prisma ORM)                  |
| Cache / Pub-sub  | Redis 7                                         |
| Auth             | iron-session + Shibboleth header-based SSO      |
| Testing          | Vitest, Testing Library                         |
| Containerization | Docker & Docker Compose                         |

---

## Environment Variables

Both files below are gitignored and live in the project root. **Production does not use them** — the server reads its own file at `/home/easy/secrets/prod.env`, which is created by hand and never touched by a deploy.

### `.env` — base values

```bash
# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<password>
POSTGRES_DB=ask_easy

# Redis
REDIS_PASSWORD=<password>

# Session encryption key — generate with: openssl rand -hex 32
SESSION_SECRET=<64-char-hex>

# Cron job auth (for /api/cron/cleanup-sessions)
CRON_SECRET=<random-secret>

# Admins — comma-separated UTORids, case-insensitive.
# Admins create classlists and assign each one's professors and TAs.
ADMIN_WHITELIST=utorid1
```

`DATABASE_URL` and `REDIS_URL` are **not** listed here. Docker Compose builds them from the values above so the passwords have a single source of truth:

```yaml
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
```

### `.env.local` — local dev only

Loaded after `.env` and overrides it. Needed because `pnpm dev` runs the app outside Docker, so it must reach the containers on `localhost` rather than by service name.

```bash
DATABASE_URL=postgresql://postgres:<password>@localhost:5432/ask_easy
REDIS_URL=redis://:<password>@localhost:6379

# Fake SSO identity for local login
DEV_UTORID=yourutorid
DEV_NAME=Your Name
DEV_EMAIL=your.email@mail.utoronto.ca
```

> **The `DEV_*` variables are ignored in production.** The auth route only reads them when `NODE_ENV !== "production"`; a production request arriving without a Shibboleth header is rejected with a 401 rather than falling back to `DEV_UTORID`. Keep them out of production environments regardless — `docker-compose.override.yml` is the only place they belong.

| Variable                                    | Required | Description                                                                                                      |
| ------------------------------------------- | :------: | ---------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER` / `PASSWORD` / `DB`         |   Yes    | Postgres credentials                                                                                             |
| `REDIS_PASSWORD`                            |   Yes    | Passed to the Redis container as `--requirepass`                                                                 |
| `SESSION_SECRET`                            |   Yes    | Key for iron-session cookie encryption. Changing it logs everyone out.                                           |
| `ADMIN_WHITELIST`                           |   Yes    | UTORids granted `/dashboard` access and the right to create classlists. Empty means nobody can administer.       |
| `CRON_SECRET`                               |   Yes    | Bearer token for the cleanup-sessions cron endpoint                                                              |
| `DATABASE_URL`                              |   Dev    | Only in `.env.local`; Compose derives it otherwise                                                               |
| `REDIS_URL`                                 |   Dev    | Only in `.env.local`; Compose derives it otherwise                                                               |
| `DEV_UTORID`                                |   Dev    | Fake UTORid injected when Shibboleth is not present                                                              |
| `DEV_NAME`                                  |   Dev    | Display name for the fake dev user                                                                               |
| `DEV_EMAIL`                                 |   Dev    | Email for the fake dev user; defaults to `<utorid>@mail.utoronto.ca`                                             |
| `DEV_PROF_*` / `DEV_TA_*` / `DEV_STUDENT_*` |   Dev    | Per-persona `UTORID` / `NAME` / `EMAIL` for `pnpm dev:all`. Each falls back to a default with a startup warning. |
| `SESSION_COOKIE_NAME`                       |    No    | Set per instance by `pnpm dev:all`. Ignored in production.                                                       |
| `NEXT_DIST_DIR`                             |    No    | Set per instance by `pnpm dev:all` so concurrent dev servers don't share `.next`.                                |
| `SOCKET_IO_USE_REDIS`                       |    No    | Set to `"false"` to disable the Socket.IO Redis adapter. Enabled otherwise.                                      |

`ADMIN_WHITELIST` is read once at startup and cached, so restart the app after changing it.

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

Create `.env` and `.env.local` in the project root using the templates in [Environment Variables](#environment-variables) above. Both are gitignored, so a fresh clone has neither.

Put your own UTORid in `ADMIN_WHITELIST`, and set `DEV_UTORID` to the same value so your fake dev login can create classlists and reach `/dashboard`. Everyone else signs in as a student until an admin assigns them to a class.

### 3. Start the database and Redis

```bash
docker-compose up -d postgres redis
```

### 4. Set up the database schema

```bash
pnpm db:generate            # build the Prisma client from schema.prisma
pnpm prisma migrate deploy  # apply all migrations
```

> **Do not use `pnpm db:push` or `pnpm db:setup`.** They change your database directly without creating a migration file, so the change never reaches anyone else or production. Schema changes always go through `pnpm db:migrate`, and the generated migration must be committed.

### 5. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The app auto-reloads on changes.

### Testing multi-user flows: `pnpm dev:all`

A single dev server can only ever be one user — identity comes from `DEV_UTORID` /
`DEV_NAME` / `DEV_ROLE`, which are process-global. To test a student asking a question
while a professor answers it, run multiple instances at once:

```bash
pnpm dev:all          # 1 professor, 1 TA, 1 student (default)
pnpm dev:all 2 1 3    # 2 professors, 1 TA, 3 students
```

Pass three non-negative integers: `<profs> <tas> <students>`. Omit them to get one of
each. Ports are assigned sequentially from `3000`.

Default layout (1 of each):

| Persona   | URL                   | Cookie                |
| --------- | --------------------- | --------------------- |
| `PROF`    | http://localhost:3000 | `askeasy-dev-prof`    |
| `TA`      | http://localhost:3001 | `askeasy-dev-ta`      |
| `STUDENT` | http://localhost:3002 | `askeasy-dev-student` |

Open the instances in tabs of the same window. Each instance gets its own session cookie
name, so they don't clobber each other — browser cookies are keyed by host and ignore
the port, meaning a single shared name would make every tab become whoever logged in
last. All instances share one Postgres and one Redis, which is what lets events broadcast
between them.

Configure each persona in `.env` (all optional — anything missing falls back to a
default and prints a warning at startup):

```bash
DEV_PROF_UTORID=devprof
DEV_PROF_NAME=Dev Professor
DEV_PROF_ROLE=PROFESSOR

DEV_TA_UTORID=devta
DEV_TA_NAME=Dev TA
DEV_TA_ROLE=TA

DEV_STUDENT_UTORID=devstudent
DEV_STUDENT_NAME=Dev Student
DEV_STUDENT_ROLE=STUDENT
```

Extra instances of a label (e.g. a second professor tab) use numbered defaults
(`devprof2`) and can be overridden with `DEV_PROF_2_UTORID` / `_NAME` / `_EMAIL` (same
pattern for `TA` and `STUDENT`).

Notes:

- PROF / TA / STUDENT label which tab is which; they are not roles. Every persona signs
  in as a student. To give one professor or TA rights, sign in as an admin, create a
  classlist and add that persona's UTORid. `ADMIN_WHITELIST` is cached at startup —
  restart after editing.
- Leave `SOCKET_IO_USE_REDIS` unset. With the adapter disabled, events don't cross
  instances: a question asked in one tab won't appear in the others until you refresh.
- Each instance runs its own Next compiler against its own build dir (`.next-prof`,
  `.next-ta`, `.next-student`, …), so expect roughly N× the memory and CPU of `pnpm dev`.
- Instances start one at a time rather than all at once. Next rewrites `next-env.d.ts`
  during startup and each instance wants its own build dir in it, so concurrent
  startups interleave those writes and corrupt the file — which then breaks
  `pnpm typecheck` and the pre-commit hook. Startup therefore scales with instance count.
- `pnpm dev` is unaffected and still uses the `ask_easy_session` cookie, so switching
  between the two modes won't log you out of either.

### Switching branches

`git checkout` only updates tracked files. The Prisma client (`src/generated/`) and `node_modules/` are gitignored, so they keep whatever the previous branch left behind. Run this after switching to any branch that touches `prisma/schema.prisma` or `package.json`:

```bash
pnpm install        # lockfile may differ between branches
pnpm db:generate    # regenerate the Prisma client from this branch's schema
```

Then **restart `pnpm dev`** — the running server holds the old client in memory.

If the branch adds or removes migrations, also apply them:

```bash
pnpm prisma migrate deploy
pnpm prisma migrate status   # should report "Database schema is up to date"
```

If `migrate status` reports migrations applied to the database but missing locally (common when switching between branches with different migration history), reset the local database:

```bash
docker-compose down -v
docker-compose up -d postgres redis
pnpm prisma migrate deploy
```

#### Symptoms of skipping this

| Error                                                                                   | Cause                                         | Fix                                    |
| --------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------- |
| `The column X does not exist in the current database`                                   | Prisma client is from another branch's schema | `pnpm db:generate`, restart dev server |
| `Cannot find module ...`                                                                | Dependencies differ between branches          | `pnpm install`                         |
| `migration ... applied to the database but missing from the local migrations directory` | Migration history differs                     | Reset the local database as above      |

> **Always use `pnpm db:migrate` for schema changes, never `pnpm db:push`.** `db:push` updates your database without creating a migration file, so the change is invisible to everyone else and never reaches production. A missing migration will not surface until a database is rebuilt from scratch.

---

## Deployment

Merging to `main` deploys automatically. GitHub Actions builds and tests the code, pushes the image to Docker Hub, and a self-hosted runner on the VM pulls it, applies migrations, and restarts the app container.

Pull requests run the same build and tests but do not deploy. The workflow is [.github/workflows/cicd.yml](.github/workflows/cicd.yml).

---

## Available Scripts

| Script                       | Description                                        |
| ---------------------------- | -------------------------------------------------- |
| `pnpm dev`                   | Start development server with hot reload           |
| `pnpm build`                 | Build for production                               |
| `pnpm start`                 | Start production server                            |
| `pnpm lint`                  | Run ESLint                                         |
| `pnpm format`                | Format code with Prettier                          |
| `pnpm test`                  | Run unit tests (Vitest)                            |
| `pnpm test:integration`      | Run integration tests                              |
| `pnpm db:generate`           | Generate the Prisma client from `schema.prisma`    |
| `pnpm db:migrate`            | Create and apply a migration after a schema change |
| `pnpm prisma migrate deploy` | Apply existing migrations without creating one     |
| `pnpm db:studio`             | Open Prisma Studio GUI                             |
| `pnpm db:seed`               | Reset database (clears all tables — destructive)   |

`pnpm db:push` and `pnpm db:setup` exist but should not be used — see the warning in [step 4](#4-set-up-the-database-schema).

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
```

Admin access is set with the `ADMIN_WHITELIST` environment variable. Professor and TA rights are granted per class by an admin — see [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md) for details.

---

## Team

Built by the AskEasy team at **GDG on Campus — UTM** (University of Toronto Mississauga).

- Marwan Yousef
- Jaden Scali
- Phineas Truong
- Jack Le
- Jad El Asmar
- Manjyot Birdi
