import {
  PRESETS,
  computeCoverTransform,
  geometryFromPreset,
  sourceMappingFromLayout,
  optimizeSharedAffineMapping,
  detectBoundaryLines,
  buildAvatar,
  hexToRgb,
} from "./core.js?v=6.5.0";

// ── Application State ──────────────────────────────────────────
const state = {
  sourceBanner: null,    // Image or Canvas element
  bannerName: "banner.png",
  theme: localStorage.getItem("headerlock-theme") || "dark", // "dark" | "light"
  zoom: 1.0,
  panX: 0,
  panY: 0,
  target: "shared",      // "shared" | "desktop" | "mobile"
  shape: "circle",       // "circle" | "square"
  extend: true,          // Extend banner features below the boundary
  view: "both",          // "both" | "desktop" | "mobile"
  bannerData: null,      // ImageData (1500 × 500)
  sceneData: null,       // Extended ImageData (1500 × sceneH) for seamless avatar sampling
  sceneH: 500,           // Effective scene height (500 to 800)
  avatarData: null,      // ImageData (400 × 400)
};

// ── Dedicated High-Performance Offscreen Buffers ───────────────
const bannerBuffer = document.createElement("canvas");
bannerBuffer.width = 1500;
bannerBuffer.height = 500;
const bannerBufferCtx = bannerBuffer.getContext("2d", { willReadFrequently: true });

const sceneBuffer = document.createElement("canvas");
sceneBuffer.width = 1500;
sceneBuffer.height = 750;
const sceneBufferCtx = sceneBuffer.getContext("2d", { willReadFrequently: true });

const avatarBuffer = document.createElement("canvas");
avatarBuffer.width = 400;
avatarBuffer.height = 400;
const avatarBufferCtx = avatarBuffer.getContext("2d", { willReadFrequently: true });

// ── DOM References ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const desktopCanvas = $("desktopCanvas");
const desktopCtx = desktopCanvas.getContext("2d");
const mobileCanvas = $("mobileCanvas");
const mobileCtx = mobileCanvas.getContext("2d");
const bannerInput = $("bannerInput");
const themeToggleBtn = $("themeToggleBtn");
const toastEl = $("toast");
const dropOverlay = $("dropOverlay");

// ── Toast Notification ─────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

