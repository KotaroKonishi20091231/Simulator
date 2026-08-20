// Ported from heuristic.py — deterministic rule-based 0-100 technical score.

function heuristicScore(vec) {
  let score = 50.0;

  const rsi = vec.rsi14;
  if (rsi >= 50 && rsi <= 70) score += 10;
  else if (rsi > 80) score -= 5;
  else if (rsi < 30) score -= 10;

  if (vec.macd_hist > 0) score += 8;
  else score -= 4;

  if (vec.pct_from_sma20 > 0) score += 5;
  if (vec.pct_from_sma50 > 0) score += 5;
  if (vec.pct_from_sma200 > 0) score += 5;

  const roc = vec.roc20;
  if (roc > 5) score += 10;
  else if (roc > 0) score += 5;
  else if (roc < -5) score -= 10;

  const volRatio = vec.volume_ratio20;
  if (volRatio > 1.5) score += 8;
  else if (volRatio > 1.0) score += 3;

  const bb = vec.bollinger_pct_b;
  if (bb >= 0.5 && bb <= 1.0) score += 7;
  else if (bb > 1.0) score += 2;
  else if (bb < 0) score -= 5;

  const offHigh = vec.pct_off_52w_high;
  if (offHigh > -5) score += 10;
  else if (offHigh > -15) score += 4;

  if (vec.atr_pct > 6) score -= 5;

  return Math.max(0, Math.min(100, score));
}
