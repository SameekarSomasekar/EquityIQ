import { writeFile, mkdir } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

function clean(v) {
  return String(v ?? '').trim();
}

function csvParse(text) {
  const rows = [];
  let row = [], cell = '', quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (quote) {
      if (c === '"' && n === '"') { cell += '"'; i++; }
      else if (c === '"') quote = false;
      else cell += c;
    } else {
      if (c === '"') quote = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift()?.map(h => clean(h)) || [];
  return rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(header.map((h, i) => [h, clean(r[i])])))
}

async function fetchText(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.text();
}

async function fetchJson(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*', ...headers } });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.json();
}

async function loadNse() {
  const url = 'https://archives.nseindia.com/content/equities/EQUITY_L.csv';
  const text = await fetchText(url, { 'Referer': 'https://www.nseindia.com/' });
  return csvParse(text)
    .filter(r => clean(r.SYMBOL) && clean(r['NAME OF COMPANY']))
    .map(r => ({
      symbol: `${clean(r.SYMBOL).toUpperCase()}.NS`,
      baseSymbol: clean(r.SYMBOL).toUpperCase(),
      name: clean(r['NAME OF COMPANY']),
      exchange: 'NSE',
      currency: 'INR',
      country: 'India',
      type: 'Equity',
      series: clean(r.SERIES),
      dateOfListing: clean(r['DATE OF LISTING']),
      paidUpValue: clean(r['PAID UP VALUE']),
      marketLot: clean(r['MARKET LOT']),
      isin: clean(r['ISIN NUMBER']),
      faceValue: clean(r['FACE VALUE']),
      source: url
    }));
}

async function loadBse() {
  const url = 'https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active';
  const data = await fetchJson(url, {
    'Referer': 'https://www.bseindia.com/corporates/List_Scrips.html',
    'Origin': 'https://www.bseindia.com'
  });
  return data
    .filter(r => clean(r.scrip_id) && (clean(r.Issuer_Name) || clean(r.Scrip_Name)))
    .map(r => ({
      symbol: `${clean(r.scrip_id).toUpperCase()}.BO`,
      baseSymbol: clean(r.scrip_id).toUpperCase(),
      code: clean(r.SCRIP_CD),
      name: clean(r.Issuer_Name) || clean(r.Scrip_Name),
      displayName: clean(r.Scrip_Name),
      exchange: 'BSE',
      currency: 'INR',
      country: 'India',
      type: 'Equity',
      status: clean(r.Status),
      group: clean(r.GROUP),
      faceValue: clean(r.FACE_VALUE),
      isin: clean(r.ISIN_NUMBER),
      industry: clean(r.INDUSTRY),
      segment: clean(r.Segment),
      marketCap: clean(r.Mktcap),
      websiteUrl: clean(r.NSURL),
      source: url
    }));
}

async function main() {
  await mkdir('data', { recursive: true });
  const [nse, bse] = await Promise.all([loadNse(), loadBse()]);
  const seen = new Set();
  const combined = [...nse, ...bse]
    .filter(x => {
      if (seen.has(x.symbol)) return false;
      seen.add(x.symbol);
      return true;
    })
    .sort((a, b) => a.exchange.localeCompare(b.exchange) || a.symbol.localeCompare(b.symbol));

  const byIsin = {};
  for (const x of combined) {
    if (!x.isin) continue;
    byIsin[x.isin] ||= { isin: x.isin, nse: null, bse: null, name: x.name };
    byIsin[x.isin][x.exchange.toLowerCase()] = x.symbol;
  }

  const summary = {
    lastUpdated: new Date().toISOString(),
    sources: {
      nse: 'https://archives.nseindia.com/content/equities/EQUITY_L.csv',
      bse: 'https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active'
    },
    total: combined.length,
    nse: nse.length,
    bse: bse.length,
    commonIsinCount: Object.values(byIsin).filter(x => x.nse && x.bse).length
  };

  await writeFile('data/india_securities.json', JSON.stringify(combined));
  await writeFile('data/india_securities.min.json', JSON.stringify(combined.map(x => [x.symbol, x.name, x.exchange, x.isin || '', x.code || ''])));
  await writeFile('data/india_isin_map.json', JSON.stringify(byIsin));
  await writeFile('data/india_securities_summary.json', JSON.stringify(summary, null, 2));

  console.log(summary);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
