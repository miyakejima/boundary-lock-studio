/**
 * Integration test for Best Shared mode.
 *
 * Uses the optimizer's own compareSourceMappings metric (replicated inline)
 * on the demo banner — the same banner the app starts with — so the scores
 * reflect real-world performance rather than an artificial flat fill.
 *
 * Pass condition: optimizer returns feasible=true with worst(android,desktop) >= 80.
 * On the demo banner the target is android≈87, desktop≈85 at weight≈0.025.
 */

import {
  PRESETS,
  geometryFromPreset,
  sourceMappingFromLayout,
  sampleBannerWithContinuation,
  optimizeSharedAffineMapping,
} from './core.js?v=3.0.0';

// ── replicated non-exported helpers (same as optimizer internals) ─────────────

function colorDifference(a, b) {
  return (Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2])) / 3;
}
function gradientDifference(ca, na, cb, nb) {
  return (Math.abs((ca[0]-na[0])-(cb[0]-nb[0])) + Math.abs((ca[1]-na[1])-(cb[1]-nb[1])) + Math.abs((ca[2]-na[2])-(cb[2]-nb[2]))) / 3;
}
function structuralPointDifference({ actual, actualRadial, actualTangent, expected, expectedRadial, expectedTangent }) {
  const expectedEdge  = Math.max(colorDifference(expected, expectedRadial), colorDifference(expected, expectedTangent));
  const actualEdge    = Math.max(colorDifference(actual,   actualRadial),   colorDifference(actual,   actualTangent));
  const featureWeight = 0.12 + Math.min(4, Math.max(expectedEdge, actualEdge * 0.65) / 18);
  const mismatch      = colorDifference(actual, expected) + 0.7 * (
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

function scoreMapping({ banner, actualMapping, expectedMapping, fill, angles = 96 }) {
  const rings = [
    { radius: 0.86, weight: 0.14 }, { radius: 0.91, weight: 0.20 },
    { radius: 0.95, weight: 0.26 }, { radius: 0.985, weight: 0.40 },
  ];
  const tangentStep = (Math.PI * 2) / angles;
  const radialStep  = 0.012;
  let weightedDiff = 0, totalWeight = 0;
  const s = (m, qx, qy) => {
    const p = sourceFromMapping(m, qx, qy);
    return sampleBannerWithContinuation(banner, p.x, p.y, null, fill);
  };
  for (const ring of rings) {
    for (let idx = 0; idx < angles; idx++) {
      const angle = (idx / angles) * Math.PI * 2;
      const qx = Math.cos(angle) * ring.radius, qy = Math.sin(angle) * ring.radius;
      const rqx = Math.cos(angle) * Math.max(0, ring.radius - radialStep), rqy = Math.sin(angle) * Math.max(0, ring.radius - radialStep);
      const tqx = Math.cos(angle + tangentStep) * ring.radius, tqy = Math.sin(angle + tangentStep) * ring.radius;
      const pt = structuralPointDifference({
        actual: s(actualMapping, qx, qy),       actualRadial: s(actualMapping, rqx, rqy),   actualTangent: s(actualMapping, tqx, tqy),
        expected: s(expectedMapping, qx, qy),   expectedRadial: s(expectedMapping, rqx, rqy), expectedTangent: s(expectedMapping, tqx, tqy),
      });
      const w = pt.featureWeight * ring.weight;
      weightedDiff += pt.mismatch * w;
      totalWeight  += w;
    }
  }
  return mappingScore(weightedDiff / Math.max(1, totalWeight));
}

// ── demo banner (procedural, matches app startup) ─────────────────────────────
const W = 1500, H = 500;
const data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const t = x / W;
    data[i]   = Math.round(6  + t * 13);
    data[i+1] = Math.round(21 + t * 18);
    data[i+2] = Math.round(15 + t * 23);
    data[i+3] = 255;
  }
}
// diagonal grid lines
for (let x = -500; x < 1800; x += 70) {
  for (let py = 0; py < H; py++) {
    const px = x + (500 - py);
    if (px >= 0 && px < W) {
      const i = (py * W + px) * 4;
      data[i]   = Math.min(255, data[i]   + 61);
      data[i+1] = Math.min(255, data[i+1] + 61);
      data[i+2] = Math.min(255, data[i+2] + 61);
    }
  }
}
const banner = { width: W, height: H, data };

