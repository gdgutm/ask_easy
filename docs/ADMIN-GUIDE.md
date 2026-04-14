# AskEasy — Administrator Guide

This guide is for professors and system administrators who need to manage the platform — handling course cleanup at the end of a semester, controlling who has professor access, and accessing the database directly if needed.

---

## Role Control Files

Three plain-text files on the server control who can do what. All three live in the project root directory (`~/AskEasy/`).

| File | What it controls |
|------|-----------------|
| `whitelist.txt` | Who gets the **PROFESSOR** role in the app |
| `admin_whitelist.txt` | Who can access the **Admin Dashboard** at `/dashboard` |

Both files are read once at server startup and cached in memory. A restart is required to pick up any changes.

### `whitelist.txt` — who gets the Professor role

Any UTORid listed here is assigned the **PROFESSOR** role when they log in. Everyone else gets the **STUDENT** role by default.

```
# One UTORid per line. Lines starting with # are ignored.
scalij
phintr
yousef10
```

The role is checked on every login, so changes take effect the next time the user logs in.

**To add a new professor:**

```bash
ssh easy@redacted_ip
echo "newutorid" >> ~/AskEasy/whitelist.txt
docker restart ask_easy-app-1
```

**TAs are not listed here.** TAs are assigned per-course by professors through the app UI. A TA has elevated permissions only within the specific course they're assigned to.

### `admin_whitelist.txt` — who can access the Admin Dashboard

Any UTORid listed here gains access to the `/dashboard` admin panel. They must also be a PROFESSOR (i.e., also in `whitelist.txt`) for their role to function correctly, but the dashboard itself only checks this file.

```
# One UTORid per line. Lines starting with # are ignored.
yousef10
```

**To add a new admin:**

```bash
ssh easy@redacted_ip
echo "newutorid" >> ~/AskEasy/admin_whitelist.txt
docker restart ask_easy-app-1
```

Anyone not in this file who tries to visit `/dashboard` is silently redirected to the home page.

---

## Admin Dashboard (`/dashboard`)

The **Dashboard** link appears in the **top-right corner of the home page** — but only if your UTORid is in `admin_whitelist.txt`. It is invisible to everyone else. Visiting `/dashboard` without being on the admin list silently redirects you to the home page.

### Stats bar

At the top of the page, seven live counters give you a snapshot of the platform:

| Counter | What it shows |
|---------|--------------|
| Total Users | Everyone who has ever logged in |
| Total Courses | All courses ever created |
| Active Sessions | Sessions currently live |
| Total Sessions | All sessions ever created |
| Total Questions | All questions ever asked |
| Total Answers | All answers ever posted |
| Enrollments | Total course membership records |

Click **Refresh** (top right of the page) to reload the counts and all table data.

---

### Overview tab

The landing tab when you open the dashboard. It has:

- A reminder about how deletions cascade (e.g. deleting a user removes their questions, answers, and enrollments; deleting a course removes all its sessions and questions)
- The **Danger Zone** — a "Delete Everything" button that wipes the entire database in one action. Requires typing `DELETE EVERYTHING` to confirm. Use this at the end of a term to fully reset the platform.

---

### Users tab

**Columns:** Name, UTORid, Email, Role

**Filters:**
- Search by name or UTORid
- Filter by role (Student / TA / Professor)

**Actions:**
- Delete a single user — removes the user and all their questions, answers, and enrollments across the platform
- **Delete All Users** button — requires typing `DELETE USERS` to confirm; wipes every user record

---

### Courses tab

**Columns:** Code, Name, Semester, Created By, Enrollment count, Session count

**Filters:**
- Search by course code or name

**Actions:**
- Delete a single course — cascades to all its sessions, questions, answers, enrollments, and slides
- **Delete All Courses** button — requires typing `DELETE COURSES` to confirm

---

### Sessions tab

**Columns:** Title, Course, Status (ACTIVE / ENDED), Created By, Question count, Created date

**Filters:**
- Search by session title
- Filter by status (Active / Scheduled / Ended)

**Actions:**
- Delete a single session — removes all its questions, answers, and uploaded slides
- **Delete All Sessions** button — requires typing `DELETE SESSIONS` to confirm

> Deleting sessions here is the recommended way to clear old Q&A data at end of term without touching users or courses.

---

### Slide Sets tab

**Columns:** Metadata for every uploaded PDF, linked to its session

**Actions:**
- Delete individual slide set records
- **Delete All Slide Sets** button

> Note: deleting a slide set record here removes it from the database but does **not** delete the PDF file from disk. To free disk space, also run `rm -rf ~/AskEasy/uploads/*` on the VM.

---

### Questions tab

**Columns:** Question content, session, author, status, timestamps

**Actions:**
- Delete individual questions
- **Delete All Questions** button

---

### Enrollments tab

**Columns:** User name, UTORid, Course, Role (Student / TA / Professor)

**Filters:**
- Search by name, UTORid, or course code
- Filter by role

**Actions:**
- Remove a single enrollment (removes the user from that course only, does not delete the user)
- **Delete All Enrollments** button — requires typing `DELETE ENROLLMENTS` to confirm
- Supports **Load More** pagination (loads 50 at a time)

> Deleting all enrollments at end of term is a clean way to reset course rosters while keeping user accounts intact.

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
ssh easy@redacted_ip

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
| `~/AskEasy/admin_whitelist.txt` | UTORids that can access the `/dashboard` admin panel |
