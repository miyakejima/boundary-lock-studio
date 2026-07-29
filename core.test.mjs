import assert from "node:assert/strict";
import {
  PRESETS,
  buildAvatar,
  buildLinkedBanner,
  buildLinkedProfile,
  calculateLayoutSeamScore,
  calculateQuality,
  computeCoverTransform,
  detectBoundaryLines,
  geometryFromPreset,
  sampleBilinear,
  sampleBannerWithContinuation,
  screenToSource,
  smoothstep,
} from "./core.js";

function solid(width, height, rgba) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set(rgba, i * 4);
  return { width, height, data };
}

function gradient(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data.set([x * 10, y * 10, 100, 255], i);
    }
  }
  return { width, height, data };
}

function fineGradient(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data.set([x, y * 2, (x * 3 + y * 5) % 256, 255], i);
    }
  }
  return { width, height, data };
}

function landmarkPattern(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let color = [45 + x * 0.55, 55 + y * 0.8, 90 + x * 0.25, 255];
      if (x >= 42 && x <= 72 && y >= 35 && y <= 55) color = [15, 20, 25, 255];
      if (Math.abs(y - (72 - x * 0.16)) <= 2) color = [8, 10, 12, 255];
      if (y >= 76 && y <= 84) color = [218, 205, 170, 255];
      data.set(color, i);
    }
  }
  return { width, height, data };
}

assert.equal(smoothstep(0, 1, -1), 0);
assert.equal(smoothstep(0, 1, 2), 1);
assert.equal(smoothstep(0, 1, 0.5), 0.5);

const rect = { x: 20, y: 30, width: 300, height: 100 };
const transform = computeCoverTransform(1500, 500, rect);
assert.equal(transform.scaleX, 0.2);
assert.deepEqual(screenToSource(20, 30, transform), { x: 0, y: 0 });

const crop = computeCoverTransform(1500, 500, { x: 0, y: 0, width: 375, height: 200 });
assert.equal(crop.scaleX, 0.4);
assert.equal(crop.translateX, -112.5);

const sampled = sampleBilinear(gradient(4, 4), 1.5, 2.5);
assert.deepEqual(sampled.map(Math.round), [15, 25, 100, 255]);

const bannerRect = { x: 0, y: 0, width: 300, height: 100 };
const avatar = geometryFromPreset(PRESETS.desktop, bannerRect);
assert.equal(avatar.centerY, 100);
assert.equal(avatar.padding, 4);
assert.equal(PRESETS.androidApp.frameAspect, 3, "Android app preset should preserve the 3:1 header crop");
const androidPresetBannerRect = { x: 0, y: 0, width: 914, height: 914 / PRESETS.androidApp.frameAspect };
const androidPresetAvatar = geometryFromPreset(PRESETS.androidApp, androidPresetBannerRect);
assert.equal(PRESETS.androidApp.androidDpGeometry.logicalWidthDp, 411);
assert.equal(Math.round(androidPresetAvatar.centerX), 116, "Current Android preset must use X Compose's 12dp + 40dp center");
assert.equal(Math.round(androidPresetAvatar.centerY), 331, "Current Android center must account for the 28dp overlap and 80dp size");
assert.equal(Math.round(androidPresetAvatar.outerRadius), 89);
assert.equal(androidPresetAvatar.padding, 0, "Compose border must not shrink the 80dp avatar image");
assert.equal(Math.round(androidPresetAvatar.borderWidth), 4, "Current Android border must scale from X Compose's 2dp overlay border");
assert.equal(
  geometryFromPreset(PRESETS.androidApp, androidPresetBannerRect, 175).padding,
  androidPresetAvatar.padding,
  "Android dp geometry must not inherit desktop browser zoom",
);
const legacyAndroidAvatar = geometryFromPreset(PRESETS.androidLegacy, androidPresetBannerRect);
assert.equal(Math.round(legacyAndroidAvatar.centerX), 105, "Legacy Android geometry must remain versioned for regressions");
assert.equal(Math.round(legacyAndroidAvatar.centerY), 309);
const containedAvatar = { ...avatar, centerY: 50 };

