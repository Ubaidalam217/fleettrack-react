# FleetTrack

Real-time fleet tracking platform built on React + Flespi IoT. Designed and developed by **Solves Inn** for client **Khalid (UAE)**.

## Features

- Live vehicle telemetry via Flespi IoT API (position, speed, ignition)
- Interactive Leaflet map with per-vehicle markers and status popups
- Smart notification engine: overspeed, high idle, GPS lost, off-hours, long stop
- Browser push notifications with double opt-in
- Dashboard with stat cards, health score, activity chart, trip analysis
- Notifications and Announcements pages with filter/search/pagination
- Light / Dark / System theme
- Responsive layout (mobile + desktop)

## Tech Stack

| Layer | Choice |
|---|---|
| UI Framework | React 19 + Vite 8 |
| Styling | Tailwind CSS v4 (CSS variables for theming) |
| Routing | React Router v7 |
| Charts | Recharts |
| Map | Leaflet + react-leaflet |
| IoT Data | Flespi REST API |
| Deployment | Netlify (with /flespi proxy) |

## Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and set your Flespi token

# 3. Start dev server
npm run dev
# App runs at http://localhost:5173

# 4. Production build
npm run build
npm run preview
```

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_FLESPI_TOKEN` | Flespi API token (must start with `VITE_` to be exposed to the client) |

## Demo Credentials

```
Email:    admin@fleettrack.com
Password: admin123
```

## Deployment

The project is configured for Netlify via `netlify.toml`. The `/flespi/*` proxy forwards requests to `https://flespi.io` so the Flespi API is accessible from the production domain without CORS issues.

To deploy:
1. Push to GitHub
2. Connect repo to Netlify (auto-detects build settings from `netlify.toml`)
3. Set `VITE_FLESPI_TOKEN` in Netlify site environment variables
4. Deploy

## Project Structure

```
src/
  components/          UI components (Header, Sidebar, charts, map)
  hooks/               Data hooks (useFlespiData, useNotificationEngine)
  pages/               Route-level pages (Dashboard, Tracking, Notifications...)
  services/            Pure logic (notificationEngine, notificationStore, pushNotifications)
```

---

Built by [Solves Inn](https://solvesinn.com)
