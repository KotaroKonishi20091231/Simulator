// Ported from fetch_data.py — Yahoo Finance chart data fetcher.
// Relies on Capacitor's native HTTP bridge (CapacitorHttp, enabled in
// capacitor.config.json) to bypass the browser's CORS restriction on
// query1.finance.yahoo.com; a plain browser fetch() would be blocked there.

const CHART_URL = (symbol) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
const RETRY_DELAYS = [0, 2000, 4000, 8000];
const REQUEST_PAUSE_MIN = 300;
const REQUEST_PAUSE_MAX = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function cacheKey(ticker, range_, interval) {
  return `surge_predictor_cache_${ticker}__${range_}_${interval}`;
}

function readCache(ticker, range_, interval) {
  try {
    const raw = localStorage.getItem(cacheKey(ticker, range_, interval));
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (payload.cachedDate !== todayIso()) return null;
    return payload.history;
  } catch (e) {
    return null;
  }
}

function writeCache(ticker, range_, interval, history) {
  try {
    localStorage.setItem(cacheKey(ticker, range_, interval), JSON.stringify({ cachedDate: todayIso(), history }));
  } catch (e) { /* storage full — just skip caching this one */ }
}

async function requestChart(symbol, range_ = "2y", interval = "1d") {
  const url = `${CHART_URL(symbol)}?range=${range_}&interval=${interval}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function parseChartPayload(payload) {
  const resultList = payload?.chart?.result;
  if (!resultList || !resultList.length) {
    throw new Error(`no result in chart payload (error=${JSON.stringify(payload?.chart?.error)})`);
  }
  const result = resultList[0];
  const timestamps = result.timestamp;
  if (!timestamps) throw new Error("no timestamps in chart result");
  const quote = result.indicators.quote[0];
  const adjcloseBlock = result.indicators.adjclose;
  const adjclose = adjcloseBlock ? adjcloseBlock[0].adjclose : quote.close;

  const dates = timestamps.map((ts) => new Date(ts * 1000).toISOString().slice(0, 10));
  return {
    dates,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    close: quote.close,
    adjclose,
    volume: quote.volume,
    meta: result.meta,
  };
}

async function fetchTickerHistory(ticker, range_ = "2y", interval = "1d", useCache = true) {
  if (useCache) {
    const cached = readCache(ticker, range_, interval);
    if (cached) return cached;
  }

  let lastError = null;
  for (const delay of RETRY_DELAYS) {
    if (delay) await sleep(delay);
    try {
      const payload = await requestChart(ticker, range_, interval);
      const history = parseChartPayload(payload);
      writeCache(ticker, range_, interval, history);
      return history;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`failed to fetch ${ticker} after retries: ${lastError}`);
}

async function fetchCompanyName(ticker) {
  try {
    const payload = await requestChart(ticker, "5d", "1d");
    const meta = payload.chart.result[0].meta;
    return meta.longName || meta.shortName || null;
  } catch (e) {
    return null;
  }
}

async function fetchAll(tickerEntries, range_ = "2y", interval = "1d", onProgress = null) {
  const histories = {};
  const failures = [];
  const total = tickerEntries.length;
  for (let i = 0; i < total; i++) {
    const { ticker } = tickerEntries[i];
    try {
      histories[ticker] = await fetchTickerHistory(ticker, range_, interval);
    } catch (e) {
      failures.push({ ticker, error: String(e) });
    }
    if (onProgress) onProgress(ticker, ticker in histories, i + 1, total);
    await sleep(REQUEST_PAUSE_MIN + Math.random() * (REQUEST_PAUSE_MAX - REQUEST_PAUSE_MIN));
  }
  return { histories, failures };
}
