import {
  PRESETS,
  buildAvatar,
  geometryFromPreset,
  sourceMappingFromLayout,
  calculatePairLayoutScore,
  sampleBilinear,
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

// Implement coordinate warp
function buildWarpedBanner(banner, primaryMapping, secondaryMapping, desktopOuterRatio) {
  const data = new Uint8ClampedArray(banner.width * banner.height * 4);
  const fill = [0, 0, 0, 255];
  
  const C_d = { x: secondaryMapping.centerX, y: secondaryMapping.centerY };
  const C_a = { x: primaryMapping.centerX, y: primaryMapping.centerY };
  const R_d = secondaryMapping.radiusX * desktopOuterRatio;
  const R_a = primaryMapping.radiusX;
  
  const F = R_d * 0.95; // fade distance
  
  for (let y = 0; y < banner.height; y++) {
    for (let x = 0; x < banner.width; x++) {
      const dx = x - C_d.x;
      const dy = y - C_d.y;
      const r = Math.hypot(dx, dy);
      
      const ux = r > 1e-5 ? dx / r : 1;
      const uy = r > 1e-5 ? dy / r : 0;
      
      const P_ax = C_a.x + ux * R_a;
      const P_ay = C_a.y + uy * R_a;
      const P_dx = C_d.x + ux * R_d;
      const P_dy = C_d.y + uy * R_d;
      
      const R_ad = Math.hypot(P_ax - C_d.x, P_ay - C_d.y);
      
      let w = 0;
      const diff = R_d - R_ad;
      if (Math.abs(diff) > 1e-5) {
        if (diff > 0) {
          if (r < R_ad) {
            w = 0;
          } else if (r >= R_ad && r <= R_d) {
            const t = (r - R_ad) / diff;
            w = 3 * t * t - 2 * t * t * t;
          } else if (r > R_d && r <= R_d + F) {
            const t = (r - R_d) / F;
            w = 1 - (3 * t * t - 2 * t * t * t);
          } else {
            w = 0;
          }
        } else { // diff < 0
          if (r < R_d) {
            w = 0;
          } else if (r >= R_d && r <= R_ad) {
            const t = (r - R_ad) / -diff;
            w = 3 * t * t - 2 * t * t * t;
          } else {
            w = 0;
          }
        }
      } else {
        w = 0;
      }
      
      const Vx = P_ax - P_dx;
      const Vy = P_ay - P_dy;
      
      const sx = x + w * Vx;
      const sy = y + w * Vy;
      
      const color = sampleBilinear(banner, sx, sy, fill);
      const idx = (y * banner.width + x) * 4;
      data[idx] = color[0];
      data[idx + 1] = color[1];
      data[idx + 2] = color[2];
      data[idx + 3] = color[3];
    }
  }
  return { width: banner.width, height: banner.height, data };
}

console.log("Building warped banner...");
const warped = buildWarpedBanner(banner, androidMapping, desktopMapping, desktopOuterRatio);

// Measure Desktop score: how well adjusted banner matches compromise mapping
const desktopScore = calculatePairLayoutScore({
  referenceBanner: banner,
  adjustedBanner: warped,
  referenceMapping: androidMapping,
  platformMapping: desktopMapping,
  bannerRect: desktopBannerRect,
  avatar: desktopAvatar,
  referenceAvatar: androidAvatar,
});

// Measure Android score: how well adjusted banner matches compromise mapping
const androidScore = calculatePairLayoutScore({
  referenceBanner: banner,
  adjustedBanner: warped,
  referenceMapping: androidMapping,
  platformMapping: androidMapping,
  bannerRect: androidBannerRect,
  avatar: androidAvatar,
  referenceAvatar: androidAvatar,
});

console.log("Desktop Score (Warped Banner):", JSON.stringify(desktopScore, null, 2));
console.log("Android Score (Warped Banner):", JSON.stringify(androidScore, null, 2));

const angle = 0;
const ring = { radius: desktopOuterRatio + 0.004 }; // first ring
const x = desktopMapping.centerX + Math.cos(angle) * ring.radius * desktopMapping.radiusX;
const y = desktopMapping.centerY + Math.sin(angle) * ring.radius * desktopMapping.radiusY;

const dx = x - desktopMapping.centerX;
const dy = y - desktopMapping.centerY;
const r = Math.hypot(dx, dy);
const ux = r > 1e-5 ? dx / r : 1;
const uy = r > 1e-5 ? dy / r : 0;
const P_ax = androidMapping.centerX + ux * androidMapping.radiusX;
const P_ay = androidMapping.centerY + uy * androidMapping.radiusY;
const R_d = desktopMapping.radiusX * desktopOuterRatio;
const P_dx = desktopMapping.centerX + ux * R_d;
const P_dy = desktopMapping.centerY + uy * R_d;
const R_ad = Math.hypot(P_ax - desktopMapping.centerX, P_ay - desktopMapping.centerY);
const F = R_d * 0.95;
let w = 0;
const diff = R_d - R_ad;
if (Math.abs(diff) > 1e-5) {
  if (diff > 0) {
    if (r >= R_ad && r <= R_d) {
      const t = (r - R_ad) / diff;
      w = 3 * t * t - 2 * t * t * t;
    } else if (r > R_d && r <= R_d + F) {
      const t = (r - R_d) / F;
      w = 1 - (3 * t * t - 2 * t * t * t);
    }
  } else {
    if (r >= R_d && r <= R_ad) {
      const t = (r - R_ad) / -diff;
      w = 3 * t * t - 2 * t * t * t;
    }
  }
}
const Vx = P_ax - P_dx;
const Vy = P_ay - P_dy;
const sx = x + w * Vx;
const sy = y + w * Vy;

const x_expected = androidMapping.centerX + Math.cos(angle) * ring.radius * androidMapping.radiusX;
const y_expected = androidMapping.centerY + Math.sin(angle) * ring.radius * androidMapping.radiusY;

console.log("\nDEBUG FOR ANGLE 0:");
console.log("Desktop query point:", x, y);
console.log("Desktop radius r:", r, "R_d:", R_d, "R_ad:", R_ad);
console.log("Warp weight w:", w);
console.log("Warped source sx, sy:", sx, sy);
console.log("Expected source:", x_expected, y_expected);
console.log("Distance difference:", Math.hypot(sx - x_expected, sy - y_expected));