const controls = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0, opacity: 1, contrast: 1, saturation: 1, blackLevel: 0 };
const resultA = buildAvatar({
  banner: solid(300, 100, [40, 80, 120, 255]), portrait: null, outputSize: 64,
  bannerRect, avatar: containedAvatar, mode: "banner", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls,
});
assert.equal(resultA.width, 64);
assert.equal(resultA.data[3], 255, "opaque corners must be the safe default");

const resultB = buildAvatar({
  banner: solid(300, 100, [40, 80, 120, 255]), portrait: solid(64, 64, [240, 10, 10, 255]), outputSize: 64,
  bannerRect, avatar: containedAvatar, mode: "portrait", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls,
});
const center = ((32 * 64) + 32) * 4;
assert.ok(resultB.data[center] > 200, "portrait must own the center");
const nearEdge = ((32 * 64) + 62) * 4;
assert.equal(resultB.data[nearEdge], 40, "banner must own the locked outer ring");
assert.equal(resultB.diagnostics.portraitAtLock, 0, "portrait cannot leak into the locked ring");

const linkedSource = gradient(16, 16);
const linkedControls = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  opacity: 1,
  contrast: 1,
  saturation: 1,
  blackLevel: 0,
};
const linkedProfile = buildLinkedProfile({
  source: linkedSource,
  controls: linkedControls,
  outputSize: 16,
  shape: "circle",
  pageColor: [0, 0, 0],
});
const linkedBanner = buildLinkedBanner({
  source: linkedSource,
  mapping: { centerX: 8, centerY: 8, radiusX: 8, radiusY: 8 },
  controls: linkedControls,
  outputWidth: 16,
  outputHeight: 16,
  pageColor: [0, 0, 0],
});
const linkedCenter = (8 * 16 + 8) * 4;
assert.deepEqual(
  Array.from(linkedProfile.data.slice(linkedCenter, linkedCenter + 4)),
  Array.from(linkedBanner.data.slice(linkedCenter, linkedCenter + 4)),
  "profile and banner must sample identical source pixels at the same normalized coordinate",
);
for (const [x, y] of [[8, 1], [1, 8], [15, 8], [8, 15], [4, 4], [12, 4], [4, 12], [12, 12]]) {
  const index = (y * 16 + x) * 4;
  assert.deepEqual(
    Array.from(linkedProfile.data.slice(index, index + 4)),
    Array.from(linkedBanner.data.slice(index, index + 4)),
    `profile and banner must share the exact source transform at (${x}, ${y})`,
  );
}
const linkedNearEdge = (8 * 16 + 15) * 4;
assert.ok(linkedProfile.data[linkedNearEdge] > 0,
  "the linked profile source must own the complete visible circle, including its edge");
const movedLinkedBanner = buildLinkedBanner({
  source: linkedSource,
  mapping: { centerX: 8, centerY: 8, radiusX: 8, radiusY: 8 },
  controls: { ...linkedControls, offsetX: 0.25, rotation: 12, contrast: 1.2 },
  outputWidth: 16,
  outputHeight: 16,
  pageColor: [0, 0, 0],
});
assert.notDeepEqual(movedLinkedBanner.data, linkedBanner.data,
  "profile geometry and appearance controls must change the linked banner");
const uncoveredLinkedBanner = buildLinkedBanner({
  source: linkedSource,
  mapping: { centerX: 8, centerY: 8, radiusX: 8, radiusY: 8 },
  controls: { ...linkedControls, scale: 0.5 },
  outputWidth: 16,
  outputHeight: 16,
  pageColor: [0, 0, 0],
});
assert.ok(uncoveredLinkedBanner.diagnostics.uncoveredFraction > 0,
  "linked rendering must report source coverage gaps instead of inventing content");

