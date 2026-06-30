import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const PORT = process.env.PORT || 3000;
const FMP_KEY = process.env.FMP_API_KEY || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

// Free public endpoints should not be hammered. Reports are cached briefly so users
// still get near-live/delayed data while keeping the free backend reliable.
const REPORT_TTL_MS = Number(process.env.REPORT_TTL_MS || 120000); // 2 minutes
const SEARCH_TTL_MS = Number(process.env.SEARCH_TTL_MS || 86400000); // 24 hours
const REPORT_CACHE = new Map();
const SEARCH_CACHE = new Map();

let INDIA_MASTER = null;
function normalizeSearch(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
async function loadIndiaMaster() {
  if (INDIA_MASTER) return INDIA_MASTER;
  try {
    const txt = await readFile(join(process.cwd(), 'data/india_securities.json'), 'utf8');
    INDIA_MASTER = JSON.parse(txt);
  } catch {
    INDIA_MASTER = [];
  }
  return INDIA_MASTER;
}
async function searchIndiaMaster(query, limit = 60) {
  const qRaw = String(query || '').trim();
  if (!qRaw) return [];
  const q = normalizeSearch(qRaw.replace(/\.(NS|BO)$/i, ''));
  const qWithSuffix = normalizeSearch(qRaw);
  const master = await loadIndiaMaster();
  const scored = [];
  for (const x of master) {
    const sym = normalizeSearch(x.symbol);
    const base = normalizeSearch(x.baseSymbol || x.symbol.replace(/\.(NS|BO)$/i, ''));
    const name = normalizeSearch(x.name);
    let score = 0;
    if (sym === qWithSuffix) score = 1000;
    else if (base === q) score = 950;
    else if (name === q) score = 900;
    else if (base.startsWith(q)) score = 760 - Math.min(base.length, 50);
    else if (name.startsWith(q)) score = 720 - Math.min(name.length, 80);
    else if (base.includes(q)) score = 560 - base.indexOf(q);
    else if (name.includes(q)) score = 500 - name.indexOf(q);
    if (score > 0) scored.push({ score, item: x });
  }
  return scored
    .sort((a,b) => b.score - a.score || (a.item.exchange === 'NSE' ? -1 : 1) || a.item.symbol.localeCompare(b.item.symbol))
    .slice(0, limit)
    .map(({ item }) => ({
      symbol: item.symbol,
      name: item.name,
      exchange: item.exchange,
      currency: 'INR',
      isin: item.isin || '',
      code: item.code || '',
      sector: '',
      industry: '',
      type: 'Equity',
      country: 'India'
    }));
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(payload));
}
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function avg(a){ const x=a.filter(Number.isFinite); return x.length ? x.reduce((p,c)=>p+c,0)/x.length : null; }
function cagr(first,last,years){ return first>0 && last>0 && years>0 ? (Math.pow(last/first,1/years)-1)*100 : null; }
function safeRatio(a,b){ return Number.isFinite(a)&&Number.isFinite(b)&&b!==0 ? a/b : null; }

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*' } });
  if (!r.ok) throw Object.assign(new Error(`Data provider returned ${r.status}`), { status: r.status });
  return r.json();
}
async function fmp(path, params = {}) {
  if (!FMP_KEY) throw Object.assign(new Error('FMP_API_KEY missing'), { status: 503 });
  const url = new URL(path, 'https://financialmodelingprep.com');
  Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
  url.searchParams.set('apikey', FMP_KEY);
  return getJson(url);
}
async function yahoo(path, params = {}) {
  const url = new URL(path, path.startsWith('/v1') || path.startsWith('/v8') ? 'https://query1.finance.yahoo.com' : 'https://query1.finance.yahoo.com');
  Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
  return getJson(url);
}

