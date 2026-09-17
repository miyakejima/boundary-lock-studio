import {
  PRESETS,
  buildPairAwareFeatureBanner,
  buildAvatar,
  buildLinkedBanner,
  buildLinkedProfile,
  computeCoverTransform,
  detectBoundaryLines,
  geometryFromPreset,
  hexToRgb,
  optimizeSharedAffineMapping,
  sampleBilinear,
  sampleBannerWithContinuation,
  screenToSource,
  serializeProject,
  sourceMappingFromLayout,
} from "./core.js?v=4.5.0";

const dummyElement = {
  addEventListener: () => {},
  removeEventListener: () => {},
  classList: {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  },
  setAttribute: () => {},
  removeAttribute: () => {},
  getAttribute: () => null,
  style: {},
  dataset: {},
  querySelector: () => null,
  querySelectorAll: () => [],
  focus: () => {},
  blur: () => {},
  click: () => {},
  getContext: () => null,
};
const dummyHandler = {
  get(target, prop) {
    if (prop in target) return target[prop];
    return () => {};
  },
  set() {
    return true;
  }
};
const dummyProxy = new Proxy(dummyElement, dummyHandler);
const $ = (id) => document.getElementById(id) || dummyProxy;

const desktopCanvas = $("desktopCanvas");
const desktopContext = desktopCanvas.getContext("2d", { alpha: false });
const androidCanvas = $("androidCanvas");
const androidContext = androidCanvas.getContext("2d", { alpha: false });
const avatarCanvas = $("avatarCanvas");
const avatarContext = avatarCanvas.getContext("2d", { willReadFrequently: true });

const avatarPreviewBuffer = document.createElement("canvas");
avatarPreviewBuffer.width = 256;
avatarPreviewBuffer.height = 256;
const avatarPreviewContext = avatarPreviewBuffer.getContext("2d");

const state = {
  mode: "banner", // "banner" or "portrait"
  sourceBanner: null,
  banner: null,
  bannerName: "demo-banner.png",
  portrait: null,
  portraitName: "profile-source.png",
  lockedProfile: null,
  cropDraft: null,
  portraitControls: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    opacity: 1,
    contrast: 1,
    saturation: 1,
    blackLevel: 0,
  },
  linkedBannerDiagnostics: null,
  priority: "shared", // "shared", "mobile", "desktop"
  shape: "circle",
  theme: "dark",
  bannerRect: null,
  avatar: null,
  bannerTransform: {
    mirrorX: false,
    flipY: false,
    rotation: 0,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  },
  continuation: {
    enabled: true,
    sensitivity: 0.58,
    model: null,
    signature: "",
  },
  mobileCompatibility: {
    enabled: true,
    platform: "android",
    preset: PRESETS.androidApp,
    presetLayout: null,
    bannerRect: null,
    avatar: null,
    weight: 1,
    sourceMapping: null,
    continuation: { model: null, signature: "" },
    adjustedBanner: null,
    pairDiagnostics: null,
    // Crop-balance slider state
    androidMapping: null,    // pure android source mapping (weight=0)
    desktopMapping: null,    // pure desktop source mapping (weight=1)
    autoWeight: 0,           // weight the optimizer chose
    autoMapping: null,       // exact mapping the optimizer chose
    manualWeight: null,      // null = use autoWeight; 0-1 = user override
  },
  avatarResult: null,
};

function createDemoBanner() {
  const canvas = document.createElement("canvas");
  canvas.width = 1500;
  canvas.height = 500;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 1500, 500);
  gradient.addColorStop(0, "#06150f");
  gradient.addColorStop(0.45, "#102734");
  gradient.addColorStop(1, "#130b26");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1500, 500);
  context.globalAlpha = 0.24;
  context.strokeStyle = "#ffffff";
  context.lineWidth = 1;
  for (let x = -500; x < 1800; x += 70) {
    context.beginPath();
    context.moveTo(x, 500);
    context.lineTo(x + 500, 0);
    context.stroke();
  }
  context.globalAlpha = 1;
  context.strokeStyle = "#6cf0b7";
  context.lineWidth = 18;
  context.beginPath();
  context.arc(260, 510, 280, Math.PI * 1.08, Math.PI * 1.92);
  context.stroke();
  context.strokeStyle = "#7ca7ff";
  context.lineWidth = 7;
  context.beginPath();
  context.moveTo(0, 365);
  context.lineTo(700, 105);
  context.lineTo(1180, 360);
  context.stroke();
  context.fillStyle = "rgba(255,255,255,.7)";
  for (let i = 0; i < 120; i += 1) {
    const x = (i * 149) % 1500;
    const y = (i * i * 23) % 500;
    const radius = 1 + (i % 4);
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function imageDataCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  putRawImage(canvas.getContext("2d"), image);
  return canvas;
}

function defaultPortraitControls() {
  return {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    opacity: 1,
    contrast: 1,
    saturation: 1,
    blackLevel: 0,
  };
}

function profileCropPanLimits(scale = 1) {
  if (!state.portrait) return { x: 0, y: 0 };
  const aspect = state.portrait.width / Math.max(1, state.portrait.height);
  return aspect >= 1
    ? { x: Math.max(0, scale * aspect - 1), y: Math.max(0, scale - 1) }
    : { x: Math.max(0, scale - 1), y: Math.max(0, scale / aspect - 1) };
}

function renderProfileEditor() {
  if (!state.portrait || !state.cropDraft) return;
  const canvas = $("profileCropCanvas");
  const result = buildLinkedProfile({
    source: state.portrait,
    controls: state.cropDraft,
    outputSize: canvas.width,
    shape: "square",
    pageColor: [0, 0, 0],
    opaqueCorners: true,
  });
  putRawImage(canvas.getContext("2d"), result);
  window.__profileCropState = {
    scale: state.cropDraft.scale,
    offsetX: state.cropDraft.offsetX,
    offsetY: state.cropDraft.offsetY,
    panLimits: profileCropPanLimits(state.cropDraft.scale),
  };
  syncPortraitControlsUI();
}

function openProfileEditor({ reset = false } = {}) {
  if (!state.portrait) {
    $("portraitInput").click();
    return;
  }
  state.cropDraft = reset || !state.lockedProfile
    ? defaultPortraitControls()
    : { ...state.portraitControls };
  $("profileEditor").hidden = false;
  document.body.classList.add("profile-editor-open");
  renderProfileEditor();
}

function closeProfileEditor() {
  $("profileEditor").hidden = true;
  document.body.classList.remove("profile-editor-open");
  state.cropDraft = null;
}

function applyLockedProfile() {
  if (!state.portrait || !state.cropDraft) return;
  state.portraitControls = { ...state.cropDraft };
  state.lockedProfile = buildLinkedProfile({
    source: state.portrait,
    controls: state.portraitControls,
    outputSize: 400,
    shape: "square",
    pageColor: hexToRgb(pageColor()),
    opaqueCorners: true,
  });
  closeProfileEditor();
  state.mode = "portrait";
  state.priority = "desktop";
  const desktopPriority = document.querySelector('input[name="priority"][value="desktop"]');
  if (desktopPriority) desktopPriority.checked = true;
  state.mobileCompatibility.manualWeight = null;
  rebuildLinkedBanner();
  updateWorkflowUI();
  scheduleRender();
  toast("Profile picture set and locked · banner generated");
}

function linkedPlatformMappings() {
  const output = { width: 1500, height: 500 };
  const desktopMapping = sourceMappingFromLayout({
    banner: output,
    bannerRect: state.bannerRect,
    avatar: state.avatar,
  });
  const android = androidPresetLayout();
  const androidMapping = sourceMappingFromLayout({
    banner: output,
    bannerRect: android.bannerRect,
    avatar: android.avatar,
  });
  return { androidMapping, desktopMapping };
}

