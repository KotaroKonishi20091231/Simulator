// Ported from update.py — orchestrates fetch -> indicators -> train/predict -> rank,
// entirely on-device (no server). Tickers and results persist in localStorage.

const DEFAULT_MAX_PRICE = 1500;
const HOLDOUT_DAYS = 40;
const MIN_TRAINING_ROWS = 200;
const RECENT_CHART_POINTS = 90;
const HORIZON_TRADING_DAYS = 10;
const SURGE_THRESHOLD = 0.08;

const TICKERS_STORAGE_KEY = "surge_predictor_tickers";
const PREDICTIONS_STORAGE_KEY = "surge_predictor_predictions";
const HOLDINGS_STORAGE_KEY = "surge_predictor_holdings";
const MAX_PRICE_STORAGE_KEY = "surge_predictor_max_price";
const JP_TICKER_RE = /^[0-9A-Za-z]{3,5}\.T$/;

function loadMaxPrice() {
  try {
    const raw = localStorage.getItem(MAX_PRICE_STORAGE_KEY);
    const n = Number(raw);
    return raw !== null && Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_PRICE;
  } catch (e) {
    return DEFAULT_MAX_PRICE;
  }
}

function saveMaxPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return;
  try { localStorage.setItem(MAX_PRICE_STORAGE_KEY, String(n)); } catch (e) { /* ignore */ }
}

const SETTINGS_STORAGE_KEY = "surge_predictor_settings";
const DEFAULT_SETTINGS = {
  autoRefresh: true,
  sortOrder: "added", // "added" (newest find first) | "score" (highest score first)
  showReversalBadge: true,
  reversalMinDrawdownPct: 15,
  reversalMinRecoveryPct: 5,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(partial) {
  const merged = { ...loadSettings(), ...partial };
  try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged)); } catch (e) { /* ignore */ }
  return merged;
}

const DISCLAIMER = "本ツールは統計的・技術的分析に基づく実験的な予測であり、投資助言ではありません。" +
  "予測は外れる可能性があり、将来の成果を保証するものではありません。" +
  "実際の売買判断とその結果については、すべて利用者ご自身の責任で行ってください。";

