import {
  PRESETS,
  buildPairAwareFeatureBanner,
  geometryFromPreset,
  sourceMappingFromLayout,
  calculatePairLayoutScore,
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

const desktopImageRadius = Math.max(1, desktopAvatar.outerRadius - desktopAvatar.padding);
const desktopOuterRatio = desktopAvatar.outerRadius / desktopImageRadius;

const androidImageRadius = Math.max(1, androidAvatar.outerRadius - (androidAvatar.padding || 0));
const androidOuterRatio = androidAvatar.outerRadius / androidImageRadius;

// Create the compromise mapping (weight = 0.4, i.e., 60% Desktop, 40% Android)
const w = 0.4;
const compromiseMapping = {
  centerX: desktopMapping.centerX * (1 - w) + androidMapping.centerX * w,
  centerY: desktopMapping.centerY * (1 - w) + androidMapping.centerY * w,
  radiusX: desktopMapping.radiusX * (1 - w) + androidMapping.radiusX * w,
  radiusY: desktopMapping.radiusY * (1 - w) + androidMapping.radiusY * w,
};

// Pass 1: Adjust Desktop banner towards the compromise mapping
const step1 = buildPairAwareFeatureBanner({
  banner,
  referenceBanner: banner,
  referenceMapping: compromiseMapping, // Reference is compromise
  platformMapping: desktopMapping,       // Adjust Desktop
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

// Pass 2: Adjust Android banner towards the compromise mapping
const step2 = buildPairAwareFeatureBanner({
  banner: { width: banner.width, height: banner.height, data: step1.data },
  referenceBanner: banner,
  referenceMapping: compromiseMapping, // Reference is compromise
  platformMapping: androidMapping,       // Adjust Android
  platformBannerRect: androidBannerRect,
  platformAvatar: androidAvatar,
  pageColor: [0, 0, 0],
  platformOuterRatio: androidOuterRatio,
  reachRatio: 0.95,
  radialFeatherRatio: 0.24,
  upperFadeStart: -0.08,
  upperFadeEnd: 0.1,
  featureStrength: 1,
});

const adjustedBanner = { width: banner.width, height: banner.height, data: step2.data };

// Measure Desktop score: how well adjusted banner matches compromise mapping
const desktopScore = calculatePairLayoutScore({
  referenceBanner: banner,
  adjustedBanner,
  referenceMapping: compromiseMapping,
  platformMapping: desktopMapping,
  bannerRect: desktopBannerRect,
  avatar: desktopAvatar,
});

// Measure Android score: how well adjusted banner matches compromise mapping
const androidScore = calculatePairLayoutScore({
  referenceBanner: banner,
  adjustedBanner,
  referenceMapping: compromiseMapping,
  platformMapping: androidMapping,
  bannerRect: androidBannerRect,
  avatar: androidAvatar,
});

console.log("Desktop Score (Joint adjustment):", JSON.stringify(desktopScore, null, 2));
console.log("Android Score (Joint adjustment):", JSON.stringify(androidScore, null, 2));
