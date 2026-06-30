# EquityIQ Working Model — Full NSE/BSE Security Master

This build now contains a refreshed official Indian security master fetched from public NSE and BSE sources.

## Current Indian coverage

Generated on: `2026-06-30T12:14:24.929Z`

- **Total Indian equity listings:** 7,272
- **NSE listings:** 2,374
- **BSE listings:** 4,898
- **Common ISINs across NSE/BSE:** 2,244

Sources used:

- NSE equity list: `https://archives.nseindia.com/content/equities/EQUITY_L.csv`
- BSE active equity list API: `https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active`

## Files

- `data/india_securities.json` — full detailed NSE/BSE master
- `data/india_securities.min.json` — compact embedded search master
- `data/india_isin_map.json` — ISIN cross-map between NSE and BSE where available
- `data/india_securities_summary.json` — count/source metadata
- `scripts/update-india-master.js` — refresh script that fetches the latest NSE/BSE master files

## Refresh listed companies from NSE/BSE

Run:

```bash
npm run refresh:india
```

This downloads the latest available NSE and BSE listed-company master data and rewrites the data files.

## Run the app

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## API endpoints

```text
/api/health
/api/search?q=tata power
/api/report?q=TATAPOWER.NS
/api/india-master
```

## Search examples

```text
Tata Power
Suzlon
Waaree
HDFC Bank
Reliance
20 Microns
WAAREEENER.NS
TATAPOWER.BO
```

## Important note

The NSE/BSE master ensures the app can discover Indian listed companies. Live/delayed quote and available financial data are fetched from free public market-data endpoints. Some symbols may have delayed quotes, limited financial history, or weak provider coverage. Official guaranteed real-time data and full 10-year fundamentals for every stock require licensed data providers.
