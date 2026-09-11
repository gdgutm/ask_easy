# AskEasy — Feature List

A comprehensive list of every feature in the AskEasy platform.

---

## Authentication & Authorization

### Authentication

- **Shibboleth SSO** — Production login via UofT's SAML identity provider (reads `utorid`, `displayname`, `email` headers from Apache mod_shib)
- **Dev login** — Local development uses `DEV_UTORID`, `DEV_NAME`, `DEV_EMAIL` environment variables
- **Session cookies** — iron-session sealed httpOnly cookies
- **Open redirect protection** — Post-login redirects restricted to same-origin relative paths

### Role System

- **Roles are per class** — stored in `CourseEnrollment` (PROFESSOR, TA, or STUDENT). Every login writes `User.role = STUDENT`; there is no global professor role to authorize on.
- **Admins** — `ADMIN_WHITELIST` (case-insensitive UTORids) is the only global permission. Admins create classlists and assign each one's professors and TAs.
- **Effective permissions** — every course/session action resolves the caller's `CourseEnrollment` role for that specific course

### Endpoints

| Endpoint                | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| `GET /api/auth/session` | Establishes session from Shibboleth/dev headers               |
| `GET /api/auth/me`      | Returns current user info (userId, utorid, name, email, role) |
| `POST /api/auth/logout` | Destroys session cookie                                       |

---

## Classlists and Rooms

A **classlist** is what an admin uploads: one course code, one semester, one
student roster. It owns one **room** per professor — a room is where the Q&A
actually happens, and it has exactly one professor.

### Creation

- **Admins only** (`ADMIN_WHITELIST`). Professors are assigned to a class; they do not make one
- **Semester auto-detection** from current date (Jan–Apr = Winter, May–Aug = Summer, Sep–Dec = Fall)
- **CSV enrollment** — upload a CSV with columns: `utorid`, `givenName`, `surname`, `Email` (optional); rows with "Missing UTORid" or "ERROR" are skipped
- **One room per professor** — the creating admin gets a room of their own plus TA access to every other room; each other professor gets one room and no access to the rest
- **Room names** — the admin types a name for each professor's room (the creator's own defaults to their surname). It is the room's name, not the professor's: signing in never rewrites it, and only an admin changes it afterwards
- **TA assignment** — TAs added at creation are TAs in every room on the class

### Who sees what

|                  | Their own room | Other rooms on the class |
| ---------------- | -------------- | ------------------------ |
| Creating admin   | PROFESSOR      | TA                       |
| Other professors | PROFESSOR      | No access at all         |
| TAs              | —              | TA in all                |
| Students         | —              | STUDENT in all           |

Students see one card per class and open it to pick a room. A professor's class
opens onto exactly one room. Join codes respect this too: a professor cannot use
one to enter a colleague's room on the same class.

### Operations

- **Rename** — an admin updates the class code and/or semester; the change fans out to every room
- **Delete** — cascading deletion (questions, answers, upvotes, slide sets, sessions, enrollments) across all rooms; blocked while any room is live
- **Add a professor** — creates a room, named by the admin, seeded with the current roster and TAs
- **Rename a room** — admin-only; the professor of a room cannot rename it
- **Remove a professor** — deletes their room; blocked on the last professor and on a live room

### Roster Management

- **View roster** — pooled across rooms; the strongest role wins, so a TA in one room is a TA on the class
- **Add individuals** — added to every room on the class
- **Batch sync** — full replace of the STUDENT roster from a new CSV, across every room; preserves TAs and professors
- **Remove** — a TA is demoted to student, a student is dropped; a room's professor is refused and sent to the professors endpoint
- **Auto-creation** — users not yet in the database are created automatically on enrollment
- **CSV diff preview** — before applying a sync, shows counts of students to add, remove, and unchanged
- **Room-level TAs** — a professor assigns TAs on their own room from inside a live session; a room takes only one professor, so that route refuses PROFESSOR

---

## Session Management

### Lifecycle

- **Statuses**: ACTIVE, ENDED
- **Creation** — professor creates a session with a title (3–100 characters); starts as ACTIVE immediately
- **Manual end** — professor ends the session; broadcasts `session:ended` to all connected clients; cleans up Q&A data and slide files
- **Auto-end** — sessions with no question activity for 2 hours are automatically ended

### Join Codes

- **Format** — 6-character uppercase alphanumeric code
- **Case-insensitive lookup**
- **Regeneration** — professor can regenerate the code (rate limit: 5 per hour)
- **Join flow** — students enter the code to join; auto-enrolled in the course if not already a member
- **Ended sessions** — attempting to join returns 410 Gone

### Activity Tracking

- `lastActivityAt` updated on every question creation
- Used by the auto-end check (cutoff = 2 hours of inactivity)

### Cron Cleanup

- `GET /api/cron/cleanup-sessions` — secured by `CRON_SECRET` bearer token
- Finds and ends all stale ACTIVE sessions in parallel
- Returns `{ended: N, failed: M}`

---

## Live Q&A Room

### Questions

