// Ported from indicators.py — pure-math technical indicators over plain arrays.

function ffill(values) {
  const out = [];
  let last = null;
  for (const v of values) {
    if (v === null || v === undefined) {
      out.push(last);
    } else {
      out.push(v);
      last = v;
    }
  }
  const firstValid = out.find((x) => x !== null && x !== undefined);
  return out.map((x) => (x === null || x === undefined ? (firstValid ?? null) : x));
}

function sma(values, window) {
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (i + 1 < window) continue;
    let sum = 0;
    for (let j = i + 1 - window; j <= i; j++) sum += values[j];
    out[i] = sum / window;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const alpha = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  seed /= period;
  out[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function rsiFromAvgs(avgGain, avgLoss) {
  if (avgLoss === 0) return 100.0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  const deltas = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1]);
  const gains = deltas.map((d) => Math.max(d, 0));
  const losses = deltas.map((d) => Math.max(-d, 0));

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const idx = period;
  out[idx] = rsiFromAvgs(avgGain, avgLoss);

  for (let i = period; i < deltas.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    out[i + 1] = rsiFromAvgs(avgGain, avgLoss);
  }
  return out;
}

function macdHistogram(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = emaFast.map((f, i) => (f !== null && emaSlow[i] !== null ? f - emaSlow[i] : null));
  const validStart = macdLine.findIndex((v) => v !== null);
  const out = new Array(closes.length).fill(null);
  if (validStart === -1) return out;
  const trimmed = macdLine.slice(validStart);
  const signalLine = ema(trimmed, signal);
  signalLine.forEach((sig, offset) => {
    if (sig === null) return;
    const i = validStart + offset;
    out[i] = macdLine[i] - sig;
  });
  return out;
}

function pctFromSma(closes, window) {
  const smaVals = sma(closes, window);
  return closes.map((c, i) => {
    const s = smaVals[i];
    if (s === null || s === 0) return null;
    return ((c - s) / s) * 100;
  });
}

function rateOfChange(closes, window) {
  const out = new Array(closes.length).fill(null);
  for (let i = window; i < closes.length; i++) {
    const prev = closes[i - window];
    if (prev === 0) continue;
    out[i] = ((closes[i] - prev) / prev) * 100;
  }
  return out;
}

function volumeRatio(volumes, window = 20) {
  const avg = sma(volumes, window);
  return volumes.map((v, i) => {
    const a = avg[i];
    if (a === null || a === 0) return null;
    return v / a;
  });
}

function bollingerPercentB(closes, window = 20, numStd = 2) {
  const out = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (i + 1 < window) continue;
    const windowVals = closes.slice(i + 1 - window, i + 1);
    const mean = windowVals.reduce((a, b) => a + b, 0) / window;
    const variance = windowVals.reduce((a, b) => a + (b - mean) ** 2, 0) / window;
    const std = Math.sqrt(variance);
    const upper = mean + numStd * std;
    const lower = mean - numStd * std;
    if (upper === lower) continue;
    out[i] = (closes[i] - lower) / (upper - lower);
  }
  return out;
}

function atrPercent(highs, lows, closes, period = 14) {
  const trueRanges = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    trueRanges.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }
  const atrVals = ema(trueRanges, period);
  return atrVals.map((atr, i) => {
    if (atr === null || closes[i] === 0) return null;
    return (atr / closes[i]) * 100;
  });
}

function pctOff52wHigh(closes, window = 252) {
  const out = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    const start = Math.max(0, i + 1 - window);
    const windowVals = closes.slice(start, i + 1);
    if (windowVals.length < Math.min(window, i + 1)) continue;
    const high = Math.max(...windowVals);
    if (high === 0) continue;
    out[i] = ((closes[i] - high) / high) * 100;
  }
  return out;
}

const FEATURE_NAMES = [
  "rsi14", "macd_hist", "pct_from_sma20", "pct_from_sma50", "pct_from_sma200",
  "roc20", "volume_ratio20", "bollinger_pct_b", "atr_pct", "pct_off_52w_high",
];

function computeAllFeatures(history) {
  const closes = ffill(history.adjclose || history.close);
  const highs = ffill(history.high);
  const lows = ffill(history.low);
  const volumes = ffill(history.volume);

  return {
    features: {
      rsi14: rsi(closes, 14),
      macd_hist: macdHistogram(closes),
      pct_from_sma20: pctFromSma(closes, 20),
      pct_from_sma50: pctFromSma(closes, 50),
      pct_from_sma200: pctFromSma(closes, 200),
      roc20: rateOfChange(closes, 20),
      volume_ratio20: volumeRatio(volumes, 20),
      bollinger_pct_b: bollingerPercentB(closes, 20),
      atr_pct: atrPercent(highs, lows, closes, 14),
      pct_off_52w_high: pctOff52wHigh(closes, 252),
    },
    closes,
  };
}

function featureVectorAt(featuresByName, index) {
  const vec = {};
  for (const name of FEATURE_NAMES) {
    const val = featuresByName[name][index];
    if (val === null || val === undefined || Number.isNaN(val)) return null;
    vec[name] = val;
  }
  return vec;
}