function linkedBannerMapping() {
  const mobile = state.mobileCompatibility;
  const { androidMapping, desktopMapping } = linkedPlatformMappings();
  mobile.androidMapping = androidMapping;
  mobile.desktopMapping = desktopMapping;
  mobile.autoWeight = 0.5;
  mobile.autoMapping = interpolateSourceMappings(androidMapping, desktopMapping, 0.5);

  if (state.priority === "mobile") return androidMapping;
  if (state.priority === "desktop") return desktopMapping;
  const weight = mobile.manualWeight ?? mobile.autoWeight;
  return interpolateSourceMappings(androidMapping, desktopMapping, weight);
}

function rebuildLinkedBanner() {
  if (!state.portrait || !state.lockedProfile || !state.bannerRect || !state.avatar) return false;
  const alignmentMapping = linkedBannerMapping();
  const result = buildLinkedBanner({
    source: state.portrait,
    mapping: alignmentMapping,
    controls: state.portraitControls,
    outputWidth: 1500,
    outputHeight: 500,
    pageColor: hexToRgb(pageColor()),
    sourceFrameAspect: 1,
    clampOutside: false,
  });
  state.banner = result;
  state.linkedBannerDiagnostics = result.diagnostics;
  state.mobileCompatibility.sourceMapping = result.diagnostics.mapping;
  state.mobileCompatibility.adjustedBanner = result;
  state.mobileCompatibility.pairDiagnostics = {
    mode: "profile-driven-full-banner",
    mapping: result.diagnostics.mapping,
    uncoveredFraction: result.diagnostics.uncoveredFraction,
  };
  state.continuation.signature = "";
  state.mobileCompatibility.continuation.signature = "";
  updateLinkedCoverageStatus();
  return true;
}

function rebuildActiveBanner() {
  if (state.mode === "portrait") {
    rebuildLinkedBanner();
    return;
  }
  state.linkedBannerDiagnostics = null;
  state.banner = renderWorkingBanner();
  autoBalanceAndroidCompatibility();
}

function activeAvatarResult(outputSize) {
  if (state.mode === "portrait" && state.lockedProfile) {
    if (outputSize === state.lockedProfile.width) return state.lockedProfile;
    const canvas = imageDataCanvas(state.lockedProfile);
    const resized = document.createElement("canvas");
    resized.width = outputSize;
    resized.height = outputSize;
    resized.getContext("2d").drawImage(canvas, 0, 0, outputSize, outputSize);
    return resized.getContext("2d").getImageData(0, 0, outputSize, outputSize);
  }
  return buildAvatar(avatarBuildOptions(outputSize));
}

function bannerTransformIsActive() {
  const transform = state.bannerTransform;
  return transform.mirrorX
    || transform.flipY
    || (transform.rotation || 0) !== 0
    || Math.abs(transform.zoom - 1) > 0.001
    || Math.abs(transform.offsetX) > 0.5
    || Math.abs(transform.offsetY) > 0.5;
}

// Linearly interpolates between the two platform source mappings.
// weight=0 → android-exact, weight=1 → desktop-exact.
function interpolateSourceMappings(androidMapping, desktopMapping, weight) {
  const w = Math.min(1, Math.max(0, weight));
  return {
    centerX: androidMapping.centerX * (1 - w) + desktopMapping.centerX * w,
    centerY: androidMapping.centerY * (1 - w) + desktopMapping.centerY * w,
    radiusX: androidMapping.radiusX * (1 - w) + desktopMapping.radiusX * w,
    radiusY: androidMapping.radiusY * (1 - w) + desktopMapping.radiusY * w,
  };
}

function bannerTransformSignature() {
  const transform = state.bannerTransform;
  return [
    transform.mirrorX ? "mx" : "no-mx",
    transform.flipY ? "fy" : "no-fy",
    `r${transform.rotation || 0}`,
    transform.zoom.toFixed(3),
    Math.round(transform.offsetX),
    Math.round(transform.offsetY),
  ].join(":");
}

function rotationQuarterTurn() {
  const rotation = ((state.bannerTransform.rotation || 0) % 360 + 360) % 360;
  return rotation === 90 || rotation === 270;
}

function bannerBaseScale() {
  if (!state.sourceBanner) return 1;
  if (!rotationQuarterTurn()) return 1;
  return Math.max(
    state.sourceBanner.width / state.sourceBanner.height,
    state.sourceBanner.height / state.sourceBanner.width,
  );
}

function bannerRenderedBounds(zoom = state.bannerTransform.zoom) {
  if (!state.sourceBanner) return { width: 0, height: 0 };
  const scale = bannerBaseScale() * zoom;
  return rotationQuarterTurn()
    ? { width: state.sourceBanner.height * scale, height: state.sourceBanner.width * scale }
    : { width: state.sourceBanner.width * scale, height: state.sourceBanner.height * scale };
}

function bannerPanLimits(zoom = state.bannerTransform.zoom) {
  if (!state.sourceBanner) return { x: 0, y: 0 };
  const bounds = bannerRenderedBounds(zoom);
  return {
    x: Math.max(0, (bounds.width - state.sourceBanner.width) / 2),
    y: Math.max(0, (bounds.height - state.sourceBanner.height) / 2),
  };
}

function zoomNeededForOffset(offsetX, offsetY) {
  if (!state.sourceBanner) return 1;
  let low = 1;
  let high = 4;
  for (let i = 0; i < 20; i += 1) {
    const mid = (low + high) / 2;
    const limits = bannerPanLimits(mid);
    if (Math.abs(offsetX) <= limits.x + 0.5 && Math.abs(offsetY) <= limits.y + 0.5) high = mid;
    else low = mid;
  }
  return high;
}

function normalizeBannerTransform({ allowAutoZoom = false } = {}) {
  const transform = state.bannerTransform;
  transform.rotation = ((transform.rotation || 0) % 360 + 360) % 360;
  transform.zoom = Math.min(4, Math.max(1, transform.zoom));
  if (!state.sourceBanner) {
    transform.offsetX = 0;
    transform.offsetY = 0;
    return;
  }
  if (allowAutoZoom) {
    transform.zoom = Math.min(4, Math.max(transform.zoom, zoomNeededForOffset(transform.offsetX, transform.offsetY)));
  }
  const limits = bannerPanLimits(transform.zoom);
  transform.offsetX = Math.min(limits.x, Math.max(-limits.x, transform.offsetX));
  transform.offsetY = Math.min(limits.y, Math.max(-limits.y, transform.offsetY));
}