- **Create** — 5–500 characters; optional anonymous flag and visibility setting
- **Visibility** — PUBLIC (everyone) or INSTRUCTOR_ONLY (TAs and professors only)
- **Upvote** — toggle per user; updates count in real time
- **Resolve** — marks question as RESOLVED; students can resolve their own, TAs/professors can resolve any
- **Unresolve** — TAs/professors can reopen a resolved question
- **Delete** — anyone can delete their own question; professors can delete any question; TAs can additionally delete student questions
- **Filtering** — by status: All, Unresolved, Resolved
- **Search** — case-insensitive substring match on question content
- **Sorting** — newest first (default) or by vote count
- **Pagination** — cursor-based, 20 per page (max 50)

### Answers

- **Create** — 1–1,000 characters; optional anonymous flag
- **Upvote** — toggle per user; updates count in real time
- **Delete** — same permission rules as questions
- **Accepted answers** — `isAccepted` field; accepted answers sort first and display a checkmark icon
- **Thread states** — default (shows accepted/best answers), expanded (all replies), collapsed (hidden)

### Anonymous Posting

- Questions and answers can be posted anonymously
- **Students** see "Anonymous" as the author
- **TAs and professors** receive a separate `author:revealed` event showing the real identity and role

### Answer Mode Restriction

- Professor can toggle between "all" (everyone can answer) and "instructors_only" (only TAs/professors can answer)
- **Exception**: the question author can always answer their own question regardless of mode — unless they asked anonymously, since with everyone else locked out a reply would identify them as the asker
- **Default**: instructors only
- Stored in Redis with 24-hour TTL; late joiners sync on connect

---

## Slide Viewer

### Upload

- **PDF only** — validated by MIME type, magic bytes, and parseability
- **Size limits** — 1 KB to 50 MB
- Professor-only (a TA can drive the deck but never replace it); session must be ACTIVE

### Viewing

- Served inline with `Content-Disposition: inline` and 1-hour cache
- Auth-gated: must be enrolled in the session's course

### Real-Time Sync

- **One person drives at a time.** The room's professor and its TAs may each take the deck; taking it displaces whoever had it. Uploading stays the professor's alone
- The holder's page changes are broadcast to every participant via `slide:changed`; `slide:change` from anyone who is not currently holding the deck is refused
- Control is held in Redis (`slide-controller:{sessionId}`, 24 h) and is **unclaimed by default** — until someone presses the button it belongs to the room's professor, so starting a lecture needs no extra step
- `slide:control:take` claims it and pulls the room to the taker's current page, so taking over while reading ahead brings everyone along. `slide:control:changed` tells the room who is driving, which is what returns the displaced holder's toolbar to the following view
- Late joiners call `slide:sync` and get both the current page and the current holder
- New upload triggers `slides:available` notification to the room
- Ending a lecture clears the slide position, the controller and the answer mode

### Viewer toolbar

| Who                              | What they see                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Holding the deck**             | Controlling badge, viewer count, page controls — plus Replace and End Lecture if they are the professor |
| **Professor or TA, not holding** | Exactly the student bar, plus a **Control Slides** button                                               |
| **Student**                      | Following Live / Browse Freely, page controls when browsing                                             |

A professor who has been taken over lands on the same bar a TA sees, with the
same button back — so control can pass back and forth without anyone needing to
release it first.

### Split View

- Resizable panel layout — Q&A chat and slide viewer side by side
- Panels adapt based on screen size (mobile detection via `useMediaQuery`)

---

## Chat History Export

- **Format** — plain text (`.txt`, UTF-8)
- **Content includes**:
  - Session title header with date/time
  - Each question with timestamp, author (name + UTORid or "Anonymous"), and content
  - Each answer indented under its question with the same format
  - Separator lines between questions
- **Filename** — `{sessionTitle}_chat.txt` (special characters replaced with underscores)
- **Trigger** — modal appears when professor ends the session, offering:
  - "Download chat history & end"
  - "End without downloading"

---

## UI / UX

- **Resizable split view** — drag to resize Q&A panel vs. slide panel
- **Responsive layout** — adapts to mobile via media query detection
- **Keyboard shortcut** — Ctrl+Enter submits a question or answer
- **Filter tabs** — All / Unresolved / Resolved
- **Live search** — filter questions by text with a clear button
- **Thread collapse/expand** — chevron toggle per question thread
- **Loading skeletons** — placeholder UI while data loads
- **Toast notifications** — success/error feedback (e.g., "Course updated successfully")
- **Undo** — unresolve action available as an undo button on resolved questions

---

## Rate Limits

All rate limits are per-user, enforced via Redis counters.

| Action                     | Limit | Window |
| -------------------------- | ----- | ------ |
| Question creation          | 2     | 10 s   |
| Question upvote            | 10    | 10 s   |
| Question resolve/unresolve | 10    | 10 s   |
| Answer creation            | 5     | 10 s   |
| Answer upvote              | 10    | 10 s   |
| Join code lookup           | 30    | 60 s   |
| Join code registration     | 10    | 60 s   |
| Join code regeneration     | 5     | 1 hour |

Upvotes share one counter across questions and answers, as do resolve and unresolve.
A refused action returns a short message the client shows as a toast.

