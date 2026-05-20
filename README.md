# LinkedIn Analytics Dashboard MVP

This project is a local app that mimics the core Shield-style workflow:

1. Capture LinkedIn posts using a Chrome extension.
2. Send those posts to a local API.
3. Analyze them in a dashboard with charts, filters, and a clickable posts table.

## What is included

- `server.mjs`
  - Serves the frontend.
  - Stores post data in `data/posts.json`.
  - Exposes API routes:
    - `GET /api/posts`
    - `POST /api/posts/ingest`
    - `POST /api/posts/demo`
    - `DELETE /api/posts`

- Dashboard UI (`index.html`, `styles.css`, `src/app.mjs`)
  - KPI cards for total posts, impressions, engagement, avg engagement rate.
  - Trend chart (impressions vs engagement over time).
  - Top posts chart.
  - Content type mix panel.
  - Filterable post table with detail panel.

- Chrome extension (`chrome-extension/`)
  - Captures posts from the active LinkedIn tab.
  - Stores captured posts locally in extension storage.
  - Syncs stored posts to `http://localhost:5173/api/posts/ingest`.
  - Exports captured posts as JSON.

## Run the app

```bash
node server.mjs
```

Then open:

- `http://localhost:5173`

## Load demo data quickly

Use the **Load Demo Data** button in the app UI to seed realistic sample posts.

## Install the Chrome extension (dev mode)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:
   - `chrome-extension`

## Capture + sync flow

1. Open LinkedIn and navigate to your posts/activity feed.
2. Open the extension popup.
3. Click **Capture Current Tab**.
4. Click **Send to Dashboard**.
5. Open or refresh `http://localhost:5173`.

## Notes

- LinkedIn DOM changes over time, so selectors in the extension may need occasional tuning.
- This MVP stores data locally in JSON, not in a remote database.
- If LinkedIn does not expose some metrics in the visible page, those values may be zero until enriched.