function renderWorkingBanner(options = {}) {
  const source = state.sourceBanner;
  if (!source) return null;
  normalizeBannerTransform(options);
  if (!bannerTransformIsActive()) {
    return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  }
  const sourceCanvas = imageDataCanvas(source);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.save();
  context.translate(canvas.width / 2 + state.bannerTransform.offsetX, canvas.height / 2 + state.bannerTransform.offsetY);
  context.rotate(((state.bannerTransform.rotation || 0) * Math.PI) / 180);
  const baseScale = bannerBaseScale();
  context.scale(
    (state.bannerTransform.mirrorX ? -1 : 1) * baseScale * state.bannerTransform.zoom,
    (state.bannerTransform.flipY ? -1 : 1) * baseScale * state.bannerTransform.zoom,
  );
  context.drawImage(sourceCanvas, -source.width / 2, -source.height / 2);
  context.restore();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function transformedBannerFilename() {
  if (state.mode === "portrait") {
    const base = state.portraitName.replace(/\.[^.]+$/, "") || "profile";
    return `${base}-banner.png`;
  }
  const base = state.bannerName.replace(/\.[^.]+$/, "") || "banner";
  return (bannerTransformIsActive() || state.mobileCompatibility.adjustedBanner)
    ? `${base}-adjusted-banner.png`
    : `${base}-banner.png`;
}

function displayedBanner() {
  // Best-shared no longer modifies the banner — both platforms always see the
  // same original image. The adjusted-banner path has been retired because the
  // Desktop ring paint zone is visible in the Android preview and creates
  // double-image / ghost-circle artefacts that are worse than the original seam.
  return state.banner;
}

function updateBannerToolStatus() {
  const transform = state.bannerTransform;
  if (state.mode === "portrait") {
    $("bannerTransformStatus").textContent = state.lockedProfile
      ? "Profile is locked · only the automatic banner changes"
      : "Select and apply a profile picture first";
    $("mirrorBanner").classList.remove("active");
    $("flipBanner").classList.remove("active");
    $("rotateBanner").classList.remove("active");
    $("rotateBanner").textContent = "Rotate 0°";
    $("bannerZoomInput").value = "100";
    return;
  }
  const transformed = bannerTransformIsActive();
  const pairAware = state.priority === "shared" && Boolean(state.mobileCompatibility.adjustedBanner);
  const active = transformed || pairAware;
  const parts = [];
  if (transform.mirrorX) parts.push("mirrored");
  if (transform.flipY) parts.push("flipped");
  if ((transform.rotation || 0) !== 0) parts.push(`rotated ${transform.rotation}°`);
  if (Math.abs(transform.zoom - 1) > 0.001) parts.push(`zoom ${Math.round(transform.zoom * 100)}%`);
  if (Math.abs(transform.offsetX) > 0.5 || Math.abs(transform.offsetY) > 0.5) {
    parts.push(`move ${Math.round(transform.offsetX)}px, ${Math.round(transform.offsetY)}px`);
  }
  const pairMessage = pairAware
    ? "Best-shared compromise mapping active"
    : "";
  const transformMessage = transformed ? parts.join(" · ") : "";
  $("bannerTransformStatus").textContent = active
      ? `${[transformMessage, pairMessage].filter(Boolean).join(" · ")} · export adjusted banner with avatar`
      : "Original banner · avatar only export is enough";
  $("mirrorBanner").classList.toggle("active", transform.mirrorX);
  $("flipBanner").classList.toggle("active", transform.flipY);
  $("rotateBanner").classList.toggle("active", (transform.rotation || 0) !== 0);
  $("rotateBanner").textContent = `Rotate ${transform.rotation || 0}°`;
  $("bannerZoomInput").value = String(Math.round(transform.zoom * 100));
  
  $("adjustedBannerExportWrapper").style.display = "block";
  $("exportBanner").disabled = false;
}

function syncPortraitControlsUI() {
  const slider = $("profileCropZoom");
  if (slider) slider.value = String(Math.round((state.cropDraft?.scale ?? state.portraitControls.scale) * 100));
}

function updateLinkedCoverageStatus() {
  const element = $("linkedCoverageStatus");
  if (!element) return;
  if (!state.lockedProfile) {
    element.className = "coverage-status";
    element.textContent = "The profile remains unchanged after you press Apply";
    return;
  }
  if (state.linkedBannerDiagnostics?.mode === "locked-profile-boundary-alignment") {
    const target = state.priority === "mobile" ? "Android" : state.priority === "shared" ? "shared Desktop/Android" : "Desktop";
    element.className = "coverage-status ok";
    element.textContent = `Profile locked · banner boundary aligned for ${target}`;
    return;
  }
  const bannerGap = state.linkedBannerDiagnostics?.uncoveredFraction ?? 0;
  const gap = bannerGap;
  if (gap <= 0.0005) {
    element.className = "coverage-status ok";
    element.textContent = "Profile locked · automatic banner has full source coverage";
  } else {
    element.className = "coverage-status warn";
    element.textContent = `Profile locked · ${(gap * 100).toFixed(1)}% of the banner falls outside the source`;
  }
}

function updateWorkflowUI() {
  const portraitMode = state.mode === "portrait";
  $("modeBanner").classList.toggle("active", !portraitMode);
  $("modePortrait").classList.toggle("active", portraitMode);
  $("portraitControls").classList.toggle("disabled-section", !portraitMode && !state.portrait);
  $("prioritySection").hidden = portraitMode && !state.lockedProfile;
  $("continuationSection").hidden = portraitMode;
  $("exportAvatar").disabled = portraitMode && !state.lockedProfile;
  $("exportBanner").disabled = portraitMode && !state.lockedProfile;
  $("exportBothDirect").disabled = portraitMode && !state.lockedProfile;
  $("exportAvatar").textContent = portraitMode ? "Export locked profile PNG" : "Export avatar PNG";
  $("exportBanner").textContent = portraitMode ? "Export automatic banner PNG" : "Export adjusted banner PNG";
  $("exportHint").textContent = portraitMode
    ? "Upload this banner together with the locked profile PNG on X."
    : "Upload the adjusted banner PNG together with the avatar for Best shared alignment.";
  $("sharedWarning").innerHTML = portraitMode
    ? "<strong>Profile locked:</strong> the accepted profile never changes. Only the automatic banner responds to the selected X layout."
    : "<strong>Best shared:</strong> uses one compromise avatar crop for the two X layouts.";

  const disabled = portraitMode;
  for (const id of [
    "mirrorBanner", "flipBanner", "rotateBanner", "resetBannerTools",
    "nudgeBannerLeft", "nudgeBannerUp", "nudgeBannerDown", "nudgeBannerRight",
    "zoomBannerOut", "zoomBannerIn", "bannerZoomInput",
  ]) $(id).disabled = disabled;
  const indicator = $("profileSetIndicator");
  indicator.classList.toggle("ready", Boolean(state.lockedProfile));
  indicator.textContent = state.lockedProfile ? "Profile picture set and locked" : "No profile picture set";
  $("profileSetHelp").textContent = state.lockedProfile
    ? "This exact 400 × 400 profile is locked. Editing it opens the crop window again; layout changes affect only the banner."
    : "Select an image. A familiar crop window will let you drag and zoom it before anything is applied.";
  $("editProfilePicture").textContent = state.lockedProfile ? "Edit profile picture" : "Select profile picture";
  updateBannerToolStatus();
  updateSharedModeSlider();
  updateLinkedCoverageStatus();
}

function setMode(mode) {
  if (mode === "portrait" && !state.lockedProfile) {
    openProfileEditor();
    return;
  }
  state.mode = mode === "portrait" ? "portrait" : "banner";
  state.mobileCompatibility.manualWeight = null;
  rebuildActiveBanner();
  updateWorkflowUI();
  scheduleRender();
}

function applyPortraitControls() {
  if (state.mode === "portrait") rebuildLinkedBanner();
  syncPortraitControlsUI();
  scheduleRender();
}

function bindPortraitRange(id, transform, setter) {
  $(id).addEventListener("input", (event) => {
    setter(transform(Number(event.target.value)));
    applyPortraitControls();
  });
}

function defaultFrame() {
  return { width: 1200, height: 760, bannerRect: { x: 80, y: 70, width: 1040, height: 1040 / PRESETS.desktop.frameAspect } };
}

function resetPresetGeometry() {
  const frame = defaultFrame();
  state.bannerRect = frame.bannerRect;
  state.avatar = geometryFromPreset(PRESETS.desktop, state.bannerRect, 100);
}

function androidPresetLayout() {
  const preset = PRESETS.androidApp;
  const width = 914;
  const bannerRect = { x: 0, y: 0, width, height: width / preset.frameAspect };
  const avatar = geometryFromPreset(preset, bannerRect, 100);
  return { bannerRect, avatar };
}

function pageColor() {
  return state.theme === "light" ? "#ffffff" : "#000000";
}

function continuationSignatureFor(rect, avatar, label) {
  const banner = displayedBanner();
  if (!banner) return "";
  return [
    label,
    state.bannerName,
    bannerTransformSignature(),
    banner.width,
    banner.height,
    state.priority === "shared" && state.mobileCompatibility.adjustedBanner ? "pair-aware" : "base",
    rect.x, rect.y, rect.width, rect.height,
    avatar.centerX, avatar.centerY, avatar.outerRadius, avatar.padding,
    0.58, // sensitivity
  ].join("|");
}

function ensureContinuationModel() {
  if (!state.banner) return null;
  if (!state.continuation.enabled) return null;
  const signature = continuationSignatureFor(state.bannerRect, state.avatar, "primary");
  if (signature !== state.continuation.signature || !state.continuation.model) {
    state.continuation.model = detectBoundaryLines({
      banner: displayedBanner(),
      bannerRect: state.bannerRect,
      avatar: state.avatar,
      sensitivity: state.continuation.sensitivity,
    });
    state.continuation.signature = signature;
  }
  return state.continuation.model;
}

function ensureAndroidContinuationModel() {
  if (!state.banner) return null;
  if (!state.continuation.enabled) return null;
  const layout = androidPresetLayout();
  const signature = continuationSignatureFor(layout.bannerRect, layout.avatar, "android");
  if (signature !== state.mobileCompatibility.continuation.signature || !state.mobileCompatibility.continuation.model) {
    state.mobileCompatibility.continuation.model = detectBoundaryLines({
      banner: displayedBanner(),
      bannerRect: layout.bannerRect,
      avatar: layout.avatar,
      sensitivity: state.continuation.sensitivity,
    });
    state.mobileCompatibility.continuation.signature = signature;
  }
  return state.mobileCompatibility.continuation.model;
}

function putRawImage(context, image) {
  context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
}

function drawAvatarPreview(image) {
  avatarPreviewBuffer.width = image.width;
  avatarPreviewBuffer.height = image.height;
  putRawImage(avatarPreviewContext, image);
  avatarContext.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
  avatarContext.imageSmoothingEnabled = true;
  avatarContext.imageSmoothingQuality = "high";
  avatarContext.drawImage(avatarPreviewBuffer, 0, 0, avatarCanvas.width, avatarCanvas.height);
}

function roundedPath(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function shapePath(context, x, y, size, shape) {
  if (shape === "rounded") roundedPath(context, x, y, size, size, size * 0.08);
  else {
    context.beginPath();
    context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    context.closePath();
  }
}

function drawCover(context, image, rect) {
  const transform = computeCoverTransform(image.width, image.height, rect);
  const temp = imageDataCanvas(image);
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  context.drawImage(temp, transform.translateX, transform.translateY, image.width * transform.scaleX, image.height * transform.scaleY);
  context.restore();
}

function drawAvatarOverlay(context, geometry) {
  const { centerX, centerY, outerRadius, padding } = geometry;
  const borderWidth = Math.max(0, geometry.borderWidth ?? padding ?? 0);
  const outerSize = outerRadius * 2;
  const imageRadius = Math.max(1, outerRadius - padding);
  context.save();
  shapePath(context, centerX - outerRadius, centerY - outerRadius, outerSize, state.shape);
  context.fillStyle = pageColor();
  context.fill();
  const imageSize = imageRadius * 2;
  shapePath(context, centerX - imageRadius, centerY - imageRadius, imageSize, state.shape);
  context.clip();
  context.drawImage(avatarCanvas, centerX - imageRadius, centerY - imageRadius, imageSize, imageSize);
  context.restore();
  if (borderWidth > 0 && padding === 0) {
    context.save();
    shapePath(context, centerX - outerRadius, centerY - outerRadius, outerSize, state.shape);
    context.clip();
    context.lineWidth = borderWidth * 2;
    context.strokeStyle = pageColor();
    context.stroke();
    context.restore();
  }
  context.save();
  shapePath(context, centerX - outerRadius, centerY - outerRadius, outerSize, state.shape);
  context.setLineDash([7, 7]);
  context.lineWidth = Math.max(1, outerRadius / 70);
  context.strokeStyle = "rgba(108,240,183,.72)";
  context.stroke();
  context.restore();
}

function renderDesktopPreview() {
  const context = desktopContext;
  const width = desktopCanvas.width;
  const height = desktopCanvas.height;
  
  context.fillStyle = pageColor();
  context.fillRect(0, 0, width, height);
  
  context.fillStyle = state.theme === "light" ? "#e7eaec" : "#24282c";
  context.fillRect(state.bannerRect.x, state.bannerRect.y - 38, state.bannerRect.width, 37);
  
  context.fillStyle = state.theme === "light" ? "#101418" : "#e9edf0";
  context.font = `700 ${Math.max(12, state.bannerRect.width / 55)}px system-ui`;
  context.fillText("headerlock", state.bannerRect.x + 54, state.bannerRect.y - 14);
  
  context.fillStyle = state.theme === "light" ? "#171a1d" : "#edf1f3";
  context.font = `800 ${Math.max(15, state.bannerRect.width / 42)}px system-ui`;
  context.fillText("Your profile", state.bannerRect.x + 24, state.bannerRect.y + state.bannerRect.height + state.avatar.outerRadius + 46);
  
  context.fillStyle = "#8c969f";
  context.font = `500 ${Math.max(11, state.bannerRect.width / 65)}px system-ui`;
  context.fillText("@yourhandle · desktop layout", state.bannerRect.x + 24, state.bannerRect.y + state.bannerRect.height + state.avatar.outerRadius + 75);
  
  context.strokeStyle = state.theme === "light" ? "#e1e5e8" : "#20252a";
  context.beginPath();
  context.moveTo(state.bannerRect.x, state.bannerRect.y + state.bannerRect.height + state.avatar.outerRadius + 108);
  context.lineTo(state.bannerRect.x + state.bannerRect.width, state.bannerRect.y + state.bannerRect.height + state.avatar.outerRadius + 108);
  context.stroke();
  
  drawCover(context, displayedBanner(), state.bannerRect);
  drawAvatarOverlay(context, state.avatar);
}

function renderAndroidPreview() {
  const context = androidContext;
  const width = androidCanvas.width;
  const height = androidCanvas.height;
  const layout = androidPresetLayout();
  
  context.fillStyle = "#000000";
  context.fillRect(0, 0, width, height);
  drawCover(context, state.banner, layout.bannerRect);

  context.save();
  context.fillStyle = "rgba(0,0,0,.18)";
  context.fillRect(0, 0, width, Math.max(86, width * 0.095));
  context.fillStyle = "#f5f8fa";
  context.font = `800 ${Math.max(30, width * 0.045)}px system-ui`;
  context.fillText("‹", width * 0.06, layout.bannerRect.y + width * 0.2);
  context.font = `800 ${Math.max(24, width * 0.036)}px system-ui`;
  context.fillText("⌕", width * 0.68, layout.bannerRect.y + width * 0.2);
  context.fillText("✎", width * 0.8, layout.bannerRect.y + width * 0.2);
  context.fillText("⋯", width * 0.91, layout.bannerRect.y + width * 0.2);

  const nameY = layout.bannerRect.y + layout.bannerRect.height + layout.avatar.outerRadius * 2.1;
  context.fillStyle = "#f5f8fa";
  context.font = `900 ${Math.max(30, width * 0.038)}px system-ui`;
  context.fillText("Your profile", width * 0.03, nameY);
  context.fillStyle = "#8b98a5";
  context.font = `600 ${Math.max(22, width * 0.028)}px system-ui`;
  context.fillText("@yourhandle", width * 0.03, nameY + width * 0.055);
  context.fillStyle = "#1d9bf0";
  context.fillText("mobile app layout", width * 0.03, nameY + width * 0.12);
  context.strokeStyle = "#e7e9ea";
  context.lineWidth = Math.max(3, width * 0.004);
  context.beginPath();
  context.moveTo(0, height - width * 0.012);
  context.lineTo(width * 0.29, height - width * 0.012);
  context.stroke();
  context.restore();
  
  drawAvatarOverlay(context, layout.avatar);
}

function autoBalanceAndroidCompatibility() {
  if (state.mode === "portrait") return;
  const mobile = state.mobileCompatibility;
  mobile.adjustedBanner = null;
  mobile.pairDiagnostics = null;
  mobile.sourceMapping = null;
  state.continuation.signature = "";
  mobile.continuation.signature = "";

  if (state.priority !== "shared" || !state.banner) return;

  const layout = androidPresetLayout();
  const primaryMapping = sourceMappingFromLayout({
    banner: state.banner,
    bannerRect: state.bannerRect,
    avatar: state.avatar,
  });
  const secondaryMapping = sourceMappingFromLayout({
    banner: state.banner,
    bannerRect: layout.bannerRect,
    avatar: layout.avatar,
  });

  // Find the avatar source mapping that minimises the worst-case seam across
  // both Desktop and Android. This is a pure compromise on the AVATAR CROP —
  // the banner is never modified, so neither platform sees paint artefacts.
  //
  // Why we no longer paint the banner:
  //   The Desktop ring seam zone (pixels just outside the Desktop avatar
  //   boundary) is geometrically above the Android avatar — those pixels are
  //   always visible in the Android banner background. Painting them with
  //   Android-sourced content creates a ghost circle artefact in the Android
  //   preview that is far more visually damaging than the original seam.
  //
  // Primary = Android (secondaryMapping), Secondary = Desktop (primaryMapping):
  //   The optimizer's integrityFloor fallback protects the PRIMARY platform.
  //   When no balanced compromise exists, it returns weight=0 = Android-exact.
  //   This matches the user's expectation: Android is always at least as good
  //   as mobile-perfect; Desktop gains whatever the image allows.
  const result = optimizeSharedAffineMapping({
    banner: state.banner,
    primaryMapping: secondaryMapping,   // Android is primary (protected by fallback)
    secondaryMapping: primaryMapping,   // Desktop is secondary
    continuation: null, // fast path, continuation not critical for mapping search
    pageColor: hexToRgb(pageColor()),
  });

  // Store raw endpoint mappings for the slider to interpolate between.
  // Android = weight 0, Desktop = weight 1 (matches optimizer's orientation
  // where primary=android, secondary=desktop).
  mobile.androidMapping = secondaryMapping;  // android-exact (weight 0)
  mobile.desktopMapping = primaryMapping;    // desktop-exact (weight 1)
  mobile.autoWeight     = result.equivalentWeight;
  mobile.autoMapping    = result.mapping;

  // Apply the active weight: manual override if set, otherwise optimizer choice.
  if (mobile.manualWeight !== null) {
    mobile.sourceMapping = interpolateSourceMappings(mobile.androidMapping, mobile.desktopMapping, mobile.manualWeight);
  } else {
    mobile.sourceMapping = result.mapping;
  }

  mobile.pairDiagnostics = {
    weight: mobile.manualWeight !== null ? mobile.manualWeight : result.equivalentWeight,
    primaryScore: result.primaryScore,
    secondaryScore: result.secondaryScore,
    worstMean: result.worstMean,
    feasible: result.feasible,
    geometryConflict: result.geometryConflict,
  };
}

let renderQueued = false;

function avatarBuildOptions(outputSize) {
  const isDesktopPriority = state.priority === "desktop";
  const layout = isDesktopPriority ? { bannerRect: state.bannerRect, avatar: state.avatar } : androidPresetLayout();
  const continuationModel = isDesktopPriority ? ensureContinuationModel() : ensureAndroidContinuationModel();
  const continuation = state.continuation.enabled && continuationModel ? continuationModel : null;

  // In shared mode we use the compromise sourceMapping found by optimizeSharedAffineMapping.
  // The avatar is always built from the ORIGINAL banner — no adjusted banner involved.
  // The compatibility block instructs buildAvatar to sample from sourceMapping instead of
  // the layout-derived screen position, giving the closest possible seam on both platforms.
  const sharedSourceMapping = state.priority === "shared"
    ? (state.mobileCompatibility.sourceMapping || null)
    : null;

  return {
    banner: state.banner,
    portrait: null,
    outputSize,
    bannerRect: layout.bannerRect,
    avatar: layout.avatar,
    mode: "banner",
    shape: state.shape,
    pageColor: hexToRgb(pageColor()),
    opaqueCorners: true,
    lockStart: 0.85,
    featherWidth: 0.2,
    portraitControls: null,
    continuation,
    compatibility: sharedSourceMapping
      ? {
          enabled: true,
          bannerRect: layout.bannerRect,
          avatar: layout.avatar,
          sourceMapping: sharedSourceMapping,
          continuation,
        }
      : { enabled: false },
  };
}

function updateSharedModeSlider() {
  const isShared = state.priority === "shared";
  $("cropBalanceSection").style.display = isShared ? "block" : "none";
  if (!isShared) return;

  const mobile = state.mobileCompatibility;
  const isManual = mobile.manualWeight !== null;
  const displayWeight = isManual ? mobile.manualWeight : mobile.autoWeight;

  // Sync slider thumb position
  $("cropBalanceSlider").value = String(Math.round(displayWeight * 100));

  // Position the auto-marker along the track.
  // The range input's usable track is inset by the thumb radius (~9px each side).
  // We approximate with CSS calc to avoid JS layout reads.
  const autoPercent = (mobile.autoWeight * 100).toFixed(2);
  const marker = $("autoWeightMarker");
  marker.style.left = `calc(9px + ${autoPercent}% * (100% - 18px) / 100)`;

  // Update value label
  const pct = Math.round(displayWeight * 100);
  if (isManual) {
    const side = pct < 50 ? `${100 - pct}% android` : pct === 50 ? "50/50" : `${pct}% desktop`;
    $("cropBalanceValue").textContent = `Manual · ${side}`;
    $("cropBalanceValue").style.color = "var(--accent-2)";
  } else {
    const autoSide = Math.round(mobile.autoWeight * 100);
    $("cropBalanceValue").textContent = `Auto · ${autoSide}% desktop`;
    $("cropBalanceValue").style.color = "var(--accent)";
  }

  // Show/hide reset button
  $("resetCropBalance").style.display = isManual ? "inline-block" : "none";
}

function updateContinuationStatus() {
  if (state.mode === "portrait") return;
  const enabled = state.continuation.enabled;
  const toggle = $("continuationToggle");
  const sensitivitySlider = $("continuationSensitivity");
  const sensitivityValue = $("continuationSensValue");
  const statusEl = $("continuationStatus");
  const statusDot = $("continuationStatusDot");

  if (toggle) toggle.checked = enabled;
  if (sensitivitySlider) {
    sensitivitySlider.disabled = !enabled;
    sensitivitySlider.value = String(Math.round(state.continuation.sensitivity * 100));
  }
  if (sensitivityValue) {
    sensitivityValue.textContent = Math.round(state.continuation.sensitivity * 100) + "%";
    sensitivityValue.style.color = enabled ? "var(--accent)" : "var(--muted)";
  }

  if (!statusEl || !statusDot) return;
  if (!enabled) {
    statusDot.className = "cont-dot off";
    statusEl.textContent = "Off — using page background fill";
    return;
  }

  // Get the active model (whichever platform is primary)
  const isDesktopPriority = state.priority === "desktop";
  const model = isDesktopPriority
    ? state.continuation.model
    : state.mobileCompatibility.continuation.model;

  if (!model) {
    statusDot.className = "cont-dot idle";
    statusEl.textContent = "Waiting for banner…";
    return;
  }
  const depth = Math.round(model.extensionDepth);
  if (depth < 1) {
    statusDot.className = "cont-dot idle";
    statusEl.textContent = "Not needed — avatar fully inside banner";
    return;
  }
  const count = model.models?.length || 0;
  if (count === 0) {
    statusDot.className = "cont-dot warn";
    statusEl.textContent = `Extending ${depth}px — no features found, extending edge pixels`;
    return;
  }
  const lineWord = count === 1 ? "line" : "lines";
  statusDot.className = "cont-dot active";
  statusEl.textContent = `${count} ${lineWord} detected · extending ${depth}px`;
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  window.setTimeout(() => {
    renderQueued = false;
    
    // Render the avatar image first
    state.avatarResult = activeAvatarResult(400);
    drawAvatarPreview(state.avatarResult);
    
    // Render previews
    renderDesktopPreview();
    renderAndroidPreview();
    
    updateBannerToolStatus();
    updateSharedModeSlider();
    updateContinuationStatus();
    updateLinkedCoverageStatus();
    
    window.__boundaryLockState = {
      mode: state.mode,
      profileLocked: Boolean(state.lockedProfile),
      priority: state.priority,
      banner: [displayedBanner().width, displayedBanner().height],
      bannerTransform: {
        active: bannerTransformIsActive(),
        ...state.bannerTransform,
        signature: bannerTransformSignature(),
      },
      previewOutput: [state.avatarResult.width, state.avatarResult.height],
      exportOutput: [400, 400],
      diagnostics: state.avatarResult.diagnostics,
      linkedBanner: state.mode === "portrait" ? state.linkedBannerDiagnostics : null,
      desktopLayout: { bannerRect: state.bannerRect, avatar: state.avatar },
      androidCompatibility: {
        enabled: state.priority !== "desktop",
        priority: state.priority,
        layout: androidPresetLayout(),
        sourceMapping: state.mobileCompatibility.sourceMapping,
        pairAware: Boolean(state.mobileCompatibility.adjustedBanner),
        pairDiagnostics: state.mobileCompatibility.pairDiagnostics,
      },
    };
  }, 0);
}

async function imageDataFromFile(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove("show"), 2200);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function nudgeStep() {
  return Math.max(8, Math.round((state.sourceBanner?.width || 1500) * 0.018));
}

function ensurePanRoom() {
  if (state.bannerTransform.zoom <= 1.001) state.bannerTransform.zoom = 1.08;
}

function nudgeBanner(dx, dy) {
  state.bannerTransform.offsetX += dx;
  state.bannerTransform.offsetY += dy;
  applyBannerTransform();
}

function setBannerZoomPercent(percent, anchor = null) {
  const transform = state.bannerTransform;
  const oldZoom = transform.zoom;
  const nextZoom = Math.min(4, Math.max(1, percent / 100));
  if (anchor && oldZoom > 0) {
    const ratio = nextZoom / oldZoom;
    const centerX = (state.sourceBanner?.width || 1500) / 2;
    const centerY = (state.sourceBanner?.height || 500) / 2;
    transform.offsetX = anchor.x - centerX - (anchor.x - centerX - transform.offsetX) * ratio;
    transform.offsetY = anchor.y - centerY - (anchor.y - centerY - transform.offsetY) * ratio;
  }
  transform.zoom = nextZoom;
  applyBannerTransform();
}

function applyBannerTransform() {
  if (state.mode === "portrait") {
    rebuildLinkedBanner();
    scheduleRender();
    return;
  }
  state.banner = renderWorkingBanner();
  state.continuation.signature = "";
  state.mobileCompatibility.continuation.signature = "";
  autoBalanceAndroidCompatibility();
  updateBannerToolStatus();
  scheduleRender();
}

function resetBannerTransform() {
  state.bannerTransform = {
    mirrorX: false,
    flipY: false,
    rotation: 0,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  };
  applyBannerTransform();
}

function initializeEvents() {
  updateBannerToolStatus();
  updateSharedModeSlider();
  updateContinuationStatus();
  
  // Banner upload
  $("bannerInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    state.sourceBanner = await imageDataFromFile(file);
    // Reset manual weight on new banner — optimal weight is image-specific.
    state.mobileCompatibility.manualWeight = null;
    state.bannerName = file.name;
    resetBannerTransform();
    $("bannerMeta").textContent = `${file.name} · ${state.banner.width} × ${state.banner.height}`;
    setMode("banner");
    toast("Banner uploaded");
  });

  $("portraitInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    state.portrait = await imageDataFromFile(file);
    state.portraitName = file.name;
    state.portraitControls = defaultPortraitControls();
    state.lockedProfile = null;
    state.mobileCompatibility.manualWeight = null;
    $("portraitMeta").textContent = `${file.name} · ${state.portrait.width} × ${state.portrait.height}`;
    updateWorkflowUI();
    openProfileEditor({ reset: true });
  });
  $("modeBanner").addEventListener("click", () => setMode("banner"));
  $("modePortrait").addEventListener("click", () => setMode("portrait"));
  $("editProfilePicture").addEventListener("click", () => openProfileEditor());
  $("cancelProfileEditor").addEventListener("click", closeProfileEditor);
  $("cancelProfileEditorTop").addEventListener("click", closeProfileEditor);
  $("profileEditor").querySelector(".profile-editor-backdrop").addEventListener("click", closeProfileEditor);
  $("applyProfilePicture").addEventListener("click", applyLockedProfile);
  $("resetProfileCrop").addEventListener("click", () => {
    state.cropDraft = defaultPortraitControls();
    renderProfileEditor();
  });
  $("profileCropZoom").addEventListener("input", (event) => {
    if (!state.cropDraft) return;
    state.cropDraft.scale = Number(event.target.value) / 100;
    const panLimit = profileCropPanLimits(state.cropDraft.scale);
    state.cropDraft.offsetX = Math.min(panLimit.x, Math.max(-panLimit.x, state.cropDraft.offsetX));
    state.cropDraft.offsetY = Math.min(panLimit.y, Math.max(-panLimit.y, state.cropDraft.offsetY));
    renderProfileEditor();
  });

  const cropCanvas = $("profileCropCanvas");
  let cropDrag = null;
  cropCanvas.addEventListener("pointerdown", (event) => {
    if (!state.cropDraft) return;
    cropDrag = {
      x: event.clientX,
      y: event.clientY,
      offsetX: state.cropDraft.offsetX,
      offsetY: state.cropDraft.offsetY,
    };
    cropCanvas.setPointerCapture(event.pointerId);
  });
  cropCanvas.addEventListener("pointermove", (event) => {
    if (!cropDrag || !state.cropDraft) return;
    const radius = Math.max(1, cropCanvas.getBoundingClientRect().width / 2);
    const panLimit = profileCropPanLimits(state.cropDraft.scale);
    state.cropDraft.offsetX = Math.min(panLimit.x, Math.max(-panLimit.x, cropDrag.offsetX + (event.clientX - cropDrag.x) / radius));
    state.cropDraft.offsetY = Math.min(panLimit.y, Math.max(-panLimit.y, cropDrag.offsetY + (event.clientY - cropDrag.y) / radius));
    renderProfileEditor();
  });
  const endCropDrag = () => { cropDrag = null; };
  cropCanvas.addEventListener("pointerup", endCropDrag);
  cropCanvas.addEventListener("pointercancel", endCropDrag);
  cropCanvas.addEventListener("wheel", (event) => {
    if (!state.cropDraft) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    state.cropDraft.scale = Math.min(12, Math.max(1, state.cropDraft.scale * factor));
    const panLimit = profileCropPanLimits(state.cropDraft.scale);
    state.cropDraft.offsetX = Math.min(panLimit.x, Math.max(-panLimit.x, state.cropDraft.offsetX));
    state.cropDraft.offsetY = Math.min(panLimit.y, Math.max(-panLimit.y, state.cropDraft.offsetY));
    renderProfileEditor();
  }, { passive: false });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("profileEditor").hidden) closeProfileEditor();
  });

  // Crop balance slider
  $("cropBalanceSlider").addEventListener("input", (event) => {
    const mobile = state.mobileCompatibility;
    if (!mobile.androidMapping || !mobile.desktopMapping) return;
    mobile.manualWeight = Number(event.target.value) / 100;
    mobile.sourceMapping = interpolateSourceMappings(mobile.androidMapping, mobile.desktopMapping, mobile.manualWeight);
    if (state.mode === "portrait") {
      rebuildLinkedBanner();
      updateSharedModeSlider();
      scheduleRender();
      return;
    }
    state.continuation.signature = "";
    mobile.continuation.signature = "";
    updateSharedModeSlider();
    scheduleRender();
  });

  $("resetCropBalance").addEventListener("click", () => {
    const mobile = state.mobileCompatibility;
    mobile.manualWeight = null;
    mobile.sourceMapping = mobile.autoMapping;
    if (state.mode === "portrait") rebuildLinkedBanner();
    state.continuation.signature = "";
    mobile.continuation.signature = "";
    updateSharedModeSlider();
    scheduleRender();
    toast("Crop balance reset to optimizer recommendation");
  });

  // Priority radio change
  document.querySelectorAll('input[name="priority"]').forEach((radio) => {
    radio.addEventListener("change", (event) => {
      state.priority = event.target.value;
      // Manual weight is per-image, not per-mode — preserve it across mode switches.
      rebuildActiveBanner();
      updateSharedModeSlider();
      scheduleRender();
    });
  });

  // Preview options
  $("shapeSelect").addEventListener("change", (event) => {
    state.shape = event.target.value;
    if (state.mode === "banner") autoBalanceAndroidCompatibility();
    scheduleRender();
  });
  $("themeSelect").addEventListener("change", (event) => {
    state.theme = event.target.value;
    rebuildActiveBanner();
    scheduleRender();
  });

  // Continuation controls
  $("continuationToggle").addEventListener("change", (event) => {
    state.continuation.enabled = event.target.checked;
    state.continuation.signature = "";
    state.continuation.model = null;
    state.mobileCompatibility.continuation.signature = "";
    state.mobileCompatibility.continuation.model = null;
    updateContinuationStatus();
    scheduleRender();
  });
  $("continuationSensitivity").addEventListener("input", (event) => {
    state.continuation.sensitivity = Number(event.target.value) / 100;
    // Invalidate cached models — new sensitivity needs fresh detection
    state.continuation.signature = "";
    state.continuation.model = null;
    state.mobileCompatibility.continuation.signature = "";
    state.mobileCompatibility.continuation.model = null;
    updateContinuationStatus();
    scheduleRender();
  });

  // Quick tools
  $("mirrorBanner").addEventListener("click", () => {
    state.bannerTransform.mirrorX = !state.bannerTransform.mirrorX;
    applyBannerTransform();
  });
  $("flipBanner").addEventListener("click", () => {
    state.bannerTransform.flipY = !state.bannerTransform.flipY;
    applyBannerTransform();
  });
  $("rotateBanner").addEventListener("click", () => {
    state.bannerTransform.rotation = ((state.bannerTransform.rotation || 0) + 90) % 360;
    applyBannerTransform();
  });
  $("zoomBannerIn").addEventListener("click", () => {
    setBannerZoomPercent(Math.round(state.bannerTransform.zoom * 100) + 5);
  });
  $("zoomBannerOut").addEventListener("click", () => {
    setBannerZoomPercent(Math.round(state.bannerTransform.zoom * 100) - 5);
  });
  $("bannerZoomInput").addEventListener("change", (event) => {
    setBannerZoomPercent(Number(event.target.value) || 100);
  });
  $("bannerZoomInput").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setBannerZoomPercent(Number(event.currentTarget.value) || 100);
    event.currentTarget.blur();
  });
  $("nudgeBannerLeft").addEventListener("click", () => nudgeBanner(-nudgeStep(), 0));
  $("nudgeBannerRight").addEventListener("click", () => nudgeBanner(nudgeStep(), 0));
  $("nudgeBannerUp").addEventListener("click", () => nudgeBanner(0, -nudgeStep()));
  $("nudgeBannerDown").addEventListener("click", () => nudgeBanner(0, nudgeStep()));
  $("resetBannerTools").addEventListener("click", () => {
    resetBannerTransform();
    toast("Position reset");
  });

  // Interactive drag/scroll events on Desktop Preview
  setupInteractiveCanvas(desktopCanvas, () => ({ bannerRect: state.bannerRect, avatar: state.avatar }));
  // Interactive drag/scroll events on Android Preview
  setupInteractiveCanvas(androidCanvas, () => androidPresetLayout());

  // Export actions
  $("exportAvatar").addEventListener("click", () => {
    const exportResult = activeAvatarResult(400);
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = 400;
    exportCanvas.height = 400;
    putRawImage(exportCanvas.getContext("2d"), exportResult);
    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      const base = state.portraitName.replace(/\.[^.]+$/, "") || "profile";
      downloadBlob(blob, state.mode === "portrait" ? `${base}-profile.png` : "avatar-upload.png");
      toast(`Avatar exported · ${(blob.size / 1024).toFixed(0)} KB`);
    }, "image/png");
  });

  $("exportBanner").addEventListener("click", () => {
    if (!state.banner) return;
    const exportCanvas = imageDataCanvas(displayedBanner());
    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, transformedBannerFilename());
      toast("Banner exported · upload it with the avatar");
    }, "image/png");
  });

  $("exportMetadata").addEventListener("click", () => {
    const mockQuality = { score: 100, warnings: [] };
    const mockState = {
      ...state,
      preset: PRESETS.desktop,
      calibrated: false,
      calibrationResidual: 0,
      lockStart: 0.85,
      featherWidth: 0.2,
      opaqueCorners: true,
      portrait: state.portrait,
      portraitControls: state.portraitControls,
      mode: state.mode,
      surface: "desktop",
      theme: state.theme,
      shape: state.shape,
      browserZoom: 100,
      devicePixelRatio: 1,
      mobileCompatibility: {
        ...state.mobileCompatibility,
        enabled: state.priority === "shared",
        calibrated: false,
        residualPx: 0,
        scores: null,
      }
    };
    const json = JSON.stringify(serializeProject(mockState, mockQuality), null, 2);
    downloadBlob(new Blob([json], { type: "application/json" }), "headerlock-project.json");
    toast("Project metadata exported");
  });

  // View mode switcher: [Both | Desktop | Mobile]
  const viewBothBtn = $("viewBoth");
  const viewDesktopBtn = $("viewDesktop");
  const viewMobileBtn = $("viewMobile");
  const previewsGrid = $("previewsGrid");

  const setView = (mode) => {
    previewsGrid.classList.remove("view-both", "view-desktop", "view-mobile");
    previewsGrid.classList.add(`view-${mode}`);
    viewBothBtn.classList.toggle("active", mode === "both");
    viewDesktopBtn.classList.toggle("active", mode === "desktop");
    viewMobileBtn.classList.toggle("active", mode === "mobile");
  };

  viewBothBtn.addEventListener("click", () => setView("both"));
  viewDesktopBtn.addEventListener("click", () => setView("desktop"));
  viewMobileBtn.addEventListener("click", () => setView("mobile"));

  // Fine-tune modal drawer
  const fineTuneModal = $("fineTuneModal");
  const toggleFineTuneBtn = $("toggleFineTune");
  const closeFineTuneBtn = $("closeFineTune");

  const openFineTune = () => {
    fineTuneModal.hidden = false;
    toggleFineTuneBtn.classList.add("active");
  };
  const closeFineTune = () => {
    fineTuneModal.hidden = true;
    toggleFineTuneBtn.classList.remove("active");
  };

  toggleFineTuneBtn.addEventListener("click", () => {
    if (fineTuneModal.hidden) openFineTune();
    else closeFineTune();
  });
  closeFineTuneBtn.addEventListener("click", closeFineTune);
  fineTuneModal.querySelector(".fine-tune-backdrop")?.addEventListener("click", closeFineTune);

  // Split export button & dropdown
  const exportBothDirect = $("exportBothDirect");
  const exportMenuTrigger = $("exportMenuTrigger");
  const exportMenu = $("exportMenu");

  exportMenuTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    exportMenu.hidden = !exportMenu.hidden;
  });

  document.addEventListener("click", (e) => {
    if (!exportMenu.hidden && !exportMenu.contains(e.target) && e.target !== exportMenuTrigger) {
      exportMenu.hidden = true;
    }
  });

  exportMenu.querySelectorAll(".dropdown-item").forEach((item) => {
    item.addEventListener("click", () => {
      exportMenu.hidden = true;
    });
  });

  exportBothDirect.addEventListener("click", () => {
    $("exportAvatar").click();
    setTimeout(() => {
      $("exportBanner").click();
    }, 350);
  });

  // Global escape key handler
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!fineTuneModal.hidden) closeFineTune();
      if (!exportMenu.hidden) exportMenu.hidden = true;
    }
  });

  // Drag and drop images anywhere on page
  const dropOverlay = $("dropOverlay");
  let dragDepth = 0;

  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth++;
    if (dropOverlay) dropOverlay.hidden = false;
  });

  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && dropOverlay) dropOverlay.hidden = true;
  });

  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth = 0;
    if (dropOverlay) dropOverlay.hidden = true;
    const files = Array.from(e.dataTransfer?.files || []);
    const imgFiles = files.filter(f => f.type.startsWith("image/"));
    if (imgFiles.length === 0) return;

    for (const file of imgFiles) {
      const imgData = await imageDataFromFile(file);
      const aspect = imgData.width / imgData.height;
      if (aspect > 2.0 || (imgFiles.length === 1 && state.mode === "banner")) {
        state.sourceBanner = imgData;
        state.mobileCompatibility.manualWeight = null;
        state.bannerName = file.name;
        resetBannerTransform();
        $("bannerMeta").textContent = `${file.name} · ${state.banner.width} × ${state.banner.height}`;
        toast(`Banner loaded: ${file.name}`);
      } else {
        state.portrait = imgData;
        state.portraitName = file.name;
        state.portraitControls = defaultPortraitControls();
        state.lockedProfile = null;
        state.mobileCompatibility.manualWeight = null;
        $("portraitMeta").textContent = `${file.name} · ${state.portrait.width} × ${state.portrait.height}`;
        toast(`Avatar loaded: ${file.name}`);
        openProfileEditor({ reset: true });
      }
    }
    updateWorkflowUI();
    rebuildActiveBanner();
    scheduleRender();
  });

}

