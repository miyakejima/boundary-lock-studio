/**
 * weight-sweep.mjs
 *
 * Sweeps all 40 optimizer weight steps and reports android/desktop scores
 * at each step, using the same compareSourceMappings logic as the optimizer
 * (replicated inline since that function is not exported).
 *
 * Also runs against the demo banner (gradient with geometric features) to
 * give realistic, not synthetic, numbers.
 */

import {
  PRESETS,
  geometryFromPreset,
  sourceMappingFromLayout,
  sampleBannerWithContinuation,
  optimizeSharedAffineMapping,
} from './core.js?v=3.0.0';

// ── replicate non-exported helpers ───────────────────────────────────────────

function colorDifference(a, b) {
  return (Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2])) / 3;
}

function gradientDifference(ca, na, cb, nb) {
  return (
    Math.abs((ca[0]-na[0])-(cb[0]-nb[0])) +
    Math.abs((ca[1]-na[1])-(cb[1]-nb[1])) +
    Math.abs((ca[2]-na[2])-(cb[2]-nb[2]))
  ) / 3;
}

function structuralPointDifference({ actual, actualRadial, actualTangent, expected, expectedRadial, expectedTangent }) {
  const expectedEdge = Math.max(colorDifference(expected, expectedRadial), colorDifference(expected, expectedTangent));
  const actualEdge   = Math.max(colorDifference(actual,   actualRadial),   colorDifference(actual,   actualTangent));
  const featureWeight = 0.12 + Math.min(4, Math.max(expectedEdge, actualEdge * 0.65) / 18);
  const mismatch = colorDifference(actual, expected) + 0.7 * (
    gradientDifference(actual, actualRadial, expected, expectedRadial) +
    gradientDifference(actual, actualTangent, expected, expectedTangent)
  ) / 2;
  return { mismatch, featureWeight, expectedEdge };
}

function mappingScore(meanDiff) {
  return Math.round(100 * Math.exp(-3.5 * meanDiff / 255));
}

function sourceFromMapping(m, qx, qy) {
  return { x: m.centerX + qx * m.radiusX, y: m.centerY + qy * m.radiusY };
}

function compareSourceMappings({ banner, actualMapping, expectedMapping, fill, angles = 96 }) {
  const rings = [
    { radius: 0.86, weight: 0.14 },
    { radius: 0.91, weight: 0.20 },
    { radius: 0.95, weight: 0.26 },
    { radius: 0.985, weight: 0.40 },
  ];
  const tangentStep = (Math.PI * 2) / angles;
  const radialStep = 0.012;
  let weightedDiff = 0, totalWeight = 0, featureSignal = 0;

  const s = (mapping, qx, qy) => {
    const p = sourceFromMapping(mapping, qx, qy);
    return sampleBannerWithContinuation(banner, p.x, p.y, null, fill);
  };

  for (const ring of rings) {
    for (let idx = 0; idx < angles; idx++) {
      const angle     = (idx / angles) * Math.PI * 2;
      const qx        = Math.cos(angle) * ring.radius;
      const qy        = Math.sin(angle) * ring.radius;
      const radR      = Math.max(0, ring.radius - radialStep);
      const rqx       = Math.cos(angle) * radR;
      const rqy       = Math.sin(angle) * radR;
      const tqx       = Math.cos(angle + tangentStep) * ring.radius;
      const tqy       = Math.sin(angle + tangentStep) * ring.radius;
      const pt = structuralPointDifference({
        actual: s(actualMapping, qx, qy), actualRadial: s(actualMapping, rqx, rqy), actualTangent: s(actualMapping, tqx, tqy),
        expected: s(expectedMapping, qx, qy), expectedRadial: s(expectedMapping, rqx, rqy), expectedTangent: s(expectedMapping, tqx, tqy),
      });
      const w = pt.featureWeight * ring.weight;
      weightedDiff  += pt.mismatch * w;
      totalWeight   += w;
      featureSignal += pt.expectedEdge * ring.weight;
    }
  }
  const meanDiff = weightedDiff / Math.max(1, totalWeight);
  return { meanDiff, score: mappingScore(meanDiff) };
}

// ── demo banner (same procedural banner as app.js) ───────────────────────────
function createDemoBanner() {
  const W = 1500, H = 500;
  const data = new Uint8ClampedArray(W * H * 4);
  // gradient base
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // replicate the canvas gradient roughly: dark green-teal-purple
      const t = x / W;
      data[i]   = Math.round(6  + t * (19-6));
      data[i+1] = Math.round(21 + t * (39-21));
      data[i+2] = Math.round(15 + t * (38-15));
      data[i+3] = 255;
    }
  }
  // diagonal grid lines (white, alpha 24%)
  for (let x = -500; x < 1800; x += 70) {
    for (let py = 0; py < H; py++) {
      const px = x + (500 - py);
      if (px >= 0 && px < W) {
        const i = (py * W + px) * 4;
        data[i]   = Math.min(255, data[i]   + Math.round(255 * 0.24));
        data[i+1] = Math.min(255, data[i+1] + Math.round(255 * 0.24));
        data[i+2] = Math.min(255, data[i+2] + Math.round(255 * 0.24));
      }
    }
  }
  return { width: W, height: H, data };
}

