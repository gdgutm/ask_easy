# AskEasy — Administrator Guide

This guide is for administrators who need to manage the platform — handling cleanup at the end of a semester, controlling who can create classes, and accessing the database directly if needed.

---

## Who Can Do What

There is no global professor role. Everyone who signs in is a student until an admin
puts them on a class.

| Level         | How it is granted                                               | What it allows                                                   |
| ------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Admin**     | `ADMIN_WHITELIST` env var (`admin_whitelist.txt` on the server) | Create classlists, assign professors and TAs, reach `/dashboard` |
| **Professor** | Assigned by an admin when the classlist is created              | Runs one room — their own. Cannot see other professors' rooms    |
| **TA**        | Assigned by an admin or by the professor of a room              | Answer questions and moderate, inside that one room              |
| **Student**   | On the uploaded classlist, or joins with a room code            | Ask, upvote and reply                                            |

An admin who creates a classlist gets a room of their own (as its professor) plus TA
access to every other room on that classlist, so they can always see what is going on.

### `admin_whitelist.txt` — who can administer

Any UTORid listed here can create classlists and reach the `/dashboard` admin panel.
The file is read once at server startup and cached in memory, so a restart is required
to pick up changes.

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

**To add a new professor**, no server access is needed: an admin creates the classlist
in the app and types the professor's UTORid. There is no `whitelist.txt` any more.

Anyone not in this file who tries to visit `/dashboard` is silently redirected to the home page.

---

## Admin Dashboard (`/dashboard`)

The **Dashboard** link appears in the **top-right corner of the home page** — but only if your UTORid is in `admin_whitelist.txt`. It is invisible to everyone else. Visiting `/dashboard` without being on the admin list silently redirects you to the home page.

### Stats bar

At the top of the page, eight live counters give you a snapshot of the platform:

| Counter         | What it shows                                                                   |
| --------------- | ------------------------------------------------------------------------------- |
| Total Users     | Everyone who has ever logged in                                                 |
| Classlists      | All classlists ever created                                                     |
| Rooms           | All rooms ever created — one per professor, so this exceeds the classlist count |
| Active Sessions | Sessions currently live                                                         |
| Total Sessions  | All sessions ever created                                                       |
| Total Questions | All questions ever asked                                                        |
| Total Answers   | All answers ever posted                                                         |
| Enrollments     | Total room membership records                                                   |

Click **Refresh** (top right of the page) to reload the counts and all table data.

---

### Overview tab

The landing tab when you open the dashboard. It has:

- A reminder about how deletions cascade (e.g. deleting a user removes their questions, answers, and enrollments; deleting a room removes all its sessions and questions)
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

### Rooms tab

**Columns:** Code, Name, Semester, Created By, Enrollment count, Session count

**Filters:**

- Search by class code, room name, or the professor who runs it

**Actions:**

- Delete a single room — cascades to all its sessions, questions, answers, enrollments, and slides. Deleting the last room on a classlist removes the classlist too
- **Delete All Rooms** button — requires typing `DELETE COURSES` to confirm

---

### Sessions tab

**Columns:** Title, Course, Status (ACTIVE / ENDED), Created By, Question count, Created date

**Filters:**

- Search by session title
- Filter by status (Active / Scheduled / Ended)

**Actions:**

- Delete a single session — removes all its questions, answers, and uploaded slides
- **Delete All Sessions** button — requires typing `DELETE SESSIONS` to confirm

> Deleting sessions here is the recommended way to clear old Q&A data at end of term without touching users or rooms.

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

- Search by name, UTORid, or class code
- Filter by role

**Actions:**

- Remove a single enrollment (removes the user from that room only, does not delete the user)
- **Delete All Enrollments** button — requires typing `DELETE ENROLLMENTS` to confirm
- Supports **Load More** pagination (loads 50 at a time)

> Deleting all enrollments at end of term is a clean way to reset rosters while keeping user accounts intact.

---

## Managing Classes Through the App

Admins manage a class from the **gear icon** on its card on the home page. It has
four tabs:

### Students tab

- The pooled roster across every room on the class
- Add students by UTORid — they are enrolled in every room
- Sync the roster from a fresh CSV, with a diff preview before it applies
- Removing a student drops them from every room

### Rooms & TAs tab

- One row per room, showing who runs it, how many members it has, and whether it is live
- Click a room's name to rename it. The name is the room's, not the professor's — it is yours to set and nothing else ever changes it
- Add a professor — this creates them a room, with the name you give it, seeded with the current roster and TAs
- Remove a professor — this **deletes their room and everything in it**. Blocked on the last professor and on a live room
- Add TAs by UTORid — they become TAs in every room on the class

A professor manages TAs on their own room from inside a live session, via the
Manage TAs button in the chat header. That affects their room only.

### Rename tab

- Update the class code and/or semester label
- The change fans out to every room, so none is left showing the old code

### Delete tab

- Permanently deletes the class, all its rooms, and everything under them: sessions, questions, answers, upvotes, and uploaded slides
- Requires typing the class code to confirm
- **Blocked while any room is live** — end the session first

---

## End-of-Semester Cleanup

### Step 1 — Delete classes through the app

For each class you want to retire, open its gear icon on the home page, go to the **Delete** tab, type the class code, and confirm. This cascades through the database and removes every room on the class along with all associated sessions, Q&A data, enrollments, and slide records.

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

| Command                    | What it does                     |
| -------------------------- | -------------------------------- |
| `\dt`                      | List all tables                  |
| `\q`                       | Exit psql                        |
| `SELECT * FROM "User";`    | See all users who have logged in |
| `SELECT * FROM "Course";`  | See all rooms                    |
| `SELECT * FROM "Session";` | See all sessions                 |

### Database tables

| Table                             | What it stores                                                |
| --------------------------------- | ------------------------------------------------------------- |
| `User`                            | Everyone who has logged in (UTORid, name, email, global role) |
| `Classlist`                       | A class an admin uploaded: code, semester, roster             |
| `Course`                          | A **room** — one professor's space inside a classlist         |
| `CourseEnrollment`                | Which users are in which rooms (STUDENT / TA / PROFESSOR)     |
| `Session`                         | Live Q&A sessions within a room                               |
| `Question`                        | Questions asked during sessions                               |
| `Answer`                          | Answers to questions                                          |
| `QuestionUpvote` / `AnswerUpvote` | Upvote records                                                |
| `SlideSet`                        | Uploaded PDF metadata (files live in `uploads/`)              |

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

| File                                             | Purpose                                                    |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `/etc/apache2/sites-enabled/askeasy.conf`        | Apache vhost — TLS, reverse proxy, Shibboleth directives   |
| `/etc/shibboleth/shibboleth2.xml`                | Shibboleth SP config — entity ID, IdP endpoint, metadata   |
| `/etc/shibboleth/utorauth_metadata_verify.crt`   | U of T metadata signing certificate                        |
| `/etc/letsencrypt/live/askeasy.utm.utoronto.ca/` | TLS certificates (auto-renewed by certbot)                 |
| `~/AskEasy/admin_whitelist.txt`                  | UTORids that can create classlists and access `/dashboard` |