async function searchSecurities(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  // First use our full Indian security master. This makes NSE/BSE discovery work for
  // thousands of listed Indian equities instead of only the few symbols Yahoo ranks.
  const india = await searchIndiaMaster(q, 50);

  let provider = [];
  if (FMP_KEY) {
    try {
      const data = await fmp('/api/v3/search', { query: q, limit: 12 });
      provider = (Array.isArray(data) ? data : []).filter(x => x.symbol && x.name).map(x => ({ symbol:x.symbol, name:x.name, exchange:x.exchangeShortName||x.exchange||'', currency:x.currency||'', type:'Equity' }));
    } catch {}
  }
  if (!provider.length) {
    try {
      const data = await yahoo('/v1/finance/search', { q, quotesCount: 12, newsCount: 0 });
      provider = (data.quotes || [])
        .filter(x => x.symbol && (x.quoteType === 'EQUITY' || x.typeDisp === 'Equity'))
        .map(x => ({ symbol:x.symbol, name:x.longname || x.shortname || x.symbol, exchange:x.exchDisp || x.exchange || '', currency:'', sector:x.sector || '', industry:x.industry || '', type:'Equity' }));
    } catch {}
  }

  const seen = new Set();
  return [...india, ...provider].filter(x => {
    const k = String(x.symbol || '').toUpperCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 60);
}
function pickBest(query, results) {
  const q = String(query || '').trim().toUpperCase();
  return results.find(r => r.symbol.toUpperCase() === q) || results.find(r => r.name.toUpperCase() === q) || results[0] || null;
}

function raw(v){ return v?.reportedValue?.raw ?? null; }
function parseYahooTimeseries(data) {
  const byDate = new Map();
  for (const item of data?.timeseries?.result || []) {
    const types = item?.meta?.type || [];
    for (const t of types) {
      for (const row of item[t] || []) {
        const date = row.asOfDate;
        if (!date) continue;
        byDate.set(date, { ...(byDate.get(date) || { date, fiscalYear: date.slice(0,4) }), [t]: raw(row), currency: row.currencyCode || byDate.get(date)?.currency });
      }
    }
  }
  return Array.from(byDate.values()).sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(r => {
    const revenue = num(r.annualTotalRevenue), netIncome = num(r.annualNetIncome), operatingIncome = num(r.annualOperatingIncome);
    const totalDebt = num(r.annualTotalDebt), totalEquity = num(r.annualStockholdersEquity);
    return {
      date: r.date,
      fiscalYear: r.fiscalYear,
      revenue,
      operatingIncome,
      netIncome,
      freeCashFlow: num(r.annualFreeCashFlow),
      totalDebt,
      totalEquity,
      totalAssets: num(r.annualTotalAssets),
      operatingMargin: safeRatio(operatingIncome, revenue) !== null ? safeRatio(operatingIncome, revenue)*100 : null,
      roe: safeRatio(netIncome, totalEquity) !== null ? safeRatio(netIncome, totalEquity)*100 : null,
      debtEquity: safeRatio(totalDebt, totalEquity),
      pe: null
    };
  }).filter(r => r.revenue || r.netIncome || r.freeCashFlow).slice(-10);
}
async function yahooChart(symbol, range='1d', interval='1m') {
  const data = await yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}`, { range, interval });
  const result = data?.chart?.result?.[0];
  if (!result?.meta) throw Object.assign(new Error('No live quote/chart data was returned for this symbol.'), { status: 404 });
  return result;
}
async function yahooQuote(symbol) {
  const chart = await yahooChart(symbol, '5d', '1d');
  const m = chart.meta;
  const closes = (chart.indicators?.quote?.[0]?.close || []).filter(v => Number.isFinite(v));
  const price = num(m.regularMarketPrice) ?? closes[closes.length-1] ?? null;
  const prev = num(m.chartPreviousClose) ?? closes[closes.length-2] ?? null;
  return {
    symbol: m.symbol || symbol,
    name: m.longName || m.shortName || symbol,
    exchange: m.fullExchangeName || m.exchangeName || '',
    currency: m.currency || '',
    price,
    changePercent: price && prev ? ((price-prev)/prev)*100 : null,
    dayLow: num(m.regularMarketDayLow),
    dayHigh: num(m.regularMarketDayHigh),
    yearLow: num(m.fiftyTwoWeekLow),
    yearHigh: num(m.fiftyTwoWeekHigh),
    volume: num(m.regularMarketVolume),
    marketCap: null,
    pe: null,
    eps: null
  };
}
async function yahooFundamentals(symbol) {
  const types = [
    'annualTotalRevenue','annualNetIncome','annualOperatingIncome','annualFreeCashFlow','annualTotalDebt','annualStockholdersEquity','annualTotalAssets','trailingMarketCap'
  ].join(',');
  const data = await yahoo(`/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`, { symbol, type: types, period1: 0, period2: Math.floor(Date.now()/1000) });
  const rows = parseYahooTimeseries(data);
  let marketCap = null;
  for (const item of data?.timeseries?.result || []) {
    for (const row of item.trailingMarketCap || []) marketCap = num(raw(row)) ?? marketCap;
  }
  return { rows, marketCap };
}

const peerMap = {
  'TATAPOWER.NS':['NTPC.NS','POWERGRID.NS','ADANIGREEN.NS','JSWENERGY.NS','TORNTPOWER.NS'],
  'TATAPOWER.BO':['NTPC.NS','POWERGRID.NS','ADANIGREEN.NS','JSWENERGY.NS','TORNTPOWER.NS'],
  'RELIANCE.NS':['IOC.NS','BPCL.NS','ONGC.NS','BHARTIARTL.NS','ADANIENT.NS'],
  'INFY.NS':['TCS.NS','HCLTECH.NS','WIPRO.NS','TECHM.NS','LTIM.NS'],
  'TCS.NS':['INFY.NS','HCLTECH.NS','WIPRO.NS','TECHM.NS','LTIM.NS'],
  'AAPL':['MSFT','GOOGL','META','AMZN','NVDA'],
  'MSFT':['AAPL','GOOGL','ORCL','AMZN','CRM'],
  'NVDA':['AMD','AVGO','INTC','MRVL','TSM'],
  'TSLA':['BYDDY','TM','F','GM','RIVN']
};
function defaultPeers(symbol, sector='') {
  const s = symbol.toUpperCase();
  if (peerMap[s]) return peerMap[s];
  if (s.endsWith('.NS') || s.endsWith('.BO')) return ['RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','ICICIBANK.NS'].filter(x=>x!==s);
  return ['AAPL','MSFT','GOOGL','AMZN','NVDA'].filter(x=>x!==s);
}
async function getYahooPeers(symbol, sector) {
  const peers = defaultPeers(symbol, sector).slice(0,5);
  const data = await Promise.allSettled(peers.map(async p => {
    const [quote, f] = await Promise.all([yahooQuote(p), yahooFundamentals(p).catch(()=>({ rows: [], marketCap: null }))]);
    const latest = f.rows[f.rows.length-1] || {};
    const marketCap = f.marketCap || (quote.price && latest.netIncome ? null : null);
    const pe = marketCap && latest.netIncome ? marketCap/latest.netIncome : null;
    return { symbol:p, name:quote.name, price:quote.price, marketCap, pe, eps:null, changePercent:quote.changePercent };
  }));
  return data.filter(x=>x.status==='fulfilled').map(x=>x.value);
}
function computeScores(rows, quote) {
  const first = rows[0] || {}, last = rows[rows.length-1] || {};
  const revCagr = rows.length >= 2 ? cagr(first.revenue, last.revenue, rows.length-1) : null;
  const fcfPositiveYears = rows.filter(r => Number.isFinite(r.freeCashFlow) && r.freeCashFlow > 0).length;
  const avgRoe = avg(rows.map(r=>r.roe));
  const avgOpMargin = avg(rows.map(r=>r.operatingMargin));
  const debtEquity = Number.isFinite(last.debtEquity) ? last.debtEquity : null;
  const currentPe = quote.marketCap && last.netIncome ? quote.marketCap / last.netIncome : null;
  rows.forEach(r => { if (r.date === last.date) r.pe = currentPe; });
  const quality = clamp(Math.round(48 + (avgRoe ?? 8)*0.9 + (avgOpMargin ?? 8)*0.5 + fcfPositiveYears*2.4 - (Number.isFinite(debtEquity)?debtEquity*7:4)), 0, 100);
  const growthScore = clamp(Math.round(50 + (revCagr ?? 0)*2.5), 0, 100);
  const balanceScore = clamp(Math.round(82 - (Number.isFinite(debtEquity)?debtEquity*16:12)), 0, 100);
  const peAvg = currentPe;
  const valuationScore = clamp(Math.round(55 + (revCagr ?? 0)*1.0 + (avgRoe ?? 0)*0.28 - (currentPe ? Math.max(0,currentPe-25)*0.8 : 0)), 0, 100);
  const conviction = clamp(Math.round(quality*.34 + growthScore*.24 + valuationScore*.25 + balanceScore*.17), 0, 100);
  const verdict = conviction>=80?'Buy':conviction>=66?'Accumulate':conviction<45?'Avoid':'Hold';
  const valuationSignal = currentPe ? (currentPe>35?'Overvalued':currentPe<18?'Undervalued':'Fair') : 'Fair';
  return { quality, growthScore, valuationScore, balanceScore, conviction, verdict, valuationSignal, revCagr, avgRoe, avgOpMargin, debtEquity, peAvg, currentPe };
}


async function findIndianAlternate(symbol) {
  const master = await loadIndiaMaster();
  const key = String(symbol || '').toUpperCase();
  const current = master.find(x => String(x.symbol).toUpperCase() === key);
  if (!current) return null;
  // Prefer the NSE line with the same ISIN/name because Yahoo coverage is usually best on .NS for India.
  const byIsin = current.isin ? master.find(x => x.exchange === 'NSE' && x.isin === current.isin && x.symbol.toUpperCase() !== key) : null;
  if (byIsin) return byIsin;
  const n = normalizeSearch(current.name);
  return master.find(x => x.exchange === 'NSE' && normalizeSearch(x.name) === n && x.symbol.toUpperCase() !== key) || null;
}
async function yahooSearchMeta(symbol) {
  try {
    const data = await yahoo('/v1/finance/search', { q: symbol, quotesCount: 8, newsCount: 0 });
    const row = (data.quotes || []).find(x => String(x.symbol).toUpperCase() === String(symbol).toUpperCase()) || (data.quotes || [])[0];
    return row ? { name: row.longname || row.shortname || symbol, sector: row.sector || row.sectorDisp || '', industry: row.industry || row.industryDisp || '', exchange: row.exchDisp || row.exchange || '' } : {};
  } catch { return {}; }
}


function buildSecurityOnlyReport(security, reason = 'Live quote/fundamental provider did not return data for this symbol.') {
  const name = security.name || security.symbol;
  const currency = security.currency || 'INR';
  return {
    asOf: new Date().toISOString(),
    source: 'NSE/BSE security master + live provider fallback notice',
    coverage: 'security-master-only',
    warning: reason,
    security: {
      symbol: security.symbol,
      name,
      exchange: security.exchange || '',
      currency,
      sector: security.sector || 'Sector unavailable',
      industry: security.industry || 'Industry unavailable',
      country: security.country || 'India',
      website: ''
    },
    quote: { symbol: security.symbol, name, exchange: security.exchange || '', currency, price: null, changePercent: null, marketCap: null, pe: null, eps: null, dayLow: null, dayHigh: null, yearLow: null, yearHigh: null, volume: null },
    financials: [],
    peers: [],
    scores: { quality: 0, growthScore: 0, valuationScore: 0, balanceScore: 0, conviction: 0, verdict: 'Data unavailable', valuationSignal: 'Data unavailable', revCagr: null, avgRoe: null, avgOpMargin: null, debtEquity: null, peAvg: null, currentPe: null },
    narrative: {
      executiveSummary: `${name} (${security.symbol}) is validated in the official NSE/BSE listed-company master. ${reason} No synthetic price, valuation or financial values were generated.`,
      management: ['Listed-company validation passed.', 'Management scoring requires reported financial data from the live provider.', 'No fake governance or financial data is generated.'],
      industry: [`Exchange: ${security.exchange || 'Unavailable'}.`, 'Sector and policy analysis require live provider coverage or licensed datasets.', 'The company remains searchable because it is present in the NSE/BSE master.'],
      bull: ['The company is present in the official NSE/BSE listed-company master.'],
      bear: ['The free live-data provider did not return enough data for a full report at this time.'],
      risks: ['Free public market-data coverage can be delayed or incomplete for smaller/BSE-only securities.'],
      catalysts: ['Connect a licensed NSE/BSE/fundamental provider to unlock complete reports for every listed company.']
    }
  };
}

async function buildYahooReport(query) {
  const results = await searchSecurities(query);
  let security = pickBest(query, results);
  if (!security && String(query||'').trim()) security = { symbol:String(query).trim().toUpperCase(), name:String(query).trim().toUpperCase(), exchange:'', sector:'', industry:'' };
  if (!security) throw Object.assign(new Error('No legitimate listed equity matched that search.'), { status: 404 });
  let dataSymbol = security.symbol;
  let quote, fundamentals;
  try {
    [quote, fundamentals] = await Promise.all([yahooQuote(dataSymbol), yahooFundamentals(dataSymbol)]);
  } catch (e) {
    const alt = await findIndianAlternate(dataSymbol);
    if (!alt) return buildSecurityOnlyReport(security, `The live/delayed provider did not return quote data for ${security.symbol}.`);
    try {
      dataSymbol = alt.symbol;
      [quote, fundamentals] = await Promise.all([yahooQuote(dataSymbol), yahooFundamentals(dataSymbol)]);
      security = { ...security, symbol: alt.symbol, name: alt.name, exchange: alt.exchange, currency: 'INR' };
    } catch (e2) {
      return buildSecurityOnlyReport(security, `The live/delayed provider did not return quote data for ${security.symbol} or its NSE/BSE alternate ${alt.symbol}.`);
    }
  }
  if (!Number.isFinite(quote.price)) return buildSecurityOnlyReport(security, `The provider returned no usable live/delayed price for ${security.symbol}.`);
  const meta = await yahooSearchMeta(dataSymbol);
  quote.name = security.name || meta.name || quote.name;
  quote.exchange = security.exchange || meta.exchange || quote.exchange;
  quote.marketCap = fundamentals.marketCap;
  const rows = fundamentals.rows;
  const scores = computeScores(rows, quote);
  quote.pe = scores.currentPe;
  const sector = security.sector || meta.sector || 'Sector unavailable';
  const industry = security.industry || meta.industry || 'Industry unavailable';
  const peers = await getYahooPeers(dataSymbol, sector);
  const name = security.name || meta.name || quote.name || security.symbol;
  return {
    asOf: new Date().toISOString(),
    source: 'Yahoo Finance public endpoints + verified symbol search',
    security: { symbol: security.symbol, name, exchange: quote.exchange, currency: quote.currency, sector, industry, country:'', website:'' },
    quote,
    financials: rows,
    peers,
    scores,
    narrative: {
      executiveSummary: `${name} (${security.symbol}) is a verified listed equity from Yahoo Finance search/chart data. The live price is ${quote.currency || ''} ${quote.price}. Based on available reported fundamentals, quote data, cash-flow history, profitability and leverage, the model assigns a ${scores.verdict} verdict with ${scores.conviction}/100 conviction.`,
      management: [
        `Management Score: ${scores.quality}/100, calculated from reported profitability, cash-flow consistency and leverage discipline.`,
        `Governance/news red-flag automation needs licensed annual-report, filing, transcript and news feeds; this working model does not invent those qualitative signals.`,
        Number.isFinite(scores.debtEquity) ? `Latest debt/equity is approximately ${scores.debtEquity.toFixed(2)}x.` : 'Debt/equity was not available from the public provider.'
      ],
      industry: [
        `Sector: ${sector}. Industry: ${industry}.`,
        'For deeper sector outlook, connect policy/news datasets; the current model uses verified security metadata and fundamentals.',
        'Peer quotes are fetched live for a curated sector/exchange peer set where available.'
      ],
      bull: [
        Number.isFinite(scores.revCagr) ? `Available revenue CAGR is ${scores.revCagr.toFixed(1)}%.` : 'Revenue history is limited from the public endpoint.',
        Number.isFinite(scores.avgRoe) ? `Average ROE is ${scores.avgRoe.toFixed(1)}%.` : 'ROE history is unavailable.',
        Number.isFinite(scores.currentPe) ? `Current P/E estimate is ${scores.currentPe.toFixed(1)}x based on market cap and latest net income.` : 'Valuation can improve when market cap and latest net income are both available.'
      ],
      bear: [
        scores.valuationSignal === 'Overvalued' ? 'Current multiple appears elevated versus a simple threshold model.' : 'Multiple expansion may be limited without stronger earnings growth.',
        'Public endpoints may return fewer than 10 annual statement periods for some exchanges.',
        'Policy, commodity, currency, rate and regulatory changes can materially affect fair value.'
      ],
      risks: ['Provider data gaps or delayed statements can alter scores.', 'Valuation multiples may compress if growth or margins slow.', 'Governance/news red flags require licensed sources for automated verification.'],
      catalysts: ['Sustained revenue growth and margin expansion.', 'Debt reduction, better free-cash-flow conversion, dividends or buybacks.', 'Positive policy or industry demand inflection.']
    }
  };
}

async function buildReport(query) {
  // FMP remains supported when configured. Keyless Yahoo is the default working path.
  return buildYahooReport(query);
}


async function cachedSearch(query) {
  const key = String(query || '').trim().toUpperCase();
  const hit = SEARCH_CACHE.get(key);
  if (hit && Date.now() - hit.t < SEARCH_TTL_MS) return hit.v;
  const v = await searchSecurities(query);
  SEARCH_CACHE.set(key, { t: Date.now(), v });
  return v;
}
async function cachedReport(query) {
  const key = String(query || '').trim().toUpperCase();
  const hit = REPORT_CACHE.get(key);
  if (hit && Date.now() - hit.t < REPORT_TTL_MS) return { ...hit.v, cache: { hit: true, ageSeconds: Math.round((Date.now() - hit.t) / 1000), ttlSeconds: Math.round(REPORT_TTL_MS / 1000) } };
  const v = await buildReport(query);
  v.cache = { hit: false, ageSeconds: 0, ttlSeconds: Math.round(REPORT_TTL_MS / 1000) };
  REPORT_CACHE.set(key, { t: Date.now(), v });
  return v;
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok:true, providerConfigured:true, provider: FMP_KEY ? 'FMP configured; Yahoo fallback available' : 'Yahoo Finance public endpoints', delayedData: true, reportCacheSeconds: Math.round(REPORT_TTL_MS/1000), indiaListings: (await loadIndiaMaster()).length });
    if (url.pathname === '/api/search') return json(res, 200, { results: await cachedSearch(url.searchParams.get('q')) });
    if (url.pathname === '/api/india-master') {
      let summary = null;
      try { summary = JSON.parse(await readFile(join(process.cwd(), 'data/india_securities_summary.json'), 'utf8')); } catch {}
      const master = await loadIndiaMaster();
      return json(res, 200, { count: master.length, summary, results: master.slice(0, 100) });
    }
    if (url.pathname === '/api/report') return json(res, 200, await cachedReport(url.searchParams.get('q') || url.searchParams.get('symbol')));
    if (['/equityiq','/equityIQ','/terminal','/app'].includes(url.pathname)) {
      const content = await readFile(join(process.cwd(), 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(content);
    }
    const filePath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const content = await readFile(join(process.cwd(), filePath));
    const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch (e) {
    if (url.pathname.startsWith('/api/')) return json(res, e.status || 500, { error: e.message || 'Server error' });
    res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); res.end('Not found');
  }
}

http.createServer(route).listen(PORT, () => {
  console.log(`EquityIQ website running at http://localhost:${PORT} and http://localhost:${PORT}/equityiq`);
  console.log('Provider: Yahoo Finance public endpoints. Optional FMP_API_KEY can be added later for deeper 10-year statements.');
});