const landscapeSource = gradient(12, 6);
const undistortedProfile = buildLinkedProfile({
  source: landscapeSource,
  controls: linkedControls,
  outputSize: 16,
  shape: "square",
  pageColor: [0, 0, 0],
});
const profileMiddle = (8 * 16 + 8) * 4;
const profileRight = (8 * 16 + 12) * 4;
const profileDown = (12 * 16 + 8) * 4;
const profileHorizontalSourceDelta = undistortedProfile.data[profileRight] - undistortedProfile.data[profileMiddle];
const profileVerticalSourceDelta = undistortedProfile.data[profileDown + 1] - undistortedProfile.data[profileMiddle + 1];
assert.ok(Math.abs(profileHorizontalSourceDelta - profileVerticalSourceDelta) <= 1,
  "the square profile crop must preserve the source aspect ratio");

const undistortedBanner = buildLinkedBanner({
  source: landscapeSource,
  mapping: { centerX: 15, centerY: 5, radiusX: 15, radiusY: 5 },
  controls: linkedControls,
  outputWidth: 30,
  outputHeight: 10,
  pageColor: [0, 0, 0],
});
const bannerMiddle = (5 * 30 + 15) * 4;
const bannerRight = (5 * 30 + 18) * 4;
const bannerDown = (8 * 30 + 15) * 4;
const bannerHorizontalSourceDelta = undistortedBanner.data[bannerRight] - undistortedBanner.data[bannerMiddle];
const bannerVerticalSourceDelta = undistortedBanner.data[bannerDown + 1] - undistortedBanner.data[bannerMiddle + 1];
assert.ok(Math.abs(bannerHorizontalSourceDelta - bannerVerticalSourceDelta) <= 1,
  "the 3:1 automatic banner crop must preserve the source aspect ratio");

const exactBoundaryBanner = buildLinkedBanner({
  source: landscapeSource,
  mapping: { centerX: 24, centerY: 8, radiusX: 8, radiusY: 8 },
  controls: linkedControls,
  outputWidth: 48,
  outputHeight: 16,
  pageColor: [0, 0, 0],
  sourceFrameAspect: 1,
  clampOutside: true,
});
for (const [x, y] of [[1, 8], [8, 1], [14, 8], [8, 14], [4, 4], [12, 12]]) {
  const profileIndex = (y * 16 + x) * 4;
  const boundaryIndex = (y * 48 + x + 16) * 4;
  assert.deepEqual(
    Array.from(undistortedProfile.data.slice(profileIndex, profileIndex + 4)),
    Array.from(exactBoundaryBanner.data.slice(boundaryIndex, boundaryIndex + 4)),
    `locked profile and aligned banner must use identical boundary coordinates at (${x}, ${y})`,
  );
}

const lineBanner = solid(200, 80, [0, 0, 0, 255]);
for (let y = 8; y < 80; y += 1) {
  const x = Math.round(100 - 0.5 * (79 - y));
  for (let offset = -2; offset <= 2; offset += 1) {
    const index = (y * lineBanner.width + x + offset) * 4;
    lineBanner.data.set([230, 35, 70, 255], index);
  }
}
const lineRect = { x: 0, y: 0, width: 200, height: 80 };
const lineAvatar = { centerX: 100, centerY: 80, outerRadius: 40, padding: 0 };
const detectedLines = detectBoundaryLines({ banner: lineBanner, bannerRect: lineRect, avatar: lineAvatar, sensitivity: 0.58 });
assert.ok(detectedLines.models.length > 0, "a straight feature crossing the banner boundary must be detected");
assert.ok(detectedLines.models.some((model) => Math.abs(model.slope - 0.5) < 0.35), "detected continuation must preserve line slope");
const continuedPixel = sampleBannerWithContinuation(lineBanner, 110, 99, detectedLines, [0, 0, 0, 255]);
assert.ok(continuedPixel[0] > 120 && continuedPixel[0] > continuedPixel[1] * 2, "the detected line must continue into the virtual lower canvas");
const primaryLineAvatar = buildAvatar({
  banner: lineBanner, portrait: null, outputSize: 64, bannerRect: lineRect, avatar: lineAvatar,
  mode: "banner", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls, continuation: detectedLines,
});
const compatibleLineAvatar = buildAvatar({
  banner: lineBanner, portrait: null, outputSize: 64, bannerRect: lineRect, avatar: lineAvatar,
  mode: "banner", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls, continuation: detectedLines,
  compatibility: {
    enabled: true, platform: "android", weight: 1, bannerRect: lineRect,
    avatar: { ...lineAvatar, centerX: 112 }, continuation: detectedLines,
  },
});
const directAndroidLineAvatar = buildAvatar({
  banner: lineBanner, portrait: null, outputSize: 64, bannerRect: lineRect,
  avatar: { ...lineAvatar, centerX: 112 },
  mode: "banner", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls, continuation: detectedLines,
});
assert.deepEqual(
  compatibleLineAvatar.data,
  directAndroidLineAvatar.data,
  "full Android priority must use one undistorted Android transform across the complete avatar",
);