function setupInteractiveCanvas(canvas, layoutGetter) {
  let bannerDrag = null;
  let profileDrag = null;

  canvas.addEventListener("pointerdown", (event) => {
    if (!state.banner) return;
    const layout = layoutGetter();
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / rect.width;
    const y = (event.clientY - rect.top) * canvas.height / rect.height;
    const bannerRect = layout.bannerRect;

    if (state.mode === "portrait") {
      if (!state.lockedProfile || !layout.avatar) return;
      const avatar = layout.avatar;
      if (Math.hypot(x - avatar.centerX, y - avatar.centerY) > avatar.outerRadius) return;
      openProfileEditor();
      return;
    }
    
    const insideBanner = x >= bannerRect.x && x <= bannerRect.x + bannerRect.width
      && y >= bannerRect.y && y <= bannerRect.y + bannerRect.height;
    if (!insideBanner) return;
    
    const previewTransform = computeCoverTransform(state.banner.width, state.banner.height, bannerRect);
    bannerDrag = {
      startX: x,
      startY: y,
      startOffsetX: state.bannerTransform.offsetX,
      startOffsetY: state.bannerTransform.offsetY,
      scale: previewTransform.scaleX,
      activated: false,
    };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (profileDrag) {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) * canvas.width / rect.width;
      const y = (event.clientY - rect.top) * canvas.height / rect.height;
      state.portraitControls.offsetX = Math.min(8, Math.max(-8,
        profileDrag.startOffsetX + (x - profileDrag.startX) / profileDrag.imageRadius));
      state.portraitControls.offsetY = Math.min(8, Math.max(-8,
        profileDrag.startOffsetY + (y - profileDrag.startY) / profileDrag.imageRadius));
      applyPortraitControls();
      return;
    }
    if (!bannerDrag) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / rect.width;
    const y = (event.clientY - rect.top) * canvas.height / rect.height;
    
    const dx = (x - bannerDrag.startX) / Math.max(0.001, bannerDrag.scale);
    const dy = (y - bannerDrag.startY) / Math.max(0.001, bannerDrag.scale);
    
    if (!bannerDrag.activated && Math.hypot(dx, dy) < 2) return;
    if (!bannerDrag.activated) {
      ensurePanRoom();
      bannerDrag.startOffsetX = state.bannerTransform.offsetX;
      bannerDrag.startOffsetY = state.bannerTransform.offsetY;
      bannerDrag.activated = true;
    }
    
    state.bannerTransform.offsetX = bannerDrag.startOffsetX + dx;
    state.bannerTransform.offsetY = bannerDrag.startOffsetY + dy;
    applyBannerTransformWithoutRefit();
  });

  canvas.addEventListener("pointerup", () => {
    if (profileDrag) {
      profileDrag = null;
      return;
    }
    if (bannerDrag?.activated) {
      autoBalanceAndroidCompatibility();
      scheduleRender();
    }
    bannerDrag = null;
  });

  canvas.addEventListener("pointercancel", () => {
    bannerDrag = null;
    profileDrag = null;
  });

  canvas.addEventListener("wheel", (event) => {
    if (!state.banner) return;
    const layout = layoutGetter();
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / rect.width;
    const y = (event.clientY - rect.top) * canvas.height / rect.height;
    const bannerRect = layout.bannerRect;

    if (state.mode === "portrait") {
      if (!state.lockedProfile || !layout.avatar) return;
      const avatar = layout.avatar;
      if (Math.hypot(x - avatar.centerX, y - avatar.centerY) > avatar.outerRadius) return;
      event.preventDefault();
      openProfileEditor();
      return;
    }
    
    const insideBanner = x >= bannerRect.x && x <= bannerRect.x + bannerRect.width
      && y >= bannerRect.y && y <= bannerRect.y + bannerRect.height;
    if (!insideBanner) return;
    
    event.preventDefault();
    const cover = computeCoverTransform(state.banner.width, state.banner.height, bannerRect);
    const anchor = {
      x: (x - cover.translateX) / cover.scaleX,
      y: (y - cover.translateY) / cover.scaleY,
    };
    const step = event.deltaY < 0 ? 8 : -8;
    setBannerZoomPercent(Math.round(state.bannerTransform.zoom * 100) + step, anchor);
  }, { passive: false });
}

function applyBannerTransformWithoutRefit() {
  if (state.mode === "portrait") return;
  state.banner = renderWorkingBanner();
  state.continuation.signature = "";
  state.mobileCompatibility.continuation.signature = "";
  updateBannerToolStatus();
  scheduleRender();
}

// Initialise the app
state.sourceBanner = createDemoBanner();
state.banner = renderWorkingBanner();
resetPresetGeometry();
initializeEvents();
autoBalanceAndroidCompatibility();
syncPortraitControlsUI();
updateWorkflowUI();
scheduleRender();
