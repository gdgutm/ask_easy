# AskEasy — Administrator Guide

This guide is for professors and system administrators who need to manage the platform — handling course cleanup at the end of a semester, controlling who has professor access, and accessing the database directly if needed.

---

## Role Control Files

Two plain-text files on the server control who can access what. Both live in the project root directory (`~/AskEasy/`).

### `whitelist.txt` — who gets the Professor role

Any UTORid listed here is assigned the **PROFESSOR** role when they log in. Everyone else gets the **STUDENT** role by default.

```
# One UTORid per line. Lines starting with # are ignored.
scalijad
phintruong
yousef10
```

When a professor logs in, the app reads this file and sets their role for that session. The role is re-checked on every login, so changes take effect the next time the user logs in.

**To add a new professor:**

```bash
ssh <your-utorid>@askeasy.utm.utoronto.ca
echo "newutorid" >> ~/AskEasy/whitelist.txt
docker restart ask_easy-app-1
```

> The restart is needed because the app reads the whitelist at startup and caches it in memory.

**TAs are not listed here.** TAs are assigned per-course by professors through the app UI (see below). A TA has elevated permissions only within the specific course they're assigned to.

---

## Managing Courses Through the App

Professors manage everything through the **Manage Lecture** modal on the `/classes` page. Click "Manage Lecture" on any course card to open it. It has four tabs:

### Students tab

- View the full student roster (searchable by name or UTORid)
- **Remove** individual students by hovering their row and clicking the remove icon
- **Add students** by typing one or more UTORids (comma, space, or newline separated)
- **Sync roster from CSV** — upload a class list CSV exported from ACORN/ROSI. The app shows a preview of who will be added and removed before applying. TAs are not affected by a sync.

### TAs tab

- View and remove current TAs
- Add new TAs by UTORid — same input format as students

### Rename tab

- Update the course code and/or semester label

### Delete tab

- Permanently deletes the course and everything under it: all sessions, questions, answers, upvotes, and uploaded slides
- Requires typing the course code to confirm
- **Blocked if the course has an active session** — end the session first

---

## End of Semester Cleanup

### Step 1 — Delete courses through the app

For each course you want to retire, go to `/classes`, open "Manage Lecture", go to the **Delete** tab, type the course code, and confirm. This cascades through the database and removes all associated sessions, Q&A data, enrollments, and slide records.

### Step 2 — Remove uploaded slide files from disk

Course deletion removes the database records for slides, but the PDF files themselves stay on disk. To free up space:

```bash
ssh <your-utorid>@askeasy.utm.utoronto.ca
rm -rf ~/AskEasy/uploads/*
```

---

## Direct Database Access (VM Method)

If you need to inspect data directly or run a query the app UI doesn't support:

```bash
# SSH into the server
ssh <your-utorid>@askeasy.utm.utoronto.ca

# Open a psql shell inside the Postgres container
docker exec -it ask_easy-postgres-1 psql -U postgres -d ask_easy
```

Useful psql commands:

| Command | What it does |
|---------|-------------|
| `\dt` | List all tables |
| `\q` | Exit psql |
| `SELECT * FROM "User";` | See all users who have logged in |
| `SELECT * FROM "Course";` | See all courses |
| `SELECT * FROM "Session";` | See all sessions |

### Database tables

| Table | What it stores |
|-------|---------------|
| `User` | Everyone who has logged in (UTORid, name, email, global role) |
| `Course` | Courses created by professors |
| `CourseEnrollment` | Which users are in which courses (STUDENT / TA / PROFESSOR) |
| `Session` | Live Q&A sessions within a course |
| `Question` | Questions asked during sessions |
| `Answer` | Answers to questions |
| `QuestionUpvote` / `AnswerUpvote` | Upvote records |
| `SlideSet` | Uploaded PDF metadata (files live in `uploads/`) |

---

## Shibboleth SSO

### How login works

1. User visits `https://askeasy.utm.utoronto.ca`
2. Apache checks for a Shibboleth session. If there isn't one, it redirects to the U of T login page
3. User logs in with their UTORid and password (same as Quercus, ACORN, etc.)
4. The U of T identity provider sends back a SAML assertion. mod_shib validates it and injects `utorid`, `mail`, and `cn` headers into the request
5. Apache proxies the request to the Next.js app, which reads those headers and creates an encrypted session cookie (8-hour TTL)

### Header spoofing prevention

- **Apache** strips any client-supplied identity headers before mod_shib injects the real ones
- **The app** (`src/server.ts`) also strips these headers from any connection that isn't coming from localhost

### Key files on the VM

| File | Purpose |
|------|---------|
| `/etc/apache2/sites-enabled/askeasy.conf` | Apache vhost — TLS, reverse proxy, Shibboleth directives |
| `/etc/shibboleth/shibboleth2.xml` | Shibboleth SP config — entity ID, IdP endpoint, metadata |
| `/etc/shibboleth/utorauth_metadata_verify.crt` | U of T metadata signing certificate |
| `/etc/letsencrypt/live/askeasy.utm.utoronto.ca/` | TLS certificates (auto-renewed by certbot) |
| `~/AskEasy/whitelist.txt` | UTORids that receive the PROFESSOR role |
