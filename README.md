# Activity Challenge

A web app for a monthly activity logging challenge. Everyone involved should log an activity 3 times a week for a month.

## Features
- Login / registration with profile picture
- Dashboard bar chart showing every user's profile picture and their logged activity count for the current month, with the leader highlighted (👑 + count above their bar)
- Scrollable carousel of profile pictures with usernames — click one to view that user's activities logged this month
- "Log Activity" button that opens the camera (on mobile) or lets you choose a photo from the gallery, then submits it with an optional note

## Stack
- Frontend: static HTML/CSS/JS (Chart.js via CDN)
- Backend: Node.js + Express
- Database: PostgreSQL
- Containerized with Docker Compose

## Running locally

```bash
docker compose up --build
```

Then open http://localhost:3000

Register a new account (with an optional profile picture) or seed your own users directly in the database.

## Project structure

```
.
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js
│   └── db/init.sql
└── frontend/
    ├── index.html
    ├── style.css
    └── app.js
```

## Notes
- `JWT_SECRET` and database credentials in `docker-compose.yml` are for local development only — change them before deploying to production.
- Uploaded photos (avatars + activity photos) are persisted in the `uploads_data` Docker volume, served at `/uploads/*`.
- Database data is persisted in the `db_data` Docker volume.
- The monthly goal is 3 activities/week × 4 weeks = 12, shown as a progress bar on each user's detail page.
- Camera capture (`capture="environment"`) requires a secure context (HTTPS) to work reliably on mobile browsers. Consider adding a reverse proxy (e.g., nginx + Let's Encrypt) for production deployments.