// ── Default Demo Banner Generator ──────────────────────────────
function createDefaultBanner() {
  const canvas = document.createElement("canvas");
  canvas.width = 1500;
  canvas.height = 500;
  const ctx = canvas.getContext("2d");

  // Deep AMOLED space gradient
  const grad = ctx.createLinearGradient(0, 0, 1500, 500);
  grad.addColorStop(0, "#030712");
  grad.addColorStop(0.5, "#0b0f19");
  grad.addColorStop(1, "#020408");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1500, 500);

  // Subtle geometric grid
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= 1500; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 500);
    ctx.stroke();
  }
  for (let y = 0; y <= 500; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1500, y);
    ctx.stroke();
  }

  // Elegant curved flow crossing the avatar seam
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  ctx.arc(210, 500, 240, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.beginPath();
  ctx.arc(210, 500, 320, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();

  // Subtle brand mark in banner
  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  ctx.font = "600 24px 'JetBrains Mono', monospace";
  ctx.fillText("headerlock", 1300, 60);

  return canvas;
}

// ── Render Working Banner & Extended Scene ─────────────────────
function updateWorkingBanner() {
  const width = 1500;
  const bannerH = 500;

  bannerBufferCtx.fillStyle = "#000000";
  bannerBufferCtx.fillRect(0, 0, width, bannerH);

  const img = state.sourceBanner;
  if (!img) return;

  // Compute cover scale
  const imgW = img.width || img.naturalWidth || width;
  const imgH = img.height || img.naturalHeight || bannerH;
  const baseScale = Math.max(width / imgW, bannerH / imgH);
  const scale = baseScale * state.zoom;

  const drawW = imgW * scale;
  const drawH = imgH * scale;

  // Center + pan
  const drawX = (width - drawW) / 2 + state.panX;
  const drawY = (bannerH - drawH) / 2 + state.panY;

  // Determine effective scene height for avatar sampling (up to 800 to fully cover lower avatar)
  const imgBottom = Math.ceil(drawY + drawH);
  const sceneH = Math.max(500, Math.min(800, imgBottom));
  state.sceneH = sceneH;

  // Render extended scene
  sceneBuffer.width = width;
  sceneBuffer.height = sceneH;
  sceneBufferCtx.fillStyle = "#000000";
  sceneBufferCtx.fillRect(0, 0, width, sceneH);
  sceneBufferCtx.drawImage(img, drawX, drawY, drawW, drawH);
  state.sceneData = sceneBufferCtx.getImageData(0, 0, width, sceneH);

  // Render standard 1500 × 500 banner (for export & desktop banner preview)
  bannerBufferCtx.drawImage(sceneBuffer, 0, 0, width, bannerH, 0, 0, width, bannerH);
  state.bannerData = bannerBufferCtx.getImageData(0, 0, width, bannerH);
}

// ── Compute Aligned Avatar (400 × 400) ─────────────────────────
function updateAvatar() {
  if (!state.sceneData || !state.bannerData) return;

  const sceneH = state.sceneH || 500;
  const sceneRect = { x: 0, y: 0, width: 1500, height: sceneH };
  const desktopRect = { x: 0, y: 0, width: 1500, height: 500 };
  const dGeom = geometryFromPreset(PRESETS.desktop, desktopRect);
  const mGeom = geometryFromPreset(PRESETS.androidApp, desktopRect);

  let mapping = null;
  const dMap = sourceMappingFromLayout({ banner: state.sceneData, bannerRect: sceneRect, avatar: dGeom });
  const mMap = sourceMappingFromLayout({ banner: state.sceneData, bannerRect: sceneRect, avatar: mGeom });

  if (state.target === "desktop") {
    mapping = dMap;
  } else if (state.target === "mobile") {
    mapping = mMap;
  } else {
    // Shared compromise mapping (Android protected by integrity floor fallback)
    const opt = optimizeSharedAffineMapping({
      banner: state.sceneData,
      primaryMapping: mMap,
      secondaryMapping: dMap,
      pageColor: state.theme === "light" ? [255, 255, 255] : [0, 0, 0],
    });
    mapping = opt.mapping || mMap;
  }

  // Feature continuation: active if extend is enabled and scene reaches bottom of image
  const desktopContinuation = state.extend ? detectBoundaryLines({
    banner: state.sceneData,
    bannerRect: sceneRect,
    avatar: dGeom,
    sensitivity: 0.58,
  }) : null;

  const mobileContinuation = state.extend ? detectBoundaryLines({
    banner: state.sceneData,
    bannerRect: sceneRect,
    avatar: mGeom,
    sensitivity: 0.58,
  }) : null;

  const activeContinuation = state.target === "mobile" ? mobileContinuation : desktopContinuation;
  const activeAvatarGeom = state.target === "mobile" ? mGeom : dGeom;

  state.avatarData = buildAvatar({
    banner: state.sceneData,
    portrait: null,
    outputSize: 400,
    bannerRect: sceneRect,
    avatar: activeAvatarGeom,
    mode: "banner",
    shape: state.shape,
    pageColor: state.theme === "light" ? [255, 255, 255] : [0, 0, 0],
    continuation: activeContinuation,
    portraitControls: null,
    compatibility: {
      enabled: true,
      bannerRect: sceneRect,
      avatar: activeAvatarGeom,
      sourceMapping: mapping,
      continuation: activeContinuation,
    },
  });

  putRawImage(avatarBufferCtx, state.avatarData, 0, 0);
}

// ── Raw Image Helper ───────────────────────────────────────────
function putRawImage(context, image, dx = 0, dy = 0) {
  if (!image || !image.data) return;
  let imgData;
  if (typeof ImageData !== "undefined" && image instanceof ImageData) {
    imgData = image;
  } else if (typeof ImageData !== "undefined") {
    try {
      imgData = new ImageData(image.data, image.width, image.height);
    } catch {
      imgData = context.createImageData(image.width, image.height);
      imgData.data.set(image.data);
    }
  } else {
    imgData = context.createImageData(image.width, image.height);
    imgData.data.set(image.data);
  }
  context.putImageData(imgData, dx, dy);
}

// ── Draw Avatar on Canvas ──────────────────────────────────────
function drawAvatarCircle(ctx, cx, cy, radius, borderWidth = 4, isOverlayBorder = false) {
  if (!state.avatarData) return;

  const isLight = state.theme === "light";
  const borderColor = isLight ? "#ffffff" : "#000000";

  ctx.save();
  ctx.beginPath();
  if (state.shape === "circle") {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  } else {
    const size = radius * 2;
    const r = radius * 0.28;
    ctx.roundRect(cx - radius, cy - radius, size, size, r);
  }
  ctx.closePath();
  ctx.clip();

  // Draw avatar directly from dedicated offscreen avatarBuffer
  ctx.drawImage(avatarBuffer, cx - radius, cy - radius, radius * 2, radius * 2);

  // If overlay border (like Android Compose), stroke inside the clip
  if (borderWidth > 0 && isOverlayBorder) {
    ctx.beginPath();
    if (state.shape === "circle") {
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    } else {
      const size = radius * 2;
      const r = radius * 0.28;
      ctx.roundRect(cx - radius, cy - radius, size, size, r);
    }
    ctx.lineWidth = borderWidth * 2;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
  }
  ctx.restore();

  // If outside border (like Desktop web), stroke centered on border ring
  if (borderWidth > 0 && !isOverlayBorder) {
    ctx.save();
    ctx.beginPath();
    if (state.shape === "circle") {
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    } else {
      const size = radius * 2;
      const r = radius * 0.28;
      ctx.roundRect(cx - radius, cy - radius, size, size, r);
    }
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
    ctx.restore();
  }
}

// ── Render Desktop Preview ─────────────────────────────────────
function renderDesktop() {
  const isLight = state.theme === "light";
  const w = desktopCanvas.width;
  const h = desktopCanvas.height;
  desktopCtx.fillStyle = isLight ? "#ffffff" : "#000000";
  desktopCtx.fillRect(0, 0, w, h);

  // 1. Draw 1500 × 500 banner directly from dedicated bannerBuffer
  desktopCtx.drawImage(bannerBuffer, 0, 0, 1500, 500);

  // 2. Profile metadata below banner
  desktopCtx.fillStyle = isLight ? "#0f1419" : "#ffffff";
  desktopCtx.font = "700 32px 'Inter', -apple-system, sans-serif";
  desktopCtx.fillText("Your Name", 420, 570);

  desktopCtx.fillStyle = isLight ? "#536471" : "#71717a";
  desktopCtx.font = "500 20px 'Inter', -apple-system, sans-serif";
  desktopCtx.fillText("@handle · desktop web", 420, 608);

  // 3. Desktop Avatar: centerX: 210.7, centerY: 500, radius: 166.5
  drawAvatarCircle(desktopCtx, 210.7, 500, 166.5, 8, false);
}

// ── Render Mobile Preview ──────────────────────────────────────
function renderMobile() {
  const isLight = state.theme === "light";
  const w = mobileCanvas.width;
  const h = mobileCanvas.height;
  mobileCtx.fillStyle = isLight ? "#ffffff" : "#000000";
  mobileCtx.fillRect(0, 0, w, h);

  const bannerH = w / 3; // 914 / 3 = ~304.7px

  // 1. Draw banner scaled to 914 × 305 directly from dedicated bannerBuffer
  mobileCtx.drawImage(bannerBuffer, 0, 0, 1500, 500, 0, 0, w, bannerH);

  // 2. Mobile back button (clean Twitter/X floating pill)
  mobileCtx.save();
  mobileCtx.beginPath();
  mobileCtx.arc(50, 46, 20, 0, Math.PI * 2);
  mobileCtx.fillStyle = "rgba(0, 0, 0, 0.55)";
  mobileCtx.fill();
  mobileCtx.fillStyle = "#ffffff";
  mobileCtx.font = "700 24px 'Inter', -apple-system, sans-serif";
  mobileCtx.textAlign = "center";
  mobileCtx.textBaseline = "middle";
  mobileCtx.fillText("‹", 48, 44);
  mobileCtx.restore();

  // 3. Profile metadata below banner
  const textY = bannerH + 130;
  mobileCtx.fillStyle = isLight ? "#0f1419" : "#ffffff";
  mobileCtx.font = "800 34px 'Inter', -apple-system, sans-serif";
  mobileCtx.fillText("Your Name", 36, textY);

  mobileCtx.fillStyle = isLight ? "#536471" : "#71717a";
  mobileCtx.font = "600 22px 'Inter', -apple-system, sans-serif";
  mobileCtx.fillText("@handle · mobile app", 36, textY + 40);

  // 4. Mobile Avatar (verified Android Compose geometry from PRESETS.androidApp)
  const mobileBannerRect = { x: 0, y: 0, width: w, height: bannerH };
  const mGeom = geometryFromPreset(PRESETS.androidApp, mobileBannerRect);
  drawAvatarCircle(mobileCtx, mGeom.centerX, mGeom.centerY, mGeom.outerRadius, mGeom.borderWidth, true);
}

// ── Main Render Pipeline ───────────────────────────────────────
let renderPending = false;
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    try {
      updateWorkingBanner();
      updateAvatar();
      renderDesktop();
      renderMobile();
    } catch (err) {
      console.error("Render pipeline error:", err);
      showToast("Render error: " + err.message);
    }
  });
}

