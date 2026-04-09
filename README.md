# KnightScribeAI

This app runs a Vite frontend and a local Express backend proxy for OpenWebUI.

## Setup

Create `.env.local` in the project root:

```env
OPENWEBUI_JWT_TOKEN=your_jwt_token
OPENWEBUI_BASE_URL=https://your-openwebui-host
OPENWEBUI_MODEL=your-openwebui-model
```

Important:

- `OPENWEBUI_BASE_URL` should be the host root, not a path that already ends in `/api`.
- The backend already appends `/api/chat/completions` internally.

Install dependencies and start both servers:

```bash
npm install
npm run dev
```

Frontend:

- Vite runs on `http://localhost:3000`
- Requests to `/backend/*` are proxied to the local backend on `http://localhost:4000`

Backend:

- Express runs on `http://localhost:4000`
- `/api/chat` forwards chat requests to OpenWebUI using only `OPENWEBUI_MODEL`
- `/api/ocr` is disabled
- `/health` reports local backend config state

## What Changed And Why

The OpenWebUI integration was updated in a few places to fix real runtime failures:

- Added `express` to `package.json`.
  Why: the backend proxy in `backend/server.js` depends on Express, and without it nothing listens on port `4000`, which causes Vite proxy `ECONNREFUSED` errors.

- Changed the frontend connection test to stop hardcoding `gemma3:4b`.
  Why: the test should validate endpoint access, not fail because one specific model is missing. The backend now always uses `OPENWEBUI_MODEL` from `.env.local`.

- Kept frontend requests pointed at `/backend/api/chat`.
  Why: the browser should talk only to the local proxy. This avoids CORS issues and keeps the JWT token on the backend.

- Changed file uploads to run staged preprocessing immediately (PDF/DOCX/TXT extraction + rubric parsing) and store compact artifacts.
  Why: grading should not ship raw base64 files in one giant final prompt. Preprocessing on upload keeps each final grading prompt small and avoids 32k context blowups.

- Added OCR/vision fallback for scanned PDFs and images during upload preprocessing.
  Why: when documents have little/no embedded text, the model now performs text extraction from rendered page images instead of failing upload.

- Updated the backend response handling to parse both JSON and SSE-style `data:` responses.
  Why: some OpenWebUI-compatible providers return event-stream formatted payloads even when the request is non-streaming. The previous code called `response.json()` directly and failed on responses that started with `data:`.

- Added `Accept: application/json, text/event-stream` on outbound backend requests.
  Why: this makes the backend tolerant of providers that choose either plain JSON or event-stream responses.

## Troubleshooting

- `http proxy error` with `ECONNREFUSED`
  The backend is not running on `localhost:4000`. Start the app with `npm run dev` and confirm the backend prints that it is listening on port `4000`.

- `OPENWEBUI_JWT_TOKEN is not configured on the backend`
  Add `OPENWEBUI_JWT_TOKEN` to `.env.local` and restart the backend.

- `OPENWEBUI_MODEL is not configured on the backend`
  Add `OPENWEBUI_MODEL` to `.env.local` and restart the backend.

- `Unexpected token 'd' ... "data: ... is not valid JSON"`
  This was caused by SSE-style provider responses. The backend now handles that format; restart the dev server so the updated parser is loaded.

- 404 or bad upstream path errors
  Check `OPENWEBUI_BASE_URL`. It should look like `https://your-host`, not `https://your-host/api`.
