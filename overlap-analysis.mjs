/**
 * Diagnostic test: visualize the overlap region between Desktop and Android
 * boundaries to understand the protection gap impact.
 */
import {
  PRESETS,
  computeCoverTransform,
  geometryFromPreset,
  screenToSource,
  sourceMappingFromLayout,
  smoothstep,
} from "./core.js";

// Test banner dimensions
const banner = { width: 1500, height: 500 };

// Desktop geometry
const desktopBannerRect = { x: 80, y: 70, width: 1040, height: 1040 / PRESETS.desktop.frameAspect };
const desktopAvatar = geometryFromPreset(PRESETS.desktop, desktopBannerRect, 100);

// Android geometry
const androidWidth = 914;
const androidBannerRect = { x: 0, y: 0, width: androidWidth, height: androidWidth / PRESETS.androidApp.frameAspect };
const androidAvatar = geometryFromPreset(PRESETS.androidApp, androidBannerRect, 100);

// Source mappings
const desktopMapping = sourceMappingFromLayout({ banner, bannerRect: desktopBannerRect, avatar: desktopAvatar });
const androidMapping = sourceMappingFromLayout({ banner, bannerRect: androidBannerRect, avatar: androidAvatar });

// Check overlap at every angle
const samples = 360;
const lockRadius = 0.95;

console.log("Angle analysis: where does the Desktop correction annulus overlap with the Android boundary?");
console.log("(angles in degrees, 0=right, 90=bottom, 180=left, 270=top)\n");

let overlapCount = 0;
let noOverlapCount = 0;

for (let i = 0; i < samples; i++) {
  const angle = (i / samples) * Math.PI * 2;
  const angleDeg = Math.round(i / samples * 360);
  const qx = Math.cos(angle) * lockRadius;
  const qy = Math.sin(angle) * lockRadius;

  // Desktop boundary point in source space (where we want to paint)
  const dsx = desktopMapping.centerX + qx * desktopMapping.radiusX;
  const dsy = desktopMapping.centerY + qy * desktopMapping.radiusY;

  // How far is this point from Android center (in normalized Android radius)?
  const adx = dsx - androidMapping.centerX;
  const ady = dsy - androidMapping.centerY;
  const androidNormDist = Math.hypot(adx / androidMapping.radiusX, ady / androidMapping.radiusY);
  
  const inProtectionZone = androidNormDist >= 0.82 && androidNormDist <= 1.08;
  if (inProtectionZone) overlapCount++;
  else noOverlapCount++;
  
  if (i % 30 === 0) {
    console.log(`  ${angleDeg}°: Desktop boundary → Android normalized radius = ${androidNormDist.toFixed(3)} ${inProtectionZone ? "⚠ PROTECTED" : "✓ free"}`);
  }
}

console.log(`\nOverlap summary: ${overlapCount}/${samples} angles protected (${(overlapCount/samples*100).toFixed(1)}%), ${noOverlapCount} free`);

// Try narrower protection
console.log("\nTrying narrower protection zones:");
for (const [start, end] of [[0.85, 1.04], [0.88, 1.02], [0.90, 1.01], [0.82, 1.08]]) {
  let count = 0;
  for (let i = 0; i < samples; i++) {
    const angle = (i / samples) * Math.PI * 2;
    const qx = Math.cos(angle) * lockRadius;
    const qy = Math.sin(angle) * lockRadius;
    const dsx = desktopMapping.centerX + qx * desktopMapping.radiusX;
    const dsy = desktopMapping.centerY + qy * desktopMapping.radiusY;
    const adx = dsx - androidMapping.centerX;
    const ady = dsy - androidMapping.centerY;
    const androidNormDist = Math.hypot(adx / androidMapping.radiusX, ady / androidMapping.radiusY);
    if (androidNormDist >= start && androidNormDist <= end) count++;
  }
  console.log(`  [${start}, ${end}]: ${count}/${samples} protected (${(count/samples*100).toFixed(1)}%)`);
}
