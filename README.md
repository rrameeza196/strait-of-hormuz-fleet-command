[![Review Assignment Due Date](https://classroom.github.com/assets/deadline-readme-button-22041afd0340ce965d47ae6ef1cefeee28c7c493a6346c4f15d667ab976d596c.svg)](https://classroom.github.com/a/ncRwI7td)

## Code Rush — Strait of Hormuz fleet command (MERN)

Real-time maritime simulation backend (Express + MongoDB + Socket.io) with a Vite React client.

### Prerequisites

- **Node.js** 20+
- **MongoDB** (local, Atlas, or the one supplied by Docker Compose below)

---

### Quick start (local dev)

From the repo root:

```bash
npm run install:all
```

Configure the server:

- Copy `server/.env.example` → `server/.env`
- Set **`MONGO_URI`** (e.g. `mongodb://127.0.0.1:27017/coderush_fleet` or your Atlas URI with the database name in the path, e.g. `...mongodb.net/coderush_fleet?retryWrites=true&w=majority`)
- Optionally set **`CORS_ORIGINS`** (comma-separated) and **`VERCEL_ORIGIN`** / **`VERCEL_URL`** so production and local Vite origins are allowed
- Optionally tune **`FUEL_BURN_TONS_PER_KNOT_HOUR`** (default `2.5`)

Seed the database (writes **15 ships**, **ports**, **navigable water**, **FleetConfig** from `server/data/fleet.json`):

```bash
npm run seed
```

Run API + simulator (Socket.io on the same HTTP server):

```bash
npm run server
```

Run the UI (default [http://localhost:5173](http://localhost:5173)):

```bash
npm run client
```

The client listens for **`fleet-update`** over Socket.io (WebSocket transport only in dev) and shows live ship payloads. **`GET http://localhost:5050/api/ships`** returns the same in-memory snapshot.

REST additions:

- **`GET /api/history`** — rolling snapshots (~30 s cadence, ~1 h retained) for playback UI.
- **`DELETE /api/zones/:id`** — remove a restricted zone (Command workflow).
- **`POST /api/ships/:shipId/accept-course`** — captain accepts assigned destination heading.

Env reference: see **`server/.env.example`**.

---

### Docker Compose (whole stack)

The assignment brief sometimes references **Next.js** and **FastAPI**; this repository ships **Vite + React** for the SPA and **Express + Socket.io** for the API/simulator. Dockerfiles match that stack (`client/Dockerfile`, `server/Dockerfile`).

From the repo root:

```bash
docker compose up --build
```

Services:

| Service | Port | Notes |
|---------|------|--------|
| **MongoDB** | `27017` | Persisted volume `mongodb_data` |
| **server** | `5050` | `MONGO_URI` points at the `mongodb` service |
| **client** | `5173` | Static build (Nginx); WebSocket/API URL defaulted to `http://localhost:5050` |

On **`docker compose up`**, a one-shot **`seed`** service runs before **`server`**. If the database is empty it loads ships, ports, and navigable water from `server/data/fleet.json`; if already seeded, it exits immediately so existing data is kept.

To **reset the database** and seed again from scratch, remove the Mongo volume and bring the stack back up:

```bash
docker compose down -v
docker compose up --build
```

Rebuild the SPA with a different API/socket origin (URL must work **in the user’s browser**):

```bash
set VITE_SOCKET_URL=https://your-api.example.com
docker compose build --no-cache client
docker compose up -d
```

Optional: **`CORS_ORIGINS`** when invoking Compose controls which browser origins Express/Socket.io accept (defaults include `http://localhost:5173`).

---

### Project layout

```
server/           Express + Mongoose + Socket.io, Simulator (1 Hz, in-memory fleet)
client/           Vite + React + socket.io-client
docker-compose.yml
```

Important files: `server/index.js`, `server/services/Simulator.js`, `server/data/fleet.json`, `server/seed.js`.

---

### API keys and optional integrations

| Variable | Required | Purpose |
|----------|----------|---------|
| **`MONGO_URI`** | Yes | Database connection string |
| **`GEMINI_API_KEY`** | No | Distress + threat NLP when `LLM_PROVIDER` is `gemini` (default) |
| **`XAI_API_KEY`** | No | Distress + threat NLP when `LLM_PROVIDER=xai` |
| Open-Meteo | No | Simulator fetches weather from **Open-Meteo** public API (no key); tune coords via `WEATHER_LATITUDE` / `WEATHER_LONGITUDE` |

See **`server/.env.example`** for full list including `CORS_ORIGINS`, weather parameter overrides, and model names.
