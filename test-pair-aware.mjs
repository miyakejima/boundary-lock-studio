import {
  PRESETS,
  buildPairAwareFeatureBanner,
  buildAvatar,
  computeCoverTransform,
  detectBoundaryLines,
  geometryFromPreset,
  sampleBilinear,
  sampleBannerWithContinuation,
  screenToSource,
  sourceMappingFromLayout,
} from "./core.js";

// Create a test banner with features (gradient + lines)
function createTestBanner() {
  const width = 1500;
  const height = 500;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Gradient background
      data[i] = Math.round(x / width * 80 + y / height * 40);
      data[i + 1] = Math.round(30 + x / width * 60);
      data[i + 2] = Math.round(50 + y / height * 120);
      data[i + 3] = 255;
      // Diagonal line features
      if (Math.abs(y - (x * 0.33 + 100)) < 4) {
        data[i] = 200; data[i + 1] = 240; data[i + 2] = 180;
      }
      if (Math.abs(y - (500 - x * 0.2)) < 3) {
        data[i] = 120; data[i + 1] = 160; data[i + 2] = 255;
      }
    }
  }
  return { width, height, data };
}

const banner = createTestBanner();

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

console.log("Desktop source mapping:", JSON.stringify(desktopMapping, (k, v) => typeof v === "number" ? +v.toFixed(2) : v));
console.log("Android source mapping:", JSON.stringify(androidMapping, (k, v) => typeof v === "number" ? +v.toFixed(2) : v));

// Compute continuation from original banner
const androidContinuation = detectBoundaryLines({
  banner, bannerRect: androidBannerRect, avatar: androidAvatar, sensitivity: 0.58,
});

// Build avatar from Android mapping (original banner)
const avatarResult = buildAvatar({
  banner,
  portrait: null,
  outputSize: 400,
  bannerRect: androidBannerRect,
  avatar: androidAvatar,
  mode: "banner",
  shape: "circle",
  pageColor: [0, 0, 0],
  opaqueCorners: true,
  lockStart: 0.85,
  featherWidth: 0.2,
  portraitControls: null,
  continuation: androidContinuation,
  compatibility: { enabled: false },
});

// Build adjusted banner using buildPairAwareFeatureBanner
const desktopImageRadius = Math.max(1, desktopAvatar.outerRadius - desktopAvatar.padding);
const desktopOuterRatio = desktopAvatar.outerRadius / desktopImageRadius;
const androidImageRadius = Math.max(1, androidAvatar.outerRadius - (androidAvatar.padding || 0));

const adjusted = buildPairAwareFeatureBanner({
  banner,
  referenceBanner: banner,
  referenceMapping: androidMapping, // Android mapping
  platformMapping: desktopMapping,     // Desktop mapping
  platformBannerRect: desktopBannerRect,
  platformAvatar: desktopAvatar,
  pageColor: [0, 0, 0],
  platformOuterRatio: desktopOuterRatio,
  reachRatio: 0.95,
  radialFeatherRatio: 0.24,
  upperFadeStart: -0.08,
  upperFadeEnd: 0.1,
  featureStrength: 1,
});

console.log("\nAdjusted banner diagnostics:");
console.log(`  Changed pixels: ${adjusted.diagnostics.changedPixels}`);
console.log(`  Changed fraction: ${(adjusted.diagnostics.changedFraction * 100).toFixed(2)}%`);
console.log(`  Mean delta: ${adjusted.diagnostics.meanChangedDelta.toFixed(1)}`);
console.log(`  Max delta: ${adjusted.diagnostics.maximumDelta.toFixed(1)}`);
console.log(`  Safe: ${adjusted.diagnostics.safe}`);

// Now test: sample the avatar boundary and compare against what each platform
// would display from the adjusted banner
const adjustedBanner = { width: banner.width, height: banner.height, data: adjusted.data };
const fill = [0, 0, 0, 255];
const samples = 360;
const lockRadius = 0.95; // middle of the locked ring

let desktopTotalError = 0;
let androidTotalError = 0;
let desktopMaxError = 0;
let androidMaxError = 0;
let count = 0;

const desktopTransform = computeCoverTransform(banner.width, banner.height, desktopBannerRect);
const androidTransform = computeCoverTransform(banner.width, banner.height, androidBannerRect);

for (let i = 0; i < samples; i++) {
  const angle = (i / samples) * Math.PI * 2;
  const qx = Math.cos(angle) * lockRadius;
  const qy = Math.sin(angle) * lockRadius;
  
  // Avatar pixel at this position
  const au = Math.round(((qx + 1) / 2) * (avatarResult.width - 1));
  const av = Math.round(((qy + 1) / 2) * (avatarResult.height - 1));
  const ai = (av * avatarResult.width + au) * 4;
  const avatarColor = [avatarResult.data[ai], avatarResult.data[ai + 1], avatarResult.data[ai + 2]];
  
  // Desktop: what the adjusted banner shows at this avatar boundary position
  const desktopScreenX = desktopAvatar.centerX + qx * desktopImageRadius;
  const desktopScreenY = desktopAvatar.centerY + qy * desktopImageRadius;
  const desktopSource = screenToSource(desktopScreenX, desktopScreenY, desktopTransform);
  const desktopColor = sampleBilinear(adjustedBanner, desktopSource.x, desktopSource.y, fill);
  
  // Android: what the adjusted banner shows at this avatar boundary position
  const androidScreenX = androidAvatar.centerX + qx * androidImageRadius;
  const androidScreenY = androidAvatar.centerY + qy * androidImageRadius;
  const androidSource = screenToSource(androidScreenX, androidScreenY, androidTransform);
  const androidColor = sampleBannerWithContinuation(adjustedBanner, androidSource.x, androidSource.y, androidContinuation, fill);
  
  const desktopError = (
    Math.abs(avatarColor[0] - desktopColor[0]) +
    Math.abs(avatarColor[1] - desktopColor[1]) +
    Math.abs(avatarColor[2] - desktopColor[2])
  ) / 3;
  
  const androidError = (
    Math.abs(avatarColor[0] - androidColor[0]) +
    Math.abs(avatarColor[1] - androidColor[1]) +
    Math.abs(avatarColor[2] - androidColor[2])
  ) / 3;
  
  desktopTotalError += desktopError;
  androidTotalError += androidError;
  desktopMaxError = Math.max(desktopMaxError, desktopError);
  androidMaxError = Math.max(androidMaxError, androidError);
  count++;
}

const desktopMeanError = desktopTotalError / count;
const androidMeanError = androidTotalError / count;

console.log("\nBoundary alignment check (lower = better):");
console.log(`  Desktop mean error: ${desktopMeanError.toFixed(2)} (max: ${desktopMaxError.toFixed(1)})`);
console.log(`  Android mean error: ${androidMeanError.toFixed(2)} (max: ${androidMaxError.toFixed(1)})`);