If Redis is unavailable, rate limiting fails closed (blocks all requests).

---

## Permissions Matrix

### Class Operations

| Action                   | Student | TA  | Professor | Admin |
| ------------------------ | :-----: | :-: | :-------: | :---: |
| Create a classlist       |         |     |           |  Yes  |
| View own classes/rooms   |   Yes   | Yes |    Yes    |  Yes  |
| Rename a class           |         |     |           |  Yes  |
| Delete a class           |         |     |           |  Yes  |
| Add/remove a professor   |         |     |           |  Yes  |
| View class roster        |         |     |           |  Yes  |
| Add/remove students, TAs |         |     |           |  Yes  |
| Sync CSV roster          |         |     |           |  Yes  |
| Manage TAs on own room   |         |     |    Yes    | Yes¹  |

¹ On the room they run. An admin is a TA in the other rooms on their classes, not their professor.

### Session Operations

| Action               | Student |  TA  |   Professor   |
| -------------------- | :-----: | :--: | :-----------: |
| Create session       |         |      |      Yes      |
| Join via code        |   Yes   | Yes  |      N/A      |
| End session          |         |      | Yes (creator) |
| Regenerate join code |         |      | Yes (creator) |
| Upload slides        |         |      |      Yes      |
| Take slide control   |         | Yes  |      Yes      |
| Move the shared deck |         | Yes¹ |     Yes¹      |
| Browse slides freely |   Yes   | Yes  |      Yes      |

¹ Only while holding control — one person at a time.

### Question Operations

| Action              | Student | TA  | Professor |
| ------------------- | :-----: | :-: | :-------: |
| Ask question        |   Yes   | Yes |    Yes    |
| Upvote              |   Yes   | Yes |    Yes    |
| Resolve own         |   Yes   | Yes |    Yes    |
| Resolve others'     |         | Yes |    Yes    |
| Unresolve           |         | Yes |    Yes    |
| Delete own          |   Yes   | Yes |    Yes    |
| Delete (student Qs) |         | Yes |    Yes    |
| Delete (TA Qs)      |         |     |    Yes    |
| See INSTRUCTOR_ONLY |         | Yes |    Yes    |

### Answer Operations

| Action                   |                Student                | TA  | Professor |
| ------------------------ | :-----------------------------------: | :-: | :-------: |
| Answer (open mode)       |                  Yes                  | Yes |    Yes    |
| Answer (restricted mode) | Own Q only (not if asked anonymously) | Yes |    Yes    |
| Upvote                   |                  Yes                  | Yes |    Yes    |
| Delete own               |                  Yes                  | Yes |    Yes    |
| Delete (student As)      |                                       | Yes |    Yes    |
| Delete (TA As)           |                                       |     |    Yes    |

---

## Content Constraints

| Item          | Min     | Max         |
| ------------- | ------- | ----------- |
| Question      | 5 chars | 500 chars   |
| Answer        | 1 char  | 1,000 chars |
| Session title | 3 chars | 100 chars   |
| Slide file    | 1 KB    | 50 MB       |

---

## Socket.IO Events

### Client → Server

| Event                | Payload                                           |
| -------------------- | ------------------------------------------------- |
| `question:create`    | `{content, sessionId, visibility?, isAnonymous?}` |
| `question:upvote`    | `{questionId}`                                    |
| `question:resolve`   | `{questionId}`                                    |
| `question:unresolve` | `{questionId}`                                    |
| `question:delete`    | `{questionId, sessionId}`                         |
| `answer:create`      | `{questionId, content, isAnonymous?}`             |
| `answer:upvote`      | `{answerId}`                                      |
| `answer:delete`      | `{answerId, sessionId}`                           |
| `answer-mode:change` | `{sessionId, mode}`                               |
| `answer-mode:sync`   | `{sessionId}`                                     |
| `slide:change`       | `{sessionId, pageIndex}`                          |
| `slides:uploaded`    | `{sessionId, slideSetId}`                         |
| `slide:sync`         | `{sessionId}`                                     |

### Server → Client

| Event                      | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `question:created`         | New question (author redacted if anonymous)    |
| `question:updated`         | Upvote count changed                           |
| `question:resolved`        | Status → RESOLVED                              |
| `question:unresolved`      | Status → OPEN                                  |
| `question:deleted`         | Question removed                               |
| `question:author:revealed` | Anonymous author disclosed (instructors only)  |
| `answer:created`           | New answer (author redacted if anonymous)      |
| `answer:updated`           | Upvote count changed                           |
| `answer:deleted`           | Answer removed                                 |
| `answer:author:revealed`   | Anonymous author disclosed (instructors only)  |
| `answer-mode:changed`      | Answer restriction toggled                     |
| `slide:changed`            | Page index updated                             |
| `slides:available`         | New slide set uploaded                         |
| `slide:sync`               | Current page index (to requesting socket only) |
| `session:ended`            | Session has ended                              |
| `question:error`           | Error on question operation                    |
| `answer:error`             | Error on answer operation                      |
| `slide:error`              | Error on slide operation                       |

### Room Names

- `session:{sessionId}` — all participants
- `session:{sessionId}:instructors` — TAs and professors only