// ── Interactive Drag & Zoom ────────────────────────────────────
function setupDrag(canvas, getScale) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialPanX = 0;
  let initialPanY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    startX = e.clientX;
    startY = e.clientY;
    initialPanX = state.panX;
    initialPanY = state.panY;
    isDragging = true;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const factor = getScale();
    state.panX = initialPanX + dx * factor;
    state.panY = initialPanY + dy * factor;
    scheduleRender();
  });

  canvas.addEventListener("pointerup", () => {
    isDragging = false;
  });

  canvas.addEventListener("pointercancel", () => {
    isDragging = false;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomDelta = e.deltaY < 0 ? 0.05 : -0.05;
    state.zoom = Math.min(3.0, Math.max(1.0, state.zoom + zoomDelta));
    $("zoomSlider").value = String(Math.round(state.zoom * 100));
    $("zoomValue").textContent = `${Math.round(state.zoom * 100)}%`;
    scheduleRender();
  }, { passive: false });
}

// ── Export Handling ────────────────────────────────────────────
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAssets() {
  if (!state.bannerData || !state.avatarData) return;

  // 1. Export 1500 × 500 banner directly from dedicated buffer
  bannerBuffer.toBlob((bBlob) => {
    if (bBlob) downloadBlob(bBlob, "banner-1500x500.png");
  }, "image/png");

  // 2. Export 400 × 400 avatar directly from dedicated buffer
  setTimeout(() => {
    avatarBuffer.toBlob((aBlob) => {
      if (aBlob) downloadBlob(aBlob, "avatar-400x400.png");
      showToast("Downloaded banner-1500x500.png & avatar-400x400.png");
    }, "image/png");
  }, 250);
}