const DEFAULT_TICKERS = [
  { ticker: "7203.T", name: "トヨタ自動車" }, { ticker: "6758.T", name: "ソニーグループ" },
  { ticker: "9984.T", name: "ソフトバンクグループ" }, { ticker: "6861.T", name: "キーエンス" },
  { ticker: "8306.T", name: "三菱UFJフィナンシャル・グループ" }, { ticker: "9432.T", name: "日本電信電話" },
  { ticker: "6098.T", name: "リクルートホールディングス" }, { ticker: "8035.T", name: "東京エレクトロン" },
  { ticker: "4063.T", name: "信越化学工業" }, { ticker: "6501.T", name: "日立製作所" },
  { ticker: "6367.T", name: "ダイキン工業" }, { ticker: "7267.T", name: "本田技研工業" },
  { ticker: "4519.T", name: "中外製薬" }, { ticker: "4568.T", name: "第一三共" },
  { ticker: "8058.T", name: "三菱商事" }, { ticker: "8001.T", name: "伊藤忠商事" },
  { ticker: "8031.T", name: "三井物産" }, { ticker: "9433.T", name: "KDDI" },
  { ticker: "9983.T", name: "ファーストリテイリング" }, { ticker: "6902.T", name: "デンソー" },
  { ticker: "7741.T", name: "HOYA" }, { ticker: "6981.T", name: "村田製作所" },
  { ticker: "4901.T", name: "富士フイルムホールディングス" }, { ticker: "6752.T", name: "パナソニックホールディングス" },
  { ticker: "7011.T", name: "三菱重工業" }, { ticker: "6503.T", name: "三菱電機" },
  { ticker: "8316.T", name: "三井住友フィナンシャルグループ" }, { ticker: "8411.T", name: "みずほフィナンシャルグループ" },
  { ticker: "4502.T", name: "武田薬品工業" }, { ticker: "4503.T", name: "アステラス製薬" },
  { ticker: "2802.T", name: "味の素" }, { ticker: "9022.T", name: "東海旅客鉄道" },
  { ticker: "9020.T", name: "東日本旅客鉄道" }, { ticker: "9021.T", name: "西日本旅客鉄道" },
  { ticker: "5108.T", name: "ブリヂストン" }, { ticker: "7269.T", name: "スズキ" },
  { ticker: "7201.T", name: "日産自動車" }, { ticker: "6273.T", name: "SMC" },
  { ticker: "6146.T", name: "ディスコ" }, { ticker: "8766.T", name: "東京海上ホールディングス" },
  { ticker: "8750.T", name: "第一生命ホールディングス" }, { ticker: "8725.T", name: "MS&ADインシュアランスグループ" },
  { ticker: "4661.T", name: "オリエンタルランド" }, { ticker: "3382.T", name: "セブン&アイ・ホールディングス" },
  { ticker: "9843.T", name: "ニトリホールディングス" }, { ticker: "2914.T", name: "日本たばこ産業" },
  { ticker: "5401.T", name: "日本製鉄" }, { ticker: "5713.T", name: "住友金属鉱山" },
  { ticker: "1925.T", name: "大和ハウス工業" }, { ticker: "1928.T", name: "積水ハウス" },
  { ticker: "6971.T", name: "京セラ" }, { ticker: "6178.T", name: "日本郵政" },
  { ticker: "7182.T", name: "ゆうちょ銀行" }, { ticker: "8802.T", name: "三菱地所" },
  { ticker: "8830.T", name: "住友不動産" }, { ticker: "4543.T", name: "テルモ" },
  { ticker: "6301.T", name: "コマツ" }, { ticker: "6702.T", name: "富士通" },
  { ticker: "9613.T", name: "NTTデータグループ" }, { ticker: "4689.T", name: "LINEヤフー" },
  { ticker: "9434.T", name: "SoftBank Corp." },
];

function loadTickers() {
  let list;
  try {
    const raw = localStorage.getItem(TICKERS_STORAGE_KEY);
    list = raw ? JSON.parse(raw) : null;
  } catch (e) {
    list = null;
  }
  if (!list) {
    saveTickers(DEFAULT_TICKERS);
    list = DEFAULT_TICKERS;
  }
  return list.map((entry) => ({ ...entry, market: "jp" }));
}