// ── layouts ───────────────────────────────────────────────────────────────────
const banner = createDemoBanner();
const desktopBannerRect = { x: 80, y: 70, width: 1040, height: 1040 / PRESETS.desktop.frameAspect };
const desktopAvatar     = geometryFromPreset(PRESETS.desktop,     desktopBannerRect, 100);
const androidW          = 914;
const androidBannerRect = { x: 0, y: 0, width: androidW, height: androidW / PRESETS.androidApp.frameAspect };
const androidAvatar     = geometryFromPreset(PRESETS.androidApp, androidBannerRect, 100);

const desktopMapping = sourceMappingFromLayout({ banner, bannerRect: desktopBannerRect, avatar: desktopAvatar });
const androidMapping = sourceMappingFromLayout({ banner, bannerRect: androidBannerRect, avatar: androidAvatar });

console.log('Desktop mapping center: (' + desktopMapping.centerX.toFixed(1) + ', ' + desktopMapping.centerY.toFixed(1) + ')  radius: ' + desktopMapping.radiusX.toFixed(1));
console.log('Android mapping center: (' + androidMapping.centerX.toFixed(1)  + ', ' + androidMapping.centerY.toFixed(1)  + ')  radius: ' + androidMapping.radiusX.toFixed(1));
console.log('Center delta: ' + Math.hypot(desktopMapping.centerX - androidMapping.centerX, desktopMapping.centerY - androidMapping.centerY).toFixed(1) + ' source px');
console.log('Radius delta: ' + Math.abs(desktopMapping.radiusX - androidMapping.radiusX).toFixed(1) + ' source px');
console.log('');

const fill = [0,0,0,255];

console.log('weight | android | desktop | worst | avg  ← all via compareSourceMappings');
console.log('-------|---------|---------|-------|-----');

let bestWorstScore  = -1;
let bestWorstWeight = 0;
let bestAvgScore    = -1;
let bestAvgWeight   = 0;

for (let step = 0; step <= 40; step++) {
  const w = step / 40;
  const actual = {
    centerX: androidMapping.centerX * w + desktopMapping.centerX * (1 - w),
    centerY: androidMapping.centerY * w + desktopMapping.centerY * (1 - w),
    radiusX: androidMapping.radiusX * w + desktopMapping.radiusX * (1 - w),
    radiusY: androidMapping.radiusY * w + desktopMapping.radiusY * (1 - w),
  };

  const aRes = compareSourceMappings({ banner, actualMapping: actual, expectedMapping: androidMapping, fill });
  const dRes = compareSourceMappings({ banner, actualMapping: actual, expectedMapping: desktopMapping, fill });

  const worst = Math.min(aRes.score, dRes.score);
  const avg   = (aRes.score + dRes.score) / 2;

  if (worst > bestWorstScore) { bestWorstScore = worst; bestWorstWeight = w; }
  if (avg   > bestAvgScore)   { bestAvgScore   = avg;   bestAvgWeight   = w; }

  console.log(
    w.toFixed(3).padEnd(7) + '| ' +
    String(aRes.score).padEnd(8) + '| ' +
    String(dRes.score).padEnd(8) + '| ' +
    String(worst).padEnd(6) + '| ' +
    avg.toFixed(1)
  );
}

console.log('');
console.log('Best minimax weight : ' + bestWorstWeight.toFixed(3) + ' → worst=' + bestWorstScore);
console.log('Best avg weight     : ' + bestAvgWeight.toFixed(3)   + ' → avg='   + bestAvgScore.toFixed(1));
console.log('');

// ── also run the optimizer itself so we can compare ───────────────────────────
const result = optimizeSharedAffineMapping({
  banner,
  primaryMapping: androidMapping,   // Android protected by fallback
  secondaryMapping: desktopMapping,
  continuation: null,
  pageColor: [0,0,0],
});
console.log('Optimizer result:');
console.log('  Returned weight    :', result.equivalentWeight.toFixed(3));
console.log('  Android(primary)   :', result.primaryScore);
console.log('  Desktop(secondary) :', result.secondaryScore);
console.log('  Feasible           :', result.feasible);
console.log('  Balanced candidate : weight=' + result.balancedCandidate.weight.toFixed(3)
  + '  android=' + result.balancedCandidate.primaryScore
  + '  desktop=' + result.balancedCandidate.secondaryScore
  + '  worst='   + result.balancedCandidate.worstScore);