const calibrated = calculateQuality({ diagnostics: resultB.diagnostics, calibrated: true, calibrationResidual: 0.8, mode: "portrait", portraitControls: controls });
assert.equal(calibrated.score, 100);
const preset = calculateQuality({ diagnostics: resultB.diagnostics, calibrated: false, mode: "portrait", portraitControls: controls });
assert.equal(preset.score, 86);
assert.match(preset.warnings[0].text, /best effort/i);

const fullExport = buildAvatar({
  banner: solid(300, 100, [40, 80, 120, 255]), portrait: solid(64, 64, [240, 10, 10, 255]), outputSize: 400,
  bannerRect, avatar, mode: "portrait", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls,
});
assert.equal(fullExport.data.length, 400 * 400 * 4, "the exact export renderer must produce 400 × 400 RGBA pixels");
assert.equal(fullExport.data[3], 255);

const compatibilityBanner = fineGradient(200, 100);
const primaryLayout = { centerX: 60, centerY: 50, outerRadius: 28, padding: 0 };
const androidLayout = { centerX: 82, centerY: 50, outerRadius: 28, padding: 0 };
const compatibilityRect = { x: 0, y: 0, width: 200, height: 100 };
const primaryOnly = buildAvatar({
  banner: compatibilityBanner, portrait: null, outputSize: 256, bannerRect: compatibilityRect,
  avatar: primaryLayout, mode: "banner", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls,
});
const explicitlyDisabled = buildAvatar({
  banner: compatibilityBanner, portrait: null, outputSize: 256, bannerRect: compatibilityRect,
  avatar: primaryLayout, mode: "banner", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls,
  compatibility: { enabled: false },
});
assert.deepEqual(explicitlyDisabled.data, primaryOnly.data, "default-off compatibility must not alter desktop output");
const fullAndroidWeight = buildAvatar({
  banner: compatibilityBanner, portrait: null, outputSize: 256, bannerRect: compatibilityRect,
  avatar: primaryLayout, mode: "banner", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls,
  compatibility: { enabled: true, platform: "android", weight: 1, bannerRect: compatibilityRect, avatar: androidLayout },
});
const androidOnly = buildAvatar({
  banner: compatibilityBanner, portrait: null, outputSize: 256, bannerRect: compatibilityRect,
  avatar: androidLayout, mode: "banner", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls,
});
assert.deepEqual(
  fullAndroidWeight.data,
  androidOnly.data,
  "full Android priority must be byte-identical to a direct Android affine render",
);
const halfAndroidWeight = buildAvatar({
  banner: compatibilityBanner, portrait: null, outputSize: 256, bannerRect: compatibilityRect,
  avatar: primaryLayout, mode: "banner", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls,
  compatibility: { enabled: true, platform: "android", weight: 0.5, bannerRect: compatibilityRect, avatar: androidLayout },
});
const midpointOnly = buildAvatar({
  banner: compatibilityBanner, portrait: null, outputSize: 256, bannerRect: compatibilityRect,
  avatar: { ...primaryLayout, centerX: 71 },
  mode: "banner", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls,
});
assert.deepEqual(
  halfAndroidWeight.data,
  midpointOnly.data,
  "a compatibility blend must remain one affine midpoint transform with no internal bending",
);
const primarySeam = calculateLayoutSeamScore({
  avatarImage: primaryOnly, banner: compatibilityBanner, bannerRect: compatibilityRect,
  avatar: primaryLayout, pageColor: [0, 0, 0], region: "visible-overlap",
});
assert.ok(primarySeam.score >= 90, "a layout scored against its own deterministic render must pass the export gate");
const androidSeamBefore = calculateLayoutSeamScore({
  avatarImage: primaryOnly, banner: compatibilityBanner, bannerRect: compatibilityRect,
  avatar: androidLayout, pageColor: [0, 0, 0], region: "visible-overlap",
});
const androidSeamAfter = calculateLayoutSeamScore({
  avatarImage: fullAndroidWeight, banner: compatibilityBanner, bannerRect: compatibilityRect,
  avatar: androidLayout, pageColor: [0, 0, 0], region: "visible-overlap",
});
assert.ok(
  androidSeamAfter.score > androidSeamBefore.score + 20,
  "full Android priority must materially improve the complete circular boundary",
);