// ── Load Banner Image from File (Default Upload Action) ────────
// ── Image File Loader Helper ───────────────────────────────────
function readFileAsImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(new Error("Failed to decode image: " + err));
      img.src = reader.result;
    };
    reader.onerror = (err) => reject(new Error("Failed to read file: " + err));
    reader.readAsDataURL(file);
  });
}

// ── Load Banner Image from File (Default Upload Action) ────────
async function loadBannerFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  try {
    let img;
    if (typeof createImageBitmap === "function") {
      try {
        img = await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        img = await readFileAsImage(file);
      }
    } else {
      img = await readFileAsImage(file);
    }

    state.sourceBanner = img;
    state.bannerName = file.name;
    state.zoom = 1.0;
    state.panX = 0;
    state.panY = 0;
    $("zoomSlider").value = "100";
    $("zoomValue").textContent = "100%";
    scheduleRender();
    showToast(`Banner loaded: ${file.name}`);
  } catch (err) {
    console.error("Banner load error:", err);
    showToast("Failed to load banner: " + err.message);
  }
}

// ── Initialize Event Listeners ─────────────────────────────────
function initEvents() {
  // Apply saved theme on boot
  if (state.theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  }

  // Theme Toggle Button
  themeToggleBtn.addEventListener("click", () => {
    state.theme = state.theme === "light" ? "dark" : "light";
    if (state.theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem("headerlock-theme", state.theme);
    showToast(`Theme: ${state.theme === "light" ? "Light" : "Dark"}`);
    scheduleRender();
  });

  // View Switcher [Both | Desktop | Mobile]
  const container = $("viewsContainer");
  const viewBoth = $("viewBoth");
  const viewDesktop = $("viewDesktop");
  const viewMobile = $("viewMobile");

  const setView = (mode) => {
    state.view = mode;
    container.className = `views-container view-${mode}`;
    viewBoth.classList.toggle("active", mode === "both");
    viewDesktop.classList.toggle("active", mode === "desktop");
    viewMobile.classList.toggle("active", mode === "mobile");
  };

  viewBoth.addEventListener("click", () => setView("both"));
  viewDesktop.addEventListener("click", () => setView("desktop"));
  viewMobile.addEventListener("click", () => setView("mobile"));

  // Target Switcher [Shared | Desktop | Mobile]
  const targetShared = $("targetShared");
  const targetDesktop = $("targetDesktop");
  const targetMobile = $("targetMobile");

  const setTarget = (tgt) => {
    state.target = tgt;
    targetShared.classList.toggle("active", tgt === "shared");
    targetDesktop.classList.toggle("active", tgt === "desktop");
    targetMobile.classList.toggle("active", tgt === "mobile");
    scheduleRender();
  };

  targetShared.addEventListener("click", () => setTarget("shared"));
  targetDesktop.addEventListener("click", () => setTarget("desktop"));
  targetMobile.addEventListener("click", () => setTarget("mobile"));

  // Shape Switcher [Circle | Square]
  const shapeCircle = $("shapeCircle");
  const shapeSquare = $("shapeSquare");

  const setShape = (shape) => {
    state.shape = shape;
    shapeCircle.classList.toggle("active", shape === "circle");
    shapeSquare.classList.toggle("active", shape === "square");
    scheduleRender();
  };

  shapeCircle.addEventListener("click", () => setShape("circle"));
  shapeSquare.addEventListener("click", () => setShape("square"));

  // Zoom Slider & Buttons
  const zoomSlider = $("zoomSlider");
  const zoomValue = $("zoomValue");
  zoomSlider.addEventListener("input", (e) => {
    state.zoom = Number(e.target.value) / 100;
    zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    scheduleRender();
  });

  $("zoomOut").addEventListener("click", () => {
    state.zoom = Math.max(1.0, state.zoom - 0.1);
    zoomSlider.value = String(Math.round(state.zoom * 100));
    zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    scheduleRender();
  });

  $("zoomIn").addEventListener("click", () => {
    state.zoom = Math.min(3.0, state.zoom + 0.1);
    zoomSlider.value = String(Math.round(state.zoom * 100));
    zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    scheduleRender();
  });

  // Extend Switcher [On | Off]
  const extendOn = $("extendOn");
  const extendOff = $("extendOff");

  const setExtend = (enable) => {
    state.extend = enable;
    extendOn.classList.toggle("active", enable);
    extendOff.classList.toggle("active", !enable);
    scheduleRender();
    showToast(`Feature extension: ${enable ? "On" : "Off"}`);
  };

  extendOn.addEventListener("click", () => setExtend(true));
  extendOff.addEventListener("click", () => setExtend(false));

  // Reset Button
  $("resetBtn").addEventListener("click", () => {
    state.zoom = 1.0;
    state.panX = 0;
    state.panY = 0;
    state.extend = true;
    $("extendOn").classList.add("active");
    $("extendOff").classList.remove("active");
    zoomSlider.value = "100";
    zoomValue.textContent = "100%";
    scheduleRender();
    showToast("Reset pan & zoom");
  });

  // Upload Buttons
  $("uploadBannerBtn").addEventListener("click", () => bannerInput.click());
  bannerInput.addEventListener("change", (e) => {
    if (e.target.files?.[0]) loadBannerFile(e.target.files[0]);
  });

  $("exportBtn").addEventListener("click", exportAssets);

  // Setup Canvas Dragging (both canvas scale against 1500 banner buffer coordinate system)
  setupDrag(desktopCanvas, () => 1500 / desktopCanvas.getBoundingClientRect().width);
  setupDrag(mobileCanvas, () => 1500 / mobileCanvas.getBoundingClientRect().width);

  // Global Drag and Drop (defaults to loading as Banner)
  let dragCounter = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.hidden = false;
  });

  window.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) dropOverlay.hidden = true;
  });

  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.hidden = true;
    const file = e.dataTransfer?.files?.[0];
    if (file) loadBannerFile(file);
  });
}

// ── Startup ────────────────────────────────────────────────────
state.sourceBanner = createDefaultBanner();
initEvents();
scheduleRender();

// Load authentic default demo banner (vegaz.png)
if (typeof Image !== "undefined") {
  const defaultImg = new Image();
  defaultImg.onload = () => {
    state.sourceBanner = defaultImg;
    state.bannerName = "vegaz.png";
    scheduleRender();
  };
  defaultImg.src = "./assets/default-banner.png?v=6.5.0";
}