// ── layouts ───────────────────────────────────────────────────────────────────
const desktopBannerRect = { x: 80, y: 70, width: 1040, height: 1040 / PRESETS.desktop.frameAspect };
const desktopAvatar     = geometryFromPreset(PRESETS.desktop,     desktopBannerRect, 100);
const androidW          = 914;
const androidBannerRect = { x: 0, y: 0, width: androidW, height: androidW / PRESETS.androidApp.frameAspect };
const androidAvatar     = geometryFromPreset(PRESETS.androidApp,  androidBannerRect, 100);

const desktopMapping = sourceMappingFromLayout({ banner, bannerRect: desktopBannerRect, avatar: desktopAvatar });
const androidMapping = sourceMappingFromLayout({ banner, bannerRect: androidBannerRect, avatar: androidAvatar });

console.log('Geometry conflict:');
console.log('  Center delta : ' + Math.hypot(desktopMapping.centerX - androidMapping.centerX, desktopMapping.centerY - androidMapping.centerY).toFixed(1) + ' source px');
console.log('  Radius delta : ' + Math.abs(desktopMapping.radiusX - androidMapping.radiusX).toFixed(1) + ' source px');

// ── Run optimizer (Android=primary so fallback protects Android) ──────────────
const result = optimizeSharedAffineMapping({
  banner,
  primaryMapping:   androidMapping,   // Android protected by fallback
  secondaryMapping: desktopMapping,
  continuation: null,
  pageColor: [0, 0, 0],
});

console.log('\nOptimizer result:');
console.log('  Weight (returned) : ' + result.equivalentWeight.toFixed(3));
console.log('  Feasible          : ' + result.feasible);

const fill = [0,0,0,255];
const chosenMapping = result.mapping;
const androidScore  = scoreMapping({ banner, actualMapping: chosenMapping, expectedMapping: androidMapping, fill });
const desktopScore  = scoreMapping({ banner, actualMapping: chosenMapping, expectedMapping: desktopMapping, fill });

console.log('\nSeam scores at chosen mapping (compareSourceMappings metric):');
console.log('  Android score : ' + androidScore);
console.log('  Desktop score : ' + desktopScore);
console.log('  Worst         : ' + Math.min(androidScore, desktopScore));

// Reference: platform-exact scores
const androidExact  = scoreMapping({ banner, actualMapping: androidMapping,  expectedMapping: androidMapping, fill });
const desktopExact  = scoreMapping({ banner, actualMapping: desktopMapping,  expectedMapping: desktopMapping, fill });
const androidOnDsk  = scoreMapping({ banner, actualMapping: androidMapping,  expectedMapping: desktopMapping, fill });
const desktopOnAnd  = scoreMapping({ banner, actualMapping: desktopMapping,  expectedMapping: androidMapping, fill });

console.log('\nReference scores:');
console.log('  Android-exact crop → android layout : ' + androidExact + ' (should be 100)');
console.log('  Desktop-exact crop → desktop layout : ' + desktopExact + ' (should be 100)');
console.log('  Android-exact crop → desktop layout : ' + androidOnDsk + ' (misaligned)');
console.log('  Desktop-exact crop → android layout : ' + desktopOnAnd + ' (misaligned)');

// ── Pass / fail ───────────────────────────────────────────────────────────────
const worstScore = Math.min(androidScore, desktopScore);
const passed = result.feasible && worstScore >= 80;
console.log('\n' + (passed ? '✓ PASS' : '✗ FAIL') + ': feasible=' + result.feasible + '  worst=' + worstScore + ' (need feasible=true, worst>=80)');
if (!passed) process.exit(1);