function saveTickers(list) {
  try { localStorage.setItem(TICKERS_STORAGE_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

function savePredictions(payload) {
  try { localStorage.setItem(PREDICTIONS_STORAGE_KEY, JSON.stringify(payload)); } catch (e) { /* ignore */ }
}

function loadPredictions() {
  try {
    const raw = localStorage.getItem(PREDICTIONS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function buildDataset(tickerEntries, histories) {
  const maxPrice = loadMaxPrice();
  const allLabeled = [];
  const liveCandidates = [];

  for (const entry of tickerEntries) {
    const history = histories[entry.ticker];
    if (!history) continue;
    let features, closes;
    try {
      const computed = computeAllFeatures(history);
      features = computed.features;
      closes = computed.closes;
    } catch (e) {
      continue;
    }

    const dates = history.dates;
    const n = closes.length;
    const lastIdx = n - 1;

    for (let i = 0; i < n - HORIZON_TRADING_DAYS; i++) {
      const vec = featureVectorAt(features, i);
      if (!vec) continue;
      const future = closes.slice(i + 1, i + 1 + HORIZON_TRADING_DAYS);
      const futureValid = future.filter((c) => c !== null && c !== undefined);
      if (futureValid.length < HORIZON_TRADING_DAYS || !closes[i]) continue;
      const forwardReturn = Math.max(...futureValid) / closes[i] - 1;
      const label = forwardReturn >= SURGE_THRESHOLD ? 1 : 0;
      allLabeled.push({ date: dates[i], row: buildFeatureRow(vec, entry.market), label });
    }

    const liveVec = featureVectorAt(features, lastIdx);
    if (liveVec && closes[lastIdx] && closes[lastIdx] <= maxPrice) {
      const recentStart = Math.max(0, lastIdx - RECENT_CHART_POINTS + 1);
      liveCandidates.push({
        ticker: entry.ticker,
        name: entry.name,
        market: entry.market,
        price: closes[lastIdx],
        vec: liveVec,
        heuristicScoreVal: heuristicScore(liveVec),
        recentDates: dates.slice(recentStart, lastIdx + 1),
        recentCloses: closes.slice(recentStart, lastIdx + 1),
      });
    }
  }

  allLabeled.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const uniqueDates = [...new Set(allLabeled.map((r) => r.date))].sort();
  const cutoff = uniqueDates.length > HOLDOUT_DAYS ? uniqueDates[uniqueDates.length - HOLDOUT_DAYS] : null;

  const trainRows = [], trainLabels = [], holdoutRows = [], holdoutLabels = [];
  for (const { date, row, label } of allLabeled) {
    if (cutoff !== null && date >= cutoff) {
      holdoutRows.push(row);
      holdoutLabels.push(label);
    } else {
      trainRows.push(row);
      trainLabels.push(label);
    }
  }

  return { trainRows, trainLabels, holdoutRows, holdoutLabels, liveCandidates };
}

function rankCandidates(liveCandidates, trainedModel) {
  const byMarket = { jp: [] };
  for (const cand of liveCandidates) {
    const row = buildFeatureRow(cand.vec, cand.market);
    const mlProbability = trainedModel ? predictProba(row, trainedModel) : null;
    byMarket[cand.market].push({ ...cand, mlProbability });
  }
  const allRanked = {};
  for (const [mkt, candidates] of Object.entries(byMarket)) {
    candidates.sort((a, b) => {
      const sa = trainedModel ? a.mlProbability : a.heuristicScoreVal;
      const sb = trainedModel ? b.mlProbability : b.heuristicScoreVal;
      return sb - sa;
    });
    candidates.forEach((c, i) => { c.rank = i + 1; });
    allRanked[mkt] = candidates;
  }
  return { allRanked };
}

function pickPayload(p) {
  return {
    ticker: p.ticker,
    name: p.name,
    rank: p.rank,
    ml_probability: p.mlProbability ?? null,
    heuristic_score: Math.round(p.heuristicScoreVal * 10) / 10,
    price: p.price,
    indicators: Object.fromEntries(Object.entries(p.vec).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
    recent_dates: p.recentDates,
    recent_closes: p.recentCloses.map((c) => (c === null || c === undefined ? null : Math.round(c * 1000) / 1000)),
  };
}

async function runUpdate(onProgress) {
  const t0 = Date.now();
  const tickerEntries = loadTickers();
  const { histories, failures } = await fetchAll(tickerEntries, "2y", "1d", onProgress);
  const t1 = Date.now();

  if (Object.keys(histories).length < 10) {
    throw new Error(`取得できた銘柄が少なすぎます(${Object.keys(histories).length}件)`);
  }

  const { trainRows, trainLabels, liveCandidates } = buildDataset(tickerEntries, histories);
  const t2 = Date.now();

  let trainedModel = null;
  if (trainRows.length >= MIN_TRAINING_ROWS) {
    try {
      const result = trainModel(trainRows, trainLabels);
      if (result.diverged) {
        trainedModel = loadModel();
      } else {
        trainedModel = result;
        saveModel(result);
      }
    } catch (e) {
      trainedModel = loadModel();
    }
  } else {
    trainedModel = loadModel();
  }
  const t3 = Date.now();

  console.log(`[timing] fetch=${t1 - t0}ms buildDataset=${t2 - t1}ms train=${t3 - t2}ms`);

  const { allRanked } = rankCandidates(liveCandidates, trainedModel);

  const universe = {};
  for (const mkt of Object.keys(allRanked)) universe[mkt] = allRanked[mkt].map(pickPayload);

  // Accumulating watchlist: once a ticker has appeared here it stays, even if a
  // later run no longer finds it among today's qualifying candidates (e.g. its
  // price moved above JP_MAX_PRICE) — it just keeps showing its last known data.
  // Only genuinely new tickers get inserted, and they go to the front.
  const previous = loadPredictions();
  const previousWatchlist = (previous && previous.markets && previous.markets.jp) || [];
  const trackedTickers = new Set(loadTickers().map((t) => t.ticker));

  const freshPicks = (universe.jp || []).filter((p) => trackedTickers.has(p.ticker));
  const freshByTicker = new Map(freshPicks.map((p) => [p.ticker, p]));

  const carriedOver = previousWatchlist
    .filter((p) => trackedTickers.has(p.ticker))
    .map((old) => freshByTicker.get(old.ticker) || old);
  const alreadyKnown = new Set(carriedOver.map((p) => p.ticker));
  const newlyDiscovered = freshPicks.filter((p) => !alreadyKnown.has(p.ticker));

  const watchlist = [...newlyDiscovered, ...carriedOver];
  watchlist.forEach((p, i) => { p.rank = i + 1; });

  const markets = { jp: watchlist };

  const payload = {
    generated_at: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    markets,
    universe,
    fetch_failures: failures,
    debug_timing_ms: { fetch: t1 - t0, buildDataset: t2 - t1, train: t3 - t2 },
  };
  savePredictions(payload);
  return payload;
}

function normalizeJpTicker(raw) {
  let t = raw.trim().toUpperCase();
  if (!t.endsWith(".T")) t += ".T";
  return t;
}

async function addTicker(rawInput) {
  const raw = (rawInput || "").trim();
  if (!raw) throw new Error("銘柄コードを入力してください");
  const ticker = normalizeJpTicker(raw);
  if (!JP_TICKER_RE.test(ticker)) throw new Error(`「${raw}」は銘柄コードとして認識できません`);

  const tickers = loadTickers();
  if (tickers.some((t) => t.ticker === ticker)) throw new Error(`${ticker} は既に追加済みです`);

  const name = (await fetchCompanyName(ticker)) || ticker;
  const cleaned = tickers.map(({ market, ...rest }) => rest);
  cleaned.push({ ticker, name });
  saveTickers(cleaned);
  return { ticker, name };
}

function removeTickerFromStorage(ticker) {
  const cleaned = loadTickers()
    .filter((t) => t.ticker !== ticker)
    .map(({ market, ...rest }) => rest);
  saveTickers(cleaned);
}

function loadHoldings() {
  try {
    const raw = localStorage.getItem(HOLDINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveHoldings(holdings) {
  try { localStorage.setItem(HOLDINGS_STORAGE_KEY, JSON.stringify(holdings)); } catch (e) { /* ignore */ }
}

function getHolding(ticker) {
  const raw = loadHoldings()[ticker];
  if (raw === undefined || raw === null) return { shares: 0, buyPrice: null };
  // Back-compat: earlier versions stored a plain share count with no buy price.
  if (typeof raw === "number") {
    return { shares: raw > 0 ? raw : 0, buyPrice: null };
  }
  const shares = Number(raw.shares);
  const buyPrice = Number(raw.buyPrice);
  return {
    shares: Number.isFinite(shares) && shares > 0 ? shares : 0,
    buyPrice: Number.isFinite(buyPrice) && buyPrice > 0 ? buyPrice : null,
  };
}

function setHolding(ticker, shares, buyPrice) {
  const holdings = loadHoldings();
  const sharesNum = Number(shares);
  const priceNum = Number(buyPrice);
  const hasShares = Number.isFinite(sharesNum) && sharesNum > 0;
  const hasPrice = Number.isFinite(priceNum) && priceNum > 0;
  if (hasShares) {
    holdings[ticker] = { shares: sharesNum, buyPrice: hasPrice ? priceNum : null };
  } else {
    delete holdings[ticker];
  }
  saveHoldings(holdings);
}
