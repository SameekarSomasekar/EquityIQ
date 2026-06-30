# Build the delayed-live EquityIQ app

The app is now ready to run as a live/delayed web app using free hosting.

## What the backend does

- Serves the frontend from the same Node app.
- Searches a local NSE/BSE security master with **6,980 Indian listed equities**.
- Fetches quote/chart/fundamental data from Yahoo Finance public endpoints.
- Uses a **2-minute report cache** by default so free endpoints are not overloaded.
- Returns data that may be delayed by the free data provider, which is acceptable for a retail research app prototype.

## 1. Run locally

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Test:

```text
http://localhost:3000/api/health
http://localhost:3000/api/search?q=tata%20power
http://localhost:3000/api/report?q=TATAPOWER.NS
```

## 2. Deploy free on Render

1. Create a GitHub repository.
2. Upload/push all project files, including:
   - `index.html`
   - `server.js`
   - `package.json`
   - `render.yaml`
   - `data/india_securities.json`
3. Go to https://render.com
4. Create a free account.
5. Click **New +** → **Blueprint**.
6. Select your GitHub repository.
7. Render reads `render.yaml` automatically.
8. Click **Apply / Deploy**.

Your app will be live at a URL like:

```text
https://equityiq-live-india.onrender.com
```

Use that URL directly. The frontend and backend are on the same domain, so the app is already linked.

## 3. Render free-tier note

Free Render services sleep when inactive. The first request after inactivity can take 30–60 seconds. After waking, searches and reports work normally.

## 4. Optional environment variables

You do not need an API key for the current working model.

Optional settings:

```text
PORT=3000
REPORT_TTL_MS=120000
SEARCH_TTL_MS=86400000
```

- `REPORT_TTL_MS=120000` means reports refresh every 2 minutes.
- You can set `REPORT_TTL_MS=600000` for 10-minute caching.

## 5. Test Indian stocks

Try:

```text
Tata Power
TATAPOWER.NS
Suzlon
SUZLON.NS
HDFC Bank
HDFCBANK.NS
Reliance
RELIANCE.NS
20 Microns
20MICRONS.NS
```

## 6. Production limitations

This is a working free/delayed data prototype. For guaranteed official exchange real-time data, full 10-year financials for every company, annual report parsing, earnings-call transcripts, governance alerts, and news, you need licensed providers.
