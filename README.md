# TaskFlow: Real-Time Collaborative Project Management

A Trello/Asana-style tool where teams create projects, assign tasks on Kanban boards, and discuss work in per-task comment threads. Updates and notifications arrive instantly over WebSockets.

**Live demo:** _add your Render URL here_ · Click **"Try the live demo"** on the login page for a pre-filled workspace.

## Features
- JWT authentication (bcrypt-hashed passwords, rate-limited auth endpoints)
- Group projects with member invites (by email)
- Kanban board with drag-and-drop between columns and persistent ordering
- Task assignment, priority, due dates (overdue highlighting), descriptions
- Comment threads inside every task, delivered live to everyone on the board
- **Bonus:** real-time updates (task create/move/edit/delete, comments, member changes) and a notification centre (assigned to you, comments, invites) via Socket.io
- Project dashboard with progress bars and stats, animated UI, responsive layout

## Tech stack
| Layer | Tech |
|---|---|
| Frontend | Vanilla JS SPA (no build step), CSS animations, HTML5 drag & drop |
| Backend | Node.js, Express, Socket.io |
| Database | MongoDB + Mongoose |
| Security | JWT, bcrypt, Helmet (CSP), CORS, rate limiting, membership checks on every endpoint, XSS-safe DOM building |

## Architecture
```
Browser ──REST (JWT)──► Express routes ──► MongoDB (User, Project, Task, Comment, Notification)
   ▲                         │
   └──── Socket.io ◄─────────┘  rooms: project:<id> (board events), user:<id> (notifications)
```
Sockets authenticate with the same JWT; a user can only join the room of a project they belong to.

## REST API
| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/auth/register, /login, /demo | Auth |
| GET | /api/auth/me | Current user |
| GET/POST | /api/projects | List / create projects |
| GET/DELETE | /api/projects/:id | Board data / delete (owner) |
| POST | /api/projects/:id/members | Invite by email |
| POST | /api/tasks | Create task |
| PATCH/DELETE | /api/tasks/:id | Edit, move, assign / delete |
| GET/POST | /api/tasks/:id/comments | Task discussion |
| GET | /api/notifications, POST /read-all | Notifications |

## Run locally
```bash
npm install
cp .env.example .env        # set JWT_SECRET, MONGODB_URI
npm start                   # http://localhost:4000
```
No local MongoDB? `docker compose up --build` starts the app and a database together.

## Deploy (free): MongoDB Atlas + Render
1. **Atlas:** create a free M0 cluster, add a database user, allow network access `0.0.0.0/0`, copy the connection string.
2. **Push to GitHub** (see below).
3. **Render:** New → Web Service → connect the repo. Build: `npm install`, Start: `npm start`.
4. Environment variables: `MONGODB_URI` (Atlas string), `JWT_SECRET` (long random string).
5. Open the Render URL. WebSockets work out of the box.

## Push to GitHub
```bash
git init && git add . && git commit -m "Initial commit: TaskFlow"
git branch -M main
git remote add origin https://github.com/<your-username>/taskflow.git
git push -u origin main
```

## Resume bullets
- Built a full-stack, real-time project management platform (Node.js, Express, MongoDB, Socket.io) with JWT auth, Kanban boards, task assignment, and threaded comments.
- Implemented WebSocket rooms for live board sync and a persistent notification system; secured the API with Helmet CSP, bcrypt, rate limiting and per-project authorization.
- Deployed to Render + MongoDB Atlas; designed an animated, responsive UI with drag-and-drop and no front-end framework dependencies.

## Ideas to extend
File attachments, activity log, labels/filters, custom columns UI, email notifications, unit/integration tests (Jest + Supertest).

---
## What's new in v1.1
- **Insights tab:** animated SVG donut (tasks by status), priority mix and workload-per-person bar charts, KPI cards (total, completed, overdue, completion %)
- **Dashboard 2.0:** count-up stat cards and a "My open tasks" panel aggregated across every project
- **Search and filters** (text, assignee, priority) with a `/` keyboard shortcut
- **Task checklists** with progress bars on cards
- **Light / dark theme** toggle (remembered per browser)
- Animated landing page with a live Kanban mock-up
- Repo hygiene: GitHub Actions CI, `render.yaml` blueprint (one-click Render deploy), Dockerfile, MIT licence

## Screenshots
Place images in `docs/screenshots/` and embed them here, e.g. `![Board](docs/screenshots/board.png)`.

---
## What's new in v1.2
- **Forgot password:** emailed reset link (single-use, 1-hour expiry, hashed token, rate-limited) sent via Brevo's HTTPS API
- **Show / hide password** toggle and confirm-password on sign-up and reset

---
## What's new in v1.3
- **Smart quick-add:** type `Fix login bug tomorrow !high @ava` and TaskFlow extracts the due date (today, tomorrow, weekdays, `in 3 days`), priority and assignee, with live preview chips
- **Calendar view:** month grid of due dates, click a task to open it
- **Live activity feed:** a real-time audit trail of who created, moved, assigned, edited, deleted and commented
- **Live presence:** green rings show which teammates are viewing the board right now
- **Command palette (Ctrl+K):** jump to any project or task, switch views, export, toggle theme
- **Due-date reminders:** each assignee gets one in-app notification when a task is due within 24 hours
- **CSV export** (spreadsheet-formula-injection safe) and keyboard shortcuts (`/`, `N`, `?`, `Ctrl+K`)

---
## What's new in v1.4
- **Labels and smart filtering:** add up to eight normalized labels per task, show them on cards, filter a board by label, and include labels in CSV exports.
- **Production readiness:** explicit production secret checks, database-aware health reporting for Render/Docker, graceful shutdown on deploys, and faster task-board indexes.
- **Data hygiene:** deleting a task or project now removes its related activity and notifications instead of leaving stale records behind.