const partialBanner = landmarkPattern(200, 100);
const partialLayout = { centerX: 82, centerY: 112, outerRadius: 42, padding: 0 };
const partialExact = buildAvatar({
  banner: partialBanner, portrait: null, outputSize: 400, bannerRect: compatibilityRect,
  avatar: partialLayout, mode: "banner", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls,
});
const partialWrong = buildAvatar({
  banner: partialBanner, portrait: null, outputSize: 400, bannerRect: compatibilityRect,
  avatar: { centerX: 122, centerY: 78, outerRadius: 52, padding: 0 },
  mode: "banner", shape: "circle", pageColor: [0, 0, 0], opaqueCorners: true,
  lockStart: 0.85, featherWidth: 0.2, portraitControls: controls,
});
const partialExactScore = calculateLayoutSeamScore({
  avatarImage: partialExact, banner: partialBanner, bannerRect: compatibilityRect,
  avatar: partialLayout, pageColor: [0, 0, 0], region: "visible-overlap",
});
const partialWrongScore = calculateLayoutSeamScore({
  avatarImage: partialWrong, banner: partialBanner, bannerRect: compatibilityRect,
  avatar: partialLayout, pageColor: [0, 0, 0], region: "visible-overlap",
});
assert.equal(partialExactScore.metric, "rendered-upload-visible-boundary-v3");
assert.ok(partialExactScore.visibleSampleFraction > 0 && partialExactScore.visibleSampleFraction < 0.5,
  "Android scoring must use only the circle arc that actually overlaps the banner");
assert.ok(partialExactScore.score >= 75 && partialExactScore.score > partialWrongScore.score + 30,
  "filter-aware visible scoring must distinguish an exact upload from a wrong crop");
assert.ok(partialWrongScore.score <= 70,
  "a differently positioned avatar must not receive a high Android score from hidden or flat regions");

const localizedFailure = {
  ...partialExact,
  data: new Uint8ClampedArray(partialExact.data),
};
for (let y = 0; y < localizedFailure.height * 0.28; y += 1) {
  for (let x = localizedFailure.width * 0.35; x < localizedFailure.width * 0.65; x += 1) {
    const index = (Math.floor(y) * localizedFailure.width + Math.floor(x)) * 4;
    localizedFailure.data[index] = 255;
    localizedFailure.data[index + 1] = 20;
    localizedFailure.data[index + 2] = 20;
  }
}
const localizedFailureScore = calculateLayoutSeamScore({
  avatarImage: localizedFailure, banner: partialBanner, bannerRect: compatibilityRect,
  avatar: partialLayout, pageColor: [0, 0, 0], region: "visible-overlap",
});
assert.ok(localizedFailureScore.score < partialExactScore.score - 10,
  "a localized duplicated-window-style failure must materially reduce the exact-artifact score");

console.log("Boundary Lock core tests passed");
