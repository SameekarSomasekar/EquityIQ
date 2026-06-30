# EquityIQ Website

EquityIQ is now configured as a proper website served by the Node backend.

## Website URLs

Local website:

```text
http://localhost:3000
```

Named website route:

```text
http://localhost:3000/equityiq
```

API health:

```text
http://localhost:3000/api/health
```

## What works

- NSE/BSE search suggestions from a 7,272-company Indian security master.
- Delayed/live quote and available fundamentals through free public provider endpoints.
- Full research dashboard for supported symbols.
- Graceful security-master-only report if the free provider does not return quote/fundamental data for a smaller symbol.
- No fake price, valuation, or financial values.

## Run

```bash
npm start
```

Then open:

```text
http://localhost:3000/equityiq
```

## Deploy

The Render config uses the website name:

```text
equityiq
```

After deployment, your website URL will look like:

```text
https://equityiq.onrender.com
```

If that name is already taken, Render will assign a similar available URL.
