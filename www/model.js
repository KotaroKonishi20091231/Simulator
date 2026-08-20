// Ported from model.py — hand-rolled logistic regression (no external ML libs).

const MODEL_FEATURE_NAMES = [...FEATURE_NAMES, "is_jp"];

const LEARNING_RATE = 0.1;
const EPOCHS = 250;
const L2_LAMBDA = 0.005;
const Z_CLAMP = 35.0;
const PROB_EPS = 1e-12;

const WEIGHTS_STORAGE_KEY = "surge_predictor_model_weights";

function buildFeatureRow(vec, market) {
  return { ...vec, is_jp: market === "jp" ? 1.0 : 0.0 };
}

function standardizeFit(rows, featureNames) {
  const means = {};
  const stdevs = {};
  for (const name of featureNames) {
    const vals = rows.map((r) => r[name]);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length;
    let s = Math.sqrt(variance);
    if (s < 1e-9) s = 1.0;
    means[name] = m;
    stdevs[name] = s;
  }
  return { means, stdevs };
}

function standardizeRow(row, featureNames, means, stdevs) {
  return featureNames.map((name) => (row[name] - means[name]) / stdevs[name]);
}

function sigmoid(z) {
  z = Math.max(-Z_CLAMP, Math.min(Z_CLAMP, z));
  return 1 / (1 + Math.exp(-z));
}

function trainModel(rows, labels, featureNames = MODEL_FEATURE_NAMES, lr = LEARNING_RATE, epochs = EPOCHS, l2 = L2_LAMBDA) {
  const n = rows.length;
  if (n < 20) throw new Error(`not enough training rows (${n}) to fit a model`);

  const { means, stdevs } = standardizeFit(rows, featureNames);
  const xMat = rows.map((r) => standardizeRow(r, featureNames, means, stdevs));

  let weights = new Array(featureNames.length).fill(0);
  let bias = 0;
  let prevWeights = weights.slice();
  let prevBias = bias;
  let finalLoss = null;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(featureNames.length).fill(0);
    let gradB = 0;
    let totalLoss = 0;

    for (let i = 0; i < n; i++) {
      const x = xMat[i];
      const y = labels[i];
      let z = bias;
      for (let j = 0; j < x.length; j++) z += weights[j] * x[j];
      const p = sigmoid(z);
      const pClipped = Math.min(Math.max(p, PROB_EPS), 1 - PROB_EPS);
      totalLoss += -(y * Math.log(pClipped) + (1 - y) * Math.log(1 - pClipped));
      const err = p - y;
      for (let j = 0; j < x.length; j++) gradW[j] += err * x[j];
      gradB += err;
    }

    for (let j = 0; j < gradW.length; j++) gradW[j] = gradW[j] / n + l2 * weights[j];
    gradB /= n;
    const regTerm = (l2 / 2) * weights.reduce((a, w) => a + w * w, 0);
    totalLoss = totalLoss / n + regTerm;

    if (!Number.isFinite(totalLoss)) {
      return {
        diverged: true,
        epochsRun: epoch,
        weights: Object.fromEntries(featureNames.map((name, i) => [name, prevWeights[i]])),
        bias: prevBias,
        means,
        stdevs,
        featureNames,
      };
    }

    prevWeights = weights.slice();
    prevBias = bias;
    weights = weights.map((w, j) => w - lr * gradW[j]);
    bias -= lr * gradB;
    finalLoss = totalLoss;
  }

  return {
    diverged: false,
    epochsRun: epochs,
    finalLoss,
    weights: Object.fromEntries(featureNames.map((name, i) => [name, weights[i]])),
    bias,
    means,
    stdevs,
    featureNames,
  };
}

function predictProba(row, model) {
  const { featureNames, means, stdevs, weights } = model;
  let z = model.bias;
  for (const name of featureNames) {
    const xStd = (row[name] - means[name]) / stdevs[name];
    z += weights[name] * xStd;
  }
  return sigmoid(z);
}

function evaluatePrecisionAtK(rows, labels, model, k = 15) {
  if (!rows.length) return null;
  const scored = rows.map((row, i) => ({ row, label: labels[i], p: predictProba(row, model) }));
  scored.sort((a, b) => b.p - a.p);
  const topK = scored.slice(0, k);
  if (!topK.length) return null;
  const hits = topK.filter((s) => s.label === 1).length;
  return hits / topK.length;
}

function saveModel(model) {
  try {
    localStorage.setItem(WEIGHTS_STORAGE_KEY, JSON.stringify(model));
  } catch (e) { /* storage full or unavailable — training result just won't persist */ }
}

function loadModel() {
  try {
    const raw = localStorage.getItem(WEIGHTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
