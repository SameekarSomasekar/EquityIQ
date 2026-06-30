# Backend unavailable troubleshooting

If the app says `backend is unavailable`, it usually means you opened the static `index.html` preview instead of the Node app URL.

## Correct way locally

Start the backend:

```bash
npm start
```

Open this URL in your browser:

```text
http://localhost:3000
```

Do **not** open the raw `index.html` file if you want live/delayed data.

## Check backend status

```text
http://localhost:3000/api/health
```

Expected response includes:

```json
{
  "ok": true,
  "provider": "Yahoo Finance public endpoints",
  "delayedData": true,
  "indiaListings": 7272
}
```

## If frontend and backend are on different domains

The app now supports an API URL parameter:

```text
index.html?api=https://your-backend.onrender.com
```

Example:

```text
https://your-static-site.com/index.html?api=https://equityiq-live-india.onrender.com
```

The API URL is saved in browser localStorage as `EQUITYIQ_API_BASE`.

## Static preview mode

The static preview now includes the full NSE/BSE security master, so searching any Indian listed company will show a validated security-master-only report instead of throwing an error.

Live price, financials, valuation and scores still require the backend.
