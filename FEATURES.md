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
- **Two-tier roles**:
  - **Global role** — determined from `whitelist.txt` on every login (PROFESSOR or STUDENT)
  - **Per-course role** — stored in `CourseEnrollment` (PROFESSOR, TA, or STUDENT)
- **Whitelist** — plain text file of UTORids; case-insensitive; supports legacy `utorid,PROFESSOR` format
- **Effective permissions** — course/session actions use the per-course enrollment role, not the global role

### Endpoints
| Endpoint | Description |
|----------|-------------|
| `GET /api/auth/session` | Establishes session from Shibboleth/dev headers |
| `GET /api/auth/me` | Returns current user info (userId, utorid, name, email, role) |
| `POST /api/auth/logout` | Destroys session cookie |

---

## Course Management

### Creation
- Professors create courses with a course code, name, and optional section
- **Semester auto-detection** from current date (Jan–Apr = Winter, May–Aug = Summer, Sep–Dec = Fall)
- **CSV enrollment** — upload a CSV with columns: `utorid`, `givenName`, `surname`, `Email` (optional); rows with "Missing UTORid" or "ERROR" are skipped
- **TA assignment** — professors can designate TAs during course creation

### Operations
- **Rename** — professor can update course code and/or semester
- **Delete** — cascading deletion (questions, answers, upvotes, slide sets, sessions, enrollments); blocked if an ACTIVE session exists

### Student & TA Management
- **View roster** — returns students and TAs with name and UTORid
- **Add individuals** — add one or more UTORids; returns added, already-enrolled, and invalid lists
- **Batch sync** — full replace of the STUDENT roster from a new CSV; preserves TAs and professor
- **Remove** — remove a single student by UTORid
- **Auto-creation** — users not yet in the database are created automatically on enrollment
- **CSV diff preview** — before applying a sync, shows counts of students to add, remove, and unchanged

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
- **Delete** — professors can delete any question; TAs can delete student questions; students cannot delete
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
- **Exception**: the question author can always answer their own question regardless of mode
- **Default**: instructors only
- Stored in Redis with 24-hour TTL; late joiners sync on connect

---

## Slide Viewer

### Upload
- **PDF only** — validated by MIME type, magic bytes, and parseability
- **Size limits** — 1 KB to 50 MB
- Professor-only; session must be ACTIVE

### Viewing
- Served inline with `Content-Disposition: inline` and 1-hour cache
- Auth-gated: must be enrolled in the session's course

### Real-Time Sync
- Professor changes the page index; broadcast to all participants via `slide:changed`
- Late joiners call `slide:sync` to get the current page
- New upload triggers `slides:available` notification to the room

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

| Action | Limit | Window |
|--------|-------|--------|
| Question creation | 10 | 60 s |
| Question upvote | 30 | 60 s |
| Question resolve/unresolve | 20 | 60 s |
| Answer creation | 15 | 60 s |
| Answer upvote | 30 | 60 s |
| Join code lookup | 30 | 60 s |
| Join code registration | 10 | 60 s |
| Join code regeneration | 5 | 1 hour |

If Redis is unavailable, rate limiting fails closed (blocks all requests).

---

## Permissions Matrix

### Course Operations

| Action | Student | TA | Professor |
|--------|:-------:|:--:|:---------:|
| Create course | | | Yes |
| View own courses | Yes | Yes | Yes |
| Rename course | | | Yes (owner) |
| Delete course | | | Yes (owner) |
| View roster | | | Yes (owner) |
| Add/remove students | | | Yes (owner) |
| Sync CSV roster | | | Yes (owner) |

### Session Operations

| Action | Student | TA | Professor |
|--------|:-------:|:--:|:---------:|
| Create session | | | Yes |
| Join via code | Yes | Yes | N/A |
| End session | | | Yes (creator) |
| Regenerate join code | | | Yes (creator) |
| Upload slides | | | Yes |
| Control slide page | | | Yes |

### Question Operations

| Action | Student | TA | Professor |
|--------|:-------:|:--:|:---------:|
| Ask question | Yes | Yes | Yes |
| Upvote | Yes | Yes | Yes |
| Resolve own | Yes | Yes | Yes |
| Resolve others' | | Yes | Yes |
| Unresolve | | Yes | Yes |
| Delete (student Qs) | | Yes | Yes |
| Delete (TA Qs) | | | Yes |
| See INSTRUCTOR_ONLY | | Yes | Yes |

### Answer Operations

| Action | Student | TA | Professor |
|--------|:-------:|:--:|:---------:|
| Answer (open mode) | Yes | Yes | Yes |
| Answer (restricted mode) | Own Q only | Yes | Yes |
| Upvote | Yes | Yes | Yes |
| Delete (student As) | | Yes | Yes |
| Delete (TA As) | | | Yes |

---

## Content Constraints

| Item | Min | Max |
|------|-----|-----|
| Question | 5 chars | 500 chars |
| Answer | 1 char | 1,000 chars |
| Session title | 3 chars | 100 chars |
| Slide file | 1 KB | 50 MB |

---

## Socket.IO Events

### Client → Server

| Event | Payload |
|-------|---------|
| `question:create` | `{content, sessionId, visibility?, isAnonymous?}` |
| `question:upvote` | `{questionId}` |
| `question:resolve` | `{questionId}` |
| `question:unresolve` | `{questionId}` |
| `question:delete` | `{questionId, sessionId}` |
| `answer:create` | `{questionId, content, isAnonymous?}` |
| `answer:upvote` | `{answerId}` |
| `answer:delete` | `{answerId, sessionId}` |
| `answer-mode:change` | `{sessionId, mode}` |
| `answer-mode:sync` | `{sessionId}` |
| `slide:change` | `{sessionId, pageIndex}` |
| `slides:uploaded` | `{sessionId, slideSetId}` |
| `slide:sync` | `{sessionId}` |

### Server → Client

| Event | Description |
|-------|-------------|
| `question:created` | New question (author redacted if anonymous) |
| `question:updated` | Upvote count changed |
| `question:resolved` | Status → RESOLVED |
| `question:unresolved` | Status → OPEN |
| `question:deleted` | Question removed |
| `question:author:revealed` | Anonymous author disclosed (instructors only) |
| `answer:created` | New answer (author redacted if anonymous) |
| `answer:updated` | Upvote count changed |
| `answer:deleted` | Answer removed |
| `answer:author:revealed` | Anonymous author disclosed (instructors only) |
| `answer-mode:changed` | Answer restriction toggled |
| `slide:changed` | Page index updated |
| `slides:available` | New slide set uploaded |
| `slide:sync` | Current page index (to requesting socket only) |
| `session:ended` | Session has ended |
| `question:error` | Error on question operation |
| `answer:error` | Error on answer operation |
| `slide:error` | Error on slide operation |

### Room Names
- `session:{sessionId}` — all participants
- `session:{sessionId}:instructors` — TAs and professors only
