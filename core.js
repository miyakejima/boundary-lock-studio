export const PRESETS = {
  desktop: {
    id: "x-web-desktop-2026-06",
    label: "Desktop web · measured Jun 2026",
    frameAspect: 598 / 200,
    centerX: 0.14047,
    centerY: 1,
    outerRadius: 0.11371,
    paddingPx: 4,
    confidence: 0.78,
  },
  mobile: {
    id: "x-mobile-web-2026-06",
    label: "Mobile web · measured Jun 2026",
    frameAspect: 373 / 200,
    centerX: 0.15717,
    centerY: 1,
    outerRadius: 0.11428,
    paddingPx: 4,
    confidence: 0.72,
  },
  androidApp: {
    id: "x-android-compose-profile-header-12.27-2026-09-18",
    label: "Android app · current Compose profile header",
    frameAspect: 3,
    androidDpGeometry: {
      // Verified Compose profile header geometry (X 12.27+):
      // 12dp horizontal profile padding, 80dp avatar, 2dp overlay border.
      // The visible 80dp avatar overlaps 14dp into the 3:1 banner,
      // placing the center 26dp below the banner bottom seam.
      logicalWidthDp: 411,
      leftDp: 12,
      overlapDp: 14,
      sizeDp: 80,
      borderDp: 2,
      // Compose's Modifier.border overlays the 80dp image. It does not
      // shrink the image content to 76dp.
      borderConsumesImage: false,
    },
    // Normalized fallbacks for project readers that predate androidDpGeometry.
    centerX: 52 / 411,
    centerY: 1 + 78 / 411,
    outerRadius: 40 / 411,
    paddingPx: 2,
    confidence: 0.99,
  },
  androidLegacy: {
    id: "x-android-legacy-profile-header-12.1-12.2-2026-06-23",
    label: "Android app · legacy profile header",
    frameAspect: 3,
    androidDpGeometry: {
      logicalWidthDp: 411,
      leftDp: 9,
      overlapDp: 36,
      sizeDp: 76,
      borderDp: 3.5,
    },
    centerX: 47 / 411,
    centerY: 1 + 6 / 411,
    outerRadius: 38 / 411,
    paddingPx: 3.5,
    confidence: 0.9,
  },
};

export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function computeCoverTransform(sourceWidth, sourceHeight, rect) {
  const scale = Math.max(rect.width / sourceWidth, rect.height / sourceHeight);
  return {
    scaleX: scale,
    scaleY: scale,
    translateX: rect.x + (rect.width - sourceWidth * scale) / 2,
    translateY: rect.y + (rect.height - sourceHeight * scale) / 2,
  };
}

export function screenToSource(screenX, screenY, transform) {
  return {
    x: (screenX - transform.translateX) / transform.scaleX,
    y: (screenY - transform.translateY) / transform.scaleY,
  };
}

function sourceToScreen(sourceX, sourceY, transform) {
  return {
    x: sourceX * transform.scaleX + transform.translateX,
    y: sourceY * transform.scaleY + transform.translateY,
  };
}

function pixel(image, x, y, channel, fill) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return fill[channel];
  return image.data[(y * image.width + x) * 4 + channel];
}

export function sampleBilinear(image, x, y, fill = [0, 0, 0, 255]) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const result = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel += 1) {
    const top = pixel(image, x0, y0, channel, fill) * (1 - tx)
      + pixel(image, x0 + 1, y0, channel, fill) * tx;
    const bottom = pixel(image, x0, y0 + 1, channel, fill) * (1 - tx)
      + pixel(image, x0 + 1, y0 + 1, channel, fill) * tx;
    result[channel] = top * (1 - ty) + bottom * ty;
  }
  return result;
}

function channelMedian(values, fallback) {
  if (!values.length) return fallback;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function pixelLuma(image, x, y) {
  const cx = Math.max(0, Math.min(image.width - 1, x));
  const cy = Math.max(0, Math.min(image.height - 1, y));
  const i = (cy * image.width + cx) * 4;
  return image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
}

function featureScore(image, x, y) {
  const index = (y * image.width + x) * 4;
  const r = image.data[index];
  const g = image.data[index + 1];
  const b = image.data[index + 2];
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const chroma = maximum - minimum;
  // Full 3×3 Sobel gradient — catches diagonal edges missed by 1-px axial diff
  const gx =
    -pixelLuma(image, x - 1, y - 1) + pixelLuma(image, x + 1, y - 1) +
    -2 * pixelLuma(image, x - 1, y) + 2 * pixelLuma(image, x + 1, y) +
    -pixelLuma(image, x - 1, y + 1) + pixelLuma(image, x + 1, y + 1);
  const gy =
    -pixelLuma(image, x - 1, y - 1) - 2 * pixelLuma(image, x, y - 1) - pixelLuma(image, x + 1, y - 1) +
    pixelLuma(image, x - 1, y + 1) + 2 * pixelLuma(image, x, y + 1) + pixelLuma(image, x + 1, y + 1);
  const gradient = Math.sqrt(gx * gx + gy * gy) / 4; // normalise Sobel scale
  return chroma * 0.62 + gradient * 1.18 + maximum * 0.05;
}

export function detectBoundaryLines({ banner, bannerRect, avatar, sensitivity = 0.58 }) {
  const transform = computeCoverTransform(banner.width, banner.height, bannerRect);
  const imageRadius = Math.max(1, avatar.outerRadius - avatar.padding);
  const sourceCenter = screenToSource(avatar.centerX, avatar.centerY, transform);
  const sourceRadius = imageRadius / transform.scaleX;
  const extensionDepth = Math.max(0, sourceCenter.y + sourceRadius - (banner.height - 1));
  const empty = {
    enabled: true,
    models: [],
    backgroundColor: [0, 0, 0, 255],
    bandDepth: 0,
    extensionDepth,
    sourceCenter,
    sourceRadius,
    sensitivity,
  };
  if (extensionDepth < 1 || banner.width < 4 || banner.height < 4) return empty;

  const targetXMin = sourceCenter.x - sourceRadius - 8;
  const targetXMax = sourceCenter.x + sourceRadius + 8;
  const margin = Math.max(24, sourceRadius * 1.35);
  const xMin = Math.max(1, Math.floor(sourceCenter.x - sourceRadius - margin));
  const xMax = Math.min(banner.width - 2, Math.ceil(sourceCenter.x + sourceRadius + margin));
  const regionWidth = Math.max(1, xMax - xMin + 1);
  const bandDepth = Math.min(banner.height - 1, Math.max(48, Math.round(sourceRadius * 0.78)));
  const yMin = banner.height - bandDepth;
  const threshold = 30 + (1 - clamp(sensitivity)) * 54;
  const mask = new Uint8Array(regionWidth * bandDepth);
  const backgroundChannels = [[], [], []];

  for (let localY = 0; localY < bandDepth; localY += 1) {
    const y = yMin + localY;
    for (let localX = 0; localX < regionWidth; localX += 1) {
      const x = xMin + localX;
      const score = featureScore(banner, x, y);
      const active = score >= threshold;
      mask[localY * regionWidth + localX] = active ? 1 : 0;
      if (!active && localX % 4 === 0 && localY % 4 === 0) {
        const index = (y * banner.width + x) * 4;
        backgroundChannels[0].push(banner.data[index]);
        backgroundChannels[1].push(banner.data[index + 1]);
        backgroundChannels[2].push(banner.data[index + 2]);
      }
    }
  }

  const backgroundColor = [
    channelMedian(backgroundChannels[0], 0),
    channelMedian(backgroundChannels[1], 0),
    channelMedian(backgroundChannels[2], 0),
    255,
  ];
  const activity = new Uint8Array(regionWidth);
  const boundaryRows = Math.min(bandDepth, Math.max(12, Math.round(sourceRadius * 0.1)));
  for (let localX = 0; localX < regionWidth; localX += 1) {
    for (let row = 0; row < boundaryRows; row += 1) {
      if (mask[(bandDepth - 1 - row) * regionWidth + localX]) {
        activity[localX] = 1;
        break;
      }
    }
  }
  for (let x = 1; x < regionWidth - 1; x += 1) {
    if (!activity[x] && activity[x - 1] && activity[x + 1]) activity[x] = 1;
  }

  const runs = [];
  let runStart = -1;
  for (let x = 0; x <= regionWidth; x += 1) {
    const active = x < regionWidth ? activity[x] : 0;
    if (active && runStart < 0) runStart = x;
    if (!active && runStart >= 0) {
      const runEnd = x - 1;
      const width = runEnd - runStart + 1;
      if (width <= Math.max(96, sourceRadius * 0.55)) runs.push({ start: runStart, end: runEnd, width });
      runStart = -1;
    }
  }

  const slopeMin = -6;
  const slopeMax = 6;
  const slopeStep = 0.08; // finer resolution — catches steep diagonals and shallow curves
  const slopes = [];
  for (let slope = slopeMin; slope <= slopeMax + 1e-6; slope += slopeStep) slopes.push(slope);
  const accumulator = new Float32Array(slopes.length * regionWidth);
  // Vote every row (not every 2) — better evidence for shallow/short lines
  for (let localY = 0; localY < bandDepth; localY += 1) {
    const k = bandDepth - 1 - localY;
    // Weight near-boundary rows more heavily (they matter most for the avatar seam)
    const weight = 0.45 + 0.55 * Math.pow(1 - k / bandDepth, 0.6);
    for (let localX = 0; localX < regionWidth; localX += 1) {
      if (!mask[localY * regionWidth + localX]) continue;
      const sourceX = xMin + localX;
      for (let slopeIndex = 0; slopeIndex < slopes.length; slopeIndex += 1) {
        const intercept = Math.round(sourceX + slopes[slopeIndex] * k) - xMin;
        if (intercept >= 0 && intercept < regionWidth) {
          accumulator[slopeIndex * regionWidth + intercept] += weight;
        }
      }
    }
  }

  const peaks = [];
  const minimumVotes = Math.max(7, bandDepth * 0.07);
  for (let slopeIndex = 1; slopeIndex < slopes.length - 1; slopeIndex += 1) {
    for (let intercept = 1; intercept < regionWidth - 1; intercept += 1) {
      const votes = accumulator[slopeIndex * regionWidth + intercept];
      if (votes < minimumVotes) continue;
      let localMaximum = true;
      for (let ds = -1; ds <= 1 && localMaximum; ds += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (ds === 0 && dx === 0) continue;
          if (accumulator[(slopeIndex + ds) * regionWidth + intercept + dx] > votes) {
            localMaximum = false;
            break;
          }
        }
      }
      if (localMaximum) peaks.push({ slopeIndex, intercept, votes });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);

  const models = [];
  for (const peak of peaks) {
    const xBottom = xMin + peak.intercept;
    if (xBottom < targetXMin || xBottom > targetXMax) continue;
    const slope = slopes[peak.slopeIndex];
    const boundaryRun = runs.find((run) => (
      peak.intercept >= run.start - 8 && peak.intercept <= run.end + 8
    ));
    if (!boundaryRun) continue;
    const width = Math.max(2, Math.min(boundaryRun.width + 2, 12));
    const sampleCount = Math.min(9, Math.max(3, width));
    let weightedDensity = 0;
    let totalWeight = 0;
    let supportedRows = 0;
    let measuredRows = 0;
    for (let k = 0; k < bandDepth; k += 2) {
      const localY = bandDepth - 1 - k;
      const projectedCenter = xBottom - slope * k;
      let hits = 0;
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const fraction = sampleCount === 1 ? 0 : sample / (sampleCount - 1) - 0.5;
        const sourceX = Math.round(projectedCenter + fraction * (width + 2));
        const localX = sourceX - xMin;
        if (localX >= 0 && localX < regionWidth && mask[localY * regionWidth + localX]) hits += 1;
      }
      const density = hits / sampleCount;
      const weight = 0.55 + 0.45 * (1 - k / bandDepth);
      weightedDensity += density * weight;
      totalWeight += weight;
      if (density >= 0.2) supportedRows += 1;
      measuredRows += 1;
    }
    const densityScore = weightedDensity / Math.max(1, totalWeight);
    const support = supportedRows / Math.max(1, measuredRows);
    const confidence = densityScore * 0.58 + support * 0.32
      + clamp(peak.votes / Math.max(1, bandDepth), 0, 1) * 0.1;
    if (confidence < 0.31 || support < 0.3) continue;
    const duplicate = models.some((other) => (
      Math.abs(xBottom - other.xBottom) < Math.max(width, other.width) * 0.5
      && Math.abs(slope - other.slope) < 0.32
    ));
    if (duplicate) continue;
    models.push({
      xBottom,
      slope,
      width,
      confidence,
      support,
      bandDepth,
      votes: peak.votes,
    });
    if (models.length >= 24) break;
  }

  if (models.length === 0) {
    for (const run of runs) {
      const center = xMin + (run.start + run.end) / 2;
      if (center < targetXMin || center > targetXMax) continue;
      const sampleCount = Math.min(9, Math.max(3, run.width + 2));
      let best = null;
      for (let slope = slopeMin; slope <= slopeMax + 1e-6; slope += slopeStep) {
      let weightedDensity = 0;
      let totalWeight = 0;
      let supportedRows = 0;
      let measuredRows = 0;
      for (let k = 0; k < bandDepth; k += 2) {
        const localY = bandDepth - 1 - k;
        const projectedCenter = center - slope * k;
        let hits = 0;
        for (let sample = 0; sample < sampleCount; sample += 1) {
          const fraction = sampleCount === 1 ? 0 : sample / (sampleCount - 1) - 0.5;
          const sourceX = Math.round(projectedCenter + fraction * (run.width + 4));
          const localX = sourceX - xMin;
          if (localX >= 0 && localX < regionWidth && mask[localY * regionWidth + localX]) hits += 1;
        }
        const density = hits / sampleCount;
        const weight = 0.55 + 0.45 * (1 - k / bandDepth);
        weightedDensity += density * weight;
        totalWeight += weight;
        if (density >= 0.2) supportedRows += 1;
        measuredRows += 1;
      }
      const densityScore = weightedDensity / Math.max(1, totalWeight);
      const support = supportedRows / Math.max(1, measuredRows);
      const confidence = densityScore * 0.64 + support * 0.36;
      if (!best || confidence > best.confidence) best = { slope, confidence, support, densityScore };
      }
      if (best && best.confidence >= 0.34 && best.support >= 0.34) {
        models.push({
          xBottom: center,
          slope: best.slope,
          width: Math.max(2, run.width + 2),
          confidence: best.confidence,
          support: best.support,
          bandDepth,
        });
      }
    }
  }

  models.sort((a, b) => b.confidence - a.confidence);
  const selected = [];
  for (const model of models) {
    const duplicate = selected.some((other) =>
      Math.abs(model.xBottom - other.xBottom) < Math.max(model.width, other.width) * 0.65
      && Math.abs(model.slope - other.slope) < 0.32
    );
    if (!duplicate) selected.push(model);
    if (selected.length >= 24) break;
  }
  const slopeClusters = [];
  for (const model of [...selected].sort((a, b) => a.slope - b.slope)) {
    let cluster = slopeClusters.find((candidate) => Math.abs(model.slope - candidate.meanSlope) <= 0.7);
    if (!cluster) {
      cluster = { models: [], meanSlope: model.slope, score: 0 };
      slopeClusters.push(cluster);
    }
    cluster.models.push(model);
    const totalWeight = cluster.models.reduce((sum, item) => sum + item.confidence, 0);
    cluster.meanSlope = cluster.models.reduce((sum, item) => sum + item.slope * item.confidence, 0) / totalWeight;
    cluster.score += model.confidence * model.confidence * model.support;
  }
  slopeClusters.sort((a, b) => b.score - a.score);
  const strongestCluster = slopeClusters[0];
  const acceptedClusters = strongestCluster
    ? slopeClusters.filter((cluster, index) => index === 0 || (
      cluster.models.length >= 2 && cluster.score >= strongestCluster.score * 0.78
    ))
    : [];
  const coherentModels = acceptedClusters.flatMap((cluster) => cluster.models);
  coherentModels.sort((a, b) => a.xBottom - b.xBottom);

  return {
    enabled: true,
    models: coherentModels,
    backgroundColor,
    bandDepth,
    extensionDepth,
    sourceCenter,
    sourceRadius,
    sensitivity,
    threshold,
    region: { xMin, xMax, yMin, width: regionWidth, height: bandDepth },
  };
}

export function sampleBannerWithContinuation(image, x, y, continuation, fill = [0, 0, 0, 255]) {
  if (x >= 0 && y >= 0 && x <= image.width - 1 && y <= image.height - 1) {
    return sampleBilinear(image, x, y, fill);
  }
  if (!continuation?.enabled || y < image.height - 1 || x < 0 || x >= image.width) return fill;
  const depth = y - (image.height - 1);
  const background = continuation.backgroundColor || fill;
  const maxDepth = Math.max(1, continuation.extensionDepth);
  const depthFade = Math.max(0, 1 - Math.pow(depth / (maxDepth * 1.25), 2.2));

  // Base: weighted smear of the last few real banner rows at this x position.
  // This is always better than flat background fill — even for photos with no
  // detectable straight lines, extending actual edge content looks correct
  // instead of cutting off to a solid colour. Background fill only appears at
  // the very deepest fade point when the content truly runs out.
  const smearRows = Math.min(5, image.height);
  let smearR = 0, smearG = 0, smearB = 0, smearW = 0;
  for (let row = 0; row < smearRows; row++) {
    const w = smearRows - row; // most-recent rows weighted highest
    const c = sampleBilinear(image, x, image.height - 1 - row, background);
    smearR += c[0] * w; smearG += c[1] * w; smearB += c[2] * w; smearW += w;
  }
  smearR /= smearW; smearG /= smearW; smearB /= smearW;

  // Blend smeared content towards background as depth increases
  let blendR = smearR * depthFade + background[0] * (1 - depthFade);
  let blendG = smearG * depthFade + background[1] * (1 - depthFade);
  let blendB = smearB * depthFade + background[2] * (1 - depthFade);

  // Layer detected geometric lines on top of the smeared base
  for (const model of continuation.models || []) {
    const expectedX = model.xBottom + model.slope * depth;
    const offset = x - expectedX;
    const halfWidth = model.width / 2;
    const feather = Math.max(1.5, Math.min(5, halfWidth * 0.5));
    const distance = Math.abs(offset);
    if (distance > halfWidth + feather) continue;
    // Sample from the line's own centre axis upstream — avoids sampling
    // outside narrow features where the lateral offset overshoots into background.
    const upstream = Math.min(Math.max(0, depth), Math.max(1, model.bandDepth - 2));
    const sampleX = model.xBottom - model.slope * upstream;
    const sampleY = image.height - 1 - upstream;
    const color = sampleBilinear(image, sampleX, sampleY, background);
    const edgeAlpha = 1 - smoothstep(halfWidth, halfWidth + feather, distance);
    const alpha = edgeAlpha * clamp(model.confidence * 1.4, 0.4, 1) * depthFade;
    // Mix towards the line colour — stacks correctly when multiple lines overlap
    blendR += (color[0] - blendR) * alpha;
    blendG += (color[1] - blendG) * alpha;
    blendB += (color[2] - blendB) * alpha;
  }
  return [
    clamp(blendR, 0, 255),
    clamp(blendG, 0, 255),
    clamp(blendB, 0, 255),
    255,
  ];
}

export function sourceMappingFromLayout({ banner, bannerRect, avatar }) {
  const transform = computeCoverTransform(banner.width, banner.height, bannerRect);
  const imageRadius = Math.max(1, avatar.outerRadius - avatar.padding);
  const center = screenToSource(avatar.centerX, avatar.centerY, transform);
  return {
    centerX: center.x,
    centerY: center.y,
    radiusX: imageRadius / transform.scaleX,
    radiusY: imageRadius / transform.scaleY,
  };
}

function sourceFromMapping(mapping, qx, qy) {
  return {
    x: mapping.centerX + qx * mapping.radiusX,
    y: mapping.centerY + qy * mapping.radiusY,
  };
}

function mappingScore(meanDifference) {
  return Math.round(100 * Math.exp(-3.5 * meanDifference / 255));
}

function colorDifference(a, b) {
  return (
    Math.abs(a[0] - b[0])
    + Math.abs(a[1] - b[1])
    + Math.abs(a[2] - b[2])
  ) / 3;
}

function gradientDifference(centerA, neighborA, centerB, neighborB) {
  return (
    Math.abs((centerA[0] - neighborA[0]) - (centerB[0] - neighborB[0]))
    + Math.abs((centerA[1] - neighborA[1]) - (centerB[1] - neighborB[1]))
    + Math.abs((centerA[2] - neighborA[2]) - (centerB[2] - neighborB[2]))
  ) / 3;
}

function structuralPointDifference({
  actual,
  actualRadial,
  actualTangent,
  expected,
  expectedRadial,
  expectedTangent,
}) {
  const expectedEdge = Math.max(
    colorDifference(expected, expectedRadial),
    colorDifference(expected, expectedTangent),
  );
  const actualEdge = Math.max(
    colorDifference(actual, actualRadial),
    colorDifference(actual, actualTangent),
  );
  const featureWeight = 0.12 + Math.min(4, Math.max(expectedEdge, actualEdge * 0.65) / 18);
  const mismatch = colorDifference(actual, expected) + 0.7 * (
    gradientDifference(actual, actualRadial, expected, expectedRadial)
    + gradientDifference(actual, actualTangent, expected, expectedTangent)
  ) / 2;
  return { mismatch, featureWeight, expectedEdge };
}

export function buildCrossPlatformAdjustedBanner({
  banner,
  primaryMapping,
  secondaryMapping,
  primaryOuterRatio = 1,
  secondaryOuterRatio = 1,
  continuation = null,
  pageColor = [0, 0, 0],
  innerStart = 0.78,
  fullStart = 0.86,
  fadeRatio = 0.13,
  minFade = 6,
  maxFade = 32,
}) {
  const data = new Uint8ClampedArray(banner.data);
  const fill = [...pageColor, 255];
  const primaryRadius = Math.max(1, (primaryMapping.radiusX + primaryMapping.radiusY) / 2);
  const secondaryRadius = Math.max(1, (secondaryMapping.radiusX + secondaryMapping.radiusY) / 2);
  const primaryOuterRadius = primaryRadius * Math.max(1, primaryOuterRatio);
  const secondaryOuterRadius = secondaryRadius * Math.max(1, secondaryOuterRatio);
  const fadeWidth = clamp(secondaryRadius * fadeRatio, minFade, maxFade);
  const reach = secondaryOuterRadius + fadeWidth + 2;
  const xMin = Math.max(0, Math.floor(secondaryMapping.centerX - reach));
  const xMax = Math.min(banner.width - 1, Math.ceil(secondaryMapping.centerX + reach));
  const yMin = Math.max(0, Math.floor(secondaryMapping.centerY - reach));
  const yMax = Math.min(banner.height - 1, Math.ceil(secondaryMapping.centerY + reach));
  let changedPixels = 0;
  let primaryVisibleChangedPixels = 0;
  let secondaryVisibleChangedPixels = 0;
  let totalDelta = 0;
  let maximumDelta = 0;

  for (let y = yMin; y <= yMax; y += 1) {
    for (let x = xMin; x <= xMax; x += 1) {
      const dx = x - secondaryMapping.centerX;
      const dy = y - secondaryMapping.centerY;
      const distance = Math.hypot(dx, dy);
      const normalizedRadius = distance / secondaryRadius;
      const innerWeight = smoothstep(innerStart, fullStart, normalizedRadius);
      const outerWeight = 1 - smoothstep(secondaryOuterRadius, secondaryOuterRadius + fadeWidth, distance);
      const weight = innerWeight * outerWeight;
      if (weight <= 0.0001) continue;

      const canonicalX = primaryMapping.centerX + dx * primaryMapping.radiusX / secondaryMapping.radiusX;
      const canonicalY = primaryMapping.centerY + dy * primaryMapping.radiusY / secondaryMapping.radiusY;
      const canonical = sampleBannerWithContinuation(
        banner, canonicalX, canonicalY, continuation, fill,
      );
      const index = (y * banner.width + x) * 4;
      const original = [
        banner.data[index],
        banner.data[index + 1],
        banner.data[index + 2],
        banner.data[index + 3],
      ];
      const output = [
        canonical[0] * weight + original[0] * (1 - weight),
        canonical[1] * weight + original[1] * (1 - weight),
        canonical[2] * weight + original[2] * (1 - weight),
        canonical[3] * weight + original[3] * (1 - weight),
      ];
      const delta = colorDifference(output, original);
      data[index] = output[0];
      data[index + 1] = output[1];
      data[index + 2] = output[2];
      data[index + 3] = output[3];
      if (delta <= 2) continue;

      changedPixels += 1;
      totalDelta += delta;
      maximumDelta = Math.max(maximumDelta, delta);
      if (Math.hypot(x - primaryMapping.centerX, y - primaryMapping.centerY) > primaryOuterRadius) {
        primaryVisibleChangedPixels += 1;
      }
      if (distance > secondaryOuterRadius) secondaryVisibleChangedPixels += 1;
    }
  }

  const bannerPixels = Math.max(1, banner.width * banner.height);
  const changedFraction = changedPixels / bannerPixels;
  const primaryVisibleChangeFraction = primaryVisibleChangedPixels / bannerPixels;
  const secondaryVisibleChangeFraction = secondaryVisibleChangedPixels / bannerPixels;
  // The current Compose avatar is farther down/right than the legacy view,
  // so its valid correction annulus exposes a slightly larger sliver outside
  // the desktop avatar. Keep the cap narrow, but allow the measured 0.51%
  // current-layout footprint instead of rejecting a structurally clean pair.
  const safe = changedFraction <= 0.04
    && primaryVisibleChangeFraction <= 0.006
    && secondaryVisibleChangeFraction <= 0.012;
  return {
    width: banner.width,
    height: banner.height,
    data,
    diagnostics: {
      version: "pair-aware-annulus-1.1.0",
      safe,
      fadeWidthSourcePx: fadeWidth,
      changedPixels,
      changedFraction,
      primaryVisibleChangedPixels,
      primaryVisibleChangeFraction,
      secondaryVisibleChangedPixels,
      secondaryVisibleChangeFraction,
      meanChangedDelta: totalDelta / Math.max(1, changedPixels),
      maximumDelta,
      innerStart,
      fullStart,
      primaryOuterRatio,
      secondaryOuterRatio,
      primaryMapping,
      secondaryMapping,
    },
  };
}

function rgbLuminance(color) {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function localFeatureWeight(image, x, y, fill, continuation = null) {
  const center = sampleBannerWithContinuation(image, x, y, continuation, fill);
  const neighborStep = 2;
  const neighbors = [
    sampleBannerWithContinuation(image, x - neighborStep, y, continuation, fill),
    sampleBannerWithContinuation(image, x + neighborStep, y, continuation, fill),
    sampleBannerWithContinuation(image, x, y - neighborStep, continuation, fill),
    sampleBannerWithContinuation(image, x, y + neighborStep, continuation, fill),
  ];
  const edge = Math.max(...neighbors.map((neighbor) => colorDifference(center, neighbor)));
  const luminance = rgbLuminance(center);
  const chroma = Math.max(center[0], center[1], center[2]) - Math.min(center[0], center[1], center[2]);
  const darkStroke = clamp((138 - luminance) / 115, 0, 1);
  return Math.max(
    smoothstep(12, 62, edge),
    smoothstep(0.2, 0.78, darkStroke) * 0.88,
    smoothstep(34, 92, chroma) * 0.28,
  );
}

export function buildPairAwareFeatureBanner({
  banner,
  referenceBanner = banner,
  referenceMapping,
  platformMapping,
  platformBannerRect = null,
  platformAvatar = null,
  referenceContinuation = null,
  pageColor = [0, 0, 0],
  platformOuterRatio = 1,
  reachRatio = 0.95,
  radialFeatherRatio = 0.24,
  upperFadeStart = 2.0,
  upperFadeEnd = 2.0,
  innerLead = 0.04,
  fullLead = 0.005,
  featureStrength = 1,
  // excludeMapping: if provided, any source pixel within excludeRadiusRatio * radius of
  // this mapping's center is SKIPPED. Use this to protect the secondary platform's avatar
  // reading zone from being over-painted (which causes double-image artifacts).
  excludeMapping = null,
  excludeRadiusRatio = 1.02,
}) {
  const data = new Uint8ClampedArray(banner.data);
  const fill = [...pageColor, 255];
  const platformRadius = Math.max(1, (platformMapping.radiusX + platformMapping.radiusY) / 2);
  const platformOuterRadius = platformRadius * Math.max(1, platformOuterRatio);
  const reach = platformRadius * Math.max(0.12, reachRatio);
  const xMin = Math.max(0, Math.floor(platformMapping.centerX - platformOuterRadius - reach - 2));
  const xMax = Math.min(banner.width - 1, Math.ceil(platformMapping.centerX + platformOuterRadius + reach + 2));
  const yMin = Math.max(0, Math.floor(platformMapping.centerY - platformOuterRadius - reach - 2));
  const yMax = Math.min(banner.height - 1, Math.ceil(platformMapping.centerY + platformOuterRadius + reach + 2));
  const start = Math.max(0, platformOuterRatio - innerLead);
  const full = platformOuterRatio + fullLead;
  const end = platformOuterRatio + reachRatio;
  const fadeStart = Math.max(full, end - radialFeatherRatio);
  const platformTransform = platformBannerRect
    ? computeCoverTransform(banner.width, banner.height, platformBannerRect)
    : null;
  let changedPixels = 0;
  let totalDelta = 0;
  let maximumDelta = 0;
  let featureWeightedPixels = 0;
  let visibleCandidatePixels = 0;

  for (let y = yMin; y <= yMax; y += 1) {
    for (let x = xMin; x <= xMax; x += 1) {
      const qx = (x - platformMapping.centerX) / platformMapping.radiusX;
      const qy = (y - platformMapping.centerY) / platformMapping.radiusY;
      const normalizedRadius = Math.hypot(qx, qy);
      if (normalizedRadius < start || normalizedRadius > end) continue;

      // Protect the secondary platform's avatar zone — any pixel inside this zone must
      // stay original so the secondary platform's avatar crop remains uncorrupted.
      if (excludeMapping) {
        const exDx = x - excludeMapping.centerX;
        const exDy = y - excludeMapping.centerY;
        const exDist = Math.hypot(exDx, exDy);
        const exRadius = (excludeMapping.radiusX + excludeMapping.radiusY) / 2 * excludeRadiusRatio;
        if (exDist <= exRadius) continue;
      }

      if (platformTransform && platformBannerRect && platformAvatar) {
        const screen = sourceToScreen(x, y, platformTransform);
        if (screen.x < platformBannerRect.x || screen.x > platformBannerRect.x + platformBannerRect.width
          || screen.y < platformBannerRect.y || screen.y > platformBannerRect.y + platformBannerRect.height) continue;
        const distanceToPlatformAvatar = Math.hypot(
          screen.x - platformAvatar.centerX,
          screen.y - platformAvatar.centerY,
        );
        if (distanceToPlatformAvatar <= platformAvatar.outerRadius) continue;
      }
      visibleCandidatePixels += 1;

      const radialWeight = smoothstep(start, full, normalizedRadius)
        * (1 - smoothstep(fadeStart, end, normalizedRadius));
      const upperWeight = 1 - smoothstep(upperFadeStart, upperFadeEnd, qy);
      if (radialWeight <= 0 || upperWeight <= 0) continue;

      const referenceX = referenceMapping.centerX + qx * referenceMapping.radiusX;
      const referenceY = referenceMapping.centerY + qy * referenceMapping.radiusY;
      const referenceColor = sampleBannerWithContinuation(
        referenceBanner, referenceX, referenceY, referenceContinuation, fill,
      );
      const originalIndex = (y * banner.width + x) * 4;
      const originalColor = [
        banner.data[originalIndex],
        banner.data[originalIndex + 1],
        banner.data[originalIndex + 2],
        banner.data[originalIndex + 3],
      ];
      const referenceFeature = localFeatureWeight(
        referenceBanner, referenceX, referenceY, fill, referenceContinuation,
      );
      const originalFeature = localFeatureWeight(banner, x, y, fill);
      const colorDiff = colorDifference(referenceColor, originalColor);
      const structuralDelta = smoothstep(8, 38, colorDiff);
      const featureWeight = Math.max(referenceFeature, originalFeature * 0.55) * structuralDelta;
      // Ensure even smooth/gradient areas get corrected: use a baseline
      // proportional to the actual color difference so the correction applies
      // everywhere the two mappings disagree, not just at visible features.
      const baselineWeight = smoothstep(0.5, 4.0, colorDiff);
      const combinedFeature = Math.max(featureWeight, baselineWeight);
      const weight = clamp(radialWeight * upperWeight * combinedFeature * featureStrength, 0, 1);
      if (weight <= 0.002) continue;

      const output = [
        referenceColor[0] * weight + originalColor[0] * (1 - weight),
        referenceColor[1] * weight + originalColor[1] * (1 - weight),
        referenceColor[2] * weight + originalColor[2] * (1 - weight),
        referenceColor[3] * weight + originalColor[3] * (1 - weight),
      ];
      const delta = colorDifference(output, originalColor);
      data[originalIndex] = output[0];
      data[originalIndex + 1] = output[1];
      data[originalIndex + 2] = output[2];
      data[originalIndex + 3] = output[3];
      featureWeightedPixels += weight;
      if (delta <= 2) continue;
      changedPixels += 1;
      totalDelta += delta;
      maximumDelta = Math.max(maximumDelta, delta);
    }
  }

  const changedFraction = changedPixels / Math.max(1, banner.width * banner.height);
  return {
    width: banner.width,
    height: banner.height,
    data,
    diagnostics: {
      version: "pair-aware-feature-repair-2.0.0",
      changedPixels,
      changedFraction,
      meanChangedDelta: totalDelta / Math.max(1, changedPixels),
      maximumDelta,
      featureWeightedPixels,
      visibleCandidatePixels,
      platformOuterRatio,
      reachRatio,
      radialFeatherRatio,
      innerLead,
      fullLead,
      featureStrength,
      excludeRadiusRatio,
      referenceMapping,
      platformMapping,
    },
  };
}

function compareSourceMappings({ banner, actualMapping, expectedMapping, continuation, fill, angles, rings }) {
  let weightedDifference = 0;
  let totalWeight = 0;
  let featureSignal = 0;
  const tangentStep = (Math.PI * 2) / angles;
  const radialStep = 0.012;
  for (const ring of rings) {
    for (let index = 0; index < angles; index += 1) {
      const angle = (index / angles) * Math.PI * 2;
      const qx = Math.cos(angle) * ring.radius;
      const qy = Math.sin(angle) * ring.radius;
      const radialRadius = Math.max(0, ring.radius - radialStep);
      const radialQx = Math.cos(angle) * radialRadius;
      const radialQy = Math.sin(angle) * radialRadius;
      const tangentQx = Math.cos(angle + tangentStep) * ring.radius;
      const tangentQy = Math.sin(angle + tangentStep) * ring.radius;
      const sample = (mapping, x, y) => {
        const point = sourceFromMapping(mapping, x, y);
        return sampleBannerWithContinuation(banner, point.x, point.y, continuation, fill);
      };
      const point = structuralPointDifference({
        actual: sample(actualMapping, qx, qy),
        actualRadial: sample(actualMapping, radialQx, radialQy),
        actualTangent: sample(actualMapping, tangentQx, tangentQy),
        expected: sample(expectedMapping, qx, qy),
        expectedRadial: sample(expectedMapping, radialQx, radialQy),
        expectedTangent: sample(expectedMapping, tangentQx, tangentQy),
      });
      const weight = point.featureWeight * ring.weight;
      weightedDifference += point.mismatch * weight;
      totalWeight += weight;
      featureSignal += point.expectedEdge * ring.weight;
    }
  }
  const meanDifference = weightedDifference / Math.max(1, totalWeight);
  return {
    meanDifference,
    score: mappingScore(meanDifference),
    featureSignal: featureSignal / Math.max(1, angles),
  };
}

export function optimizeSharedAffineMapping({
  banner,
  primaryMapping,
  secondaryMapping,
  continuation = null,
  pageColor = [0, 0, 0],
  angles = 96,
}) {
  const fill = [...pageColor, 255];
  const rings = [
    { radius: 0.86, weight: 0.14 },
    { radius: 0.91, weight: 0.2 },
    { radius: 0.95, weight: 0.26 },
    { radius: 0.985, weight: 0.4 },
  ];
  const radiusFor = (mapping) => (mapping.radiusX + mapping.radiusY) / 2;
  const primary = {
    centerX: primaryMapping.centerX,
    centerY: primaryMapping.centerY,
    radiusX: radiusFor(primaryMapping),
    radiusY: radiusFor(primaryMapping),
  };
  const secondary = {
    centerX: secondaryMapping.centerX,
    centerY: secondaryMapping.centerY,
    radiusX: radiusFor(secondaryMapping),
    radiusY: radiusFor(secondaryMapping),
  };
  const evaluate = (mapping, weight) => {
    const primaryResult = compareSourceMappings({
      banner, actualMapping: mapping, expectedMapping: primary, continuation, fill, angles, rings,
    });
    const secondaryResult = compareSourceMappings({
      banner, actualMapping: mapping, expectedMapping: secondary, continuation, fill, angles, rings,
    });
    const primaryMean = primaryResult.meanDifference;
    const secondaryMean = secondaryResult.meanDifference;
    return {
      mapping,
      weight,
      primaryMean,
      secondaryMean,
      worstMean: Math.max(primaryMean, secondaryMean),
      averageMean: (primaryMean + secondaryMean) / 2,
      primaryScore: primaryResult.score,
      secondaryScore: secondaryResult.score,
      featureSignal: Math.max(primaryResult.featureSignal, secondaryResult.featureSignal),
    };
  };
  const better = (candidate, current) => !current
    || candidate.worstMean < current.worstMean - 1e-6
    || (Math.abs(candidate.worstMean - current.worstMean) <= 1e-6
      && candidate.averageMean < current.averageMean);
  let balanced = null;
  let primaryCandidate = null;
  for (let step = 0; step <= 40; step += 1) {
    const weight = step / 40;
    const mapping = {
      centerX: primary.centerX * (1 - weight) + secondary.centerX * weight,
      centerY: primary.centerY * (1 - weight) + secondary.centerY * weight,
      radiusX: primary.radiusX * (1 - weight) + secondary.radiusX * weight,
      radiusY: primary.radiusY * (1 - weight) + secondary.radiusY * weight,
    };
    const candidate = evaluate(mapping, weight);
    if (step === 0) primaryCandidate = candidate;
    if (better(candidate, balanced)) balanced = candidate;
  }

  // A dark/flat perimeter can make a visibly wrong crop look numerically good.
  // Never sacrifice both layouts unless the feature-weighted locked ring is
  // genuinely strong on both. When it is not, preserve the exact desktop crop.
  const integrityFloor = 84;
  const feasible = balanced.primaryScore >= integrityFloor && balanced.secondaryScore >= integrityFloor;
  const best = feasible ? balanced : primaryCandidate;
  const centerDelta = Math.hypot(
    secondary.centerX - primary.centerX,
    secondary.centerY - primary.centerY,
  );
  const meanRadius = Math.max(1, (primary.radiusX + secondary.radiusX) / 2);
  const geometryConflict = centerDelta / meanRadius
    + Math.abs(Math.log(Math.max(1, secondary.radiusX) / Math.max(1, primary.radiusX)));
  return {
    ...best,
    equivalentWeight: best.weight,
    sampleCount: angles * rings.length,
    feasible,
    protectedPrimary: !feasible,
    integrityFloor,
    geometryConflict,
    balancedCandidate: {
      weight: balanced.weight,
      primaryScore: balanced.primaryScore,
      secondaryScore: balanced.secondaryScore,
      worstScore: Math.min(balanced.primaryScore, balanced.secondaryScore),
      mapping: balanced.mapping,
    },
  };
}

function transformedPortraitCoordinate(qx, qy, portrait) {
  const x = qx - (portrait.offsetX ?? 0);
  const y = qy - (portrait.offsetY ?? 0);
  const radians = -((portrait.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scale = Math.max(0.01, portrait.scale ?? 1);
  return {
    x: (x * cos - y * sin) / scale,
    y: (x * sin + y * cos) / scale,
  };
}

function adjustPortrait(color, controls) {
  const luminance = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
  const saturation = controls.saturation ?? 1;
  const contrast = controls.contrast ?? 1;
  const black = controls.blackLevel ?? 0;
  return [0, 1, 2].map((channel) => {
    let value = luminance + (color[channel] - luminance) * saturation;
    value = (value - 127.5) * contrast + 127.5;
    value = (value - black) * (255 / Math.max(1, 255 - black));
    return clamp(value, 0, 255);
  }).concat(color[3]);
}

function linkedFrameSpans(source, frameAspect) {
  const sourceAspect = source.width / Math.max(1, source.height);
  if (sourceAspect >= frameAspect) {
    return {
      halfWidth: ((source.height - 1) * frameAspect) / 2,
      halfHeight: (source.height - 1) / 2,
    };
  }
  return {
    halfWidth: (source.width - 1) / 2,
    halfHeight: (source.width - 1) / (2 * frameAspect),
  };
}

function linkedArtworkSample(source, qx, qy, controls, fill, frameAspect = 1, clampOutside = false) {
  const point = transformedPortraitCoordinate(qx, qy, controls);
  const spans = linkedFrameSpans(source, Math.max(0.01, frameAspect));
  const sourceX = (source.width - 1) / 2 + point.x * spans.halfWidth;
  const sourceY = (source.height - 1) / 2 + point.y * spans.halfHeight;
  const covered = sourceX >= 0 && sourceY >= 0
    && sourceX <= source.width - 1 && sourceY <= source.height - 1;
  const sampleX = clampOutside ? clamp(sourceX, 0, source.width - 1) : sourceX;
  const sampleY = clampOutside ? clamp(sourceY, 0, source.height - 1) : sourceY;
  const sampled = adjustPortrait(sampleBilinear(source, sampleX, sampleY, fill), controls);
  const alpha = clamp((sampled[3] / 255) * (controls.opacity ?? 1), 0, 1);
  return {
    covered,
    sourceX,
    sourceY,
    color: [
      sampled[0] * alpha + fill[0] * (1 - alpha),
      sampled[1] * alpha + fill[1] * (1 - alpha),
      sampled[2] * alpha + fill[2] * (1 - alpha),
      255,
    ],
  };
}

export function buildLinkedProfile({
  source,
  controls,
  outputSize = 400,
  shape = "circle",
  pageColor = [0, 0, 0],
  opaqueCorners = true,
}) {
  if (!source) throw new Error("A linked profile source is required");
  const size = Math.max(1, Math.round(outputSize));
  const data = new Uint8ClampedArray(size * size * 4);
  const fill = [...pageColor, 255];
  let uncoveredPixels = 0;
  let visiblePixels = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const qx = (x + 0.5 - size / 2) / (size / 2);
      const qy = (y + 0.5 - size / 2) / (size / 2);
      const index = (y * size + x) * 4;
      if (shapeRadius(qx, qy, shape) > 1) {
        data[index] = fill[0];
        data[index + 1] = fill[1];
        data[index + 2] = fill[2];
        data[index + 3] = opaqueCorners ? 255 : 0;
        continue;
      }
      const sample = linkedArtworkSample(source, qx, qy, controls, fill, 1);
      visiblePixels += 1;
      if (!sample.covered) uncoveredPixels += 1;
      data.set(sample.color, index);
    }
  }

  return {
    width: size,
    height: size,
    data,
    diagnostics: {
      mode: "linked-profile",
      uncoveredPixels,
      uncoveredFraction: uncoveredPixels / Math.max(1, visiblePixels),
      controls: { ...controls },
    },
  };
}

export function buildLinkedBanner({
  source,
  mapping,
  controls,
  outputWidth = 1500,
  outputHeight = 500,
  pageColor = [0, 0, 0],
  sourceFrameAspect = null,
  clampOutside = false,
}) {
  if (!source) throw new Error("A linked banner source is required");
  if (!mapping || mapping.radiusX <= 0 || mapping.radiusY <= 0) {
    throw new Error("A valid linked banner mapping is required");
  }
  const width = Math.max(1, Math.round(outputWidth));
  const height = Math.max(1, Math.round(outputHeight));
  const data = new Uint8ClampedArray(width * height * 4);
  const fill = [...pageColor, 255];
  let uncoveredPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const qx = (x + 0.5 - mapping.centerX) / mapping.radiusX;
      const qy = (y + 0.5 - mapping.centerY) / mapping.radiusY;
      const sample = linkedArtworkSample(
        source,
        qx,
        qy,
        controls,
        fill,
        sourceFrameAspect ?? (width / height),
        clampOutside,
      );
      if (!sample.covered) uncoveredPixels += 1;
      data.set(sample.color, (y * width + x) * 4);
    }
  }

  return {
    width,
    height,
    data,
    diagnostics: {
      mode: "linked-banner",
      uncoveredPixels,
      uncoveredFraction: uncoveredPixels / Math.max(1, width * height),
      mapping: { ...mapping },
      controls: { ...controls },
      sourceFrameAspect: sourceFrameAspect ?? (width / height),
      clampOutside,
    },
  };
}

export function shapeRadius(qx, qy, shape) {
  if (shape === "square") return Math.max(Math.abs(qx), Math.abs(qy));
  if (shape === "rounded") {
    const corner = 0.14;
    const ax = Math.abs(qx);
    const ay = Math.abs(qy);
    const dx = Math.max(ax - (1 - corner), 0);
    const dy = Math.max(ay - (1 - corner), 0);
    const outsideCorner = Math.hypot(dx, dy) / corner;
    if (dx > 0 || dy > 0) return Math.max(ax, ay, outsideCorner);
    return Math.max(ax, ay);
  }
  return Math.hypot(qx, qy);
}

export function buildAvatar({
  banner,
  portrait,
  outputSize = 400,
  bannerRect,
  avatar,
  mode = "banner",
  shape = "circle",
  pageColor = [0, 0, 0],
  opaqueCorners = true,
  lockStart = 0.85,
  featherWidth = 0.2,
  portraitControls,
  continuation = null,
  compatibility = null,
}) {
  const transform = computeCoverTransform(banner.width, banner.height, bannerRect);
  const compatibilityActive = Boolean(compatibility?.enabled && compatibility.bannerRect && compatibility.avatar);
  const compatibilitySourceMapping = compatibilityActive ? compatibility.sourceMapping || null : null;
  const secondaryTransform = compatibilityActive
    ? computeCoverTransform(banner.width, banner.height, compatibility.bannerRect)
    : null;
  const compatibilityWeight = compatibilityActive ? clamp(compatibility.weight ?? 0.4, 0, 1) : 0;
  const data = new Uint8ClampedArray(outputSize * outputSize * 4);
  const fill = [...pageColor, 255];
  const innerEnd = clamp(lockStart - featherWidth, 0.05, lockStart);
  const imageRadius = Math.max(1, avatar.outerRadius - avatar.padding);
  const secondaryImageRadius = compatibilityActive
    ? Math.max(1, compatibility.avatar.outerRadius - compatibility.avatar.padding)
    : 0;
  let outsideBanner = 0;
  let lockedSamples = 0;
  let portraitAtLock = 0;
  let sourceShiftTotal = 0;
  let sourceShiftSamples = 0;

  for (let v = 0; v < outputSize; v += 1) {
    for (let u = 0; u < outputSize; u += 1) {
      const qx = (u + 0.5 - outputSize / 2) / (outputSize / 2);
      const qy = (v + 0.5 - outputSize / 2) / (outputSize / 2);
      const radius = shapeRadius(qx, qy, shape);
      const index = (v * outputSize + u) * 4;

      if (radius > 1) {
        data[index] = pageColor[0];
        data[index + 1] = pageColor[1];
        data[index + 2] = pageColor[2];
        data[index + 3] = opaqueCorners ? 255 : 0;
        continue;
      }

      const screenX = avatar.centerX + qx * imageRadius;
      const screenY = avatar.centerY + qy * imageRadius;
      const primarySource = screenToSource(screenX, screenY, transform);
      let source = primarySource;
      if (compatibilityActive) {
        if (compatibilitySourceMapping) {
          source = sourceFromMapping(compatibilitySourceMapping, qx, qy);
        } else {
          const secondaryScreenX = compatibility.avatar.centerX + qx * secondaryImageRadius;
          const secondaryScreenY = compatibility.avatar.centerY + qy * secondaryImageRadius;
          const secondarySource = screenToSource(secondaryScreenX, secondaryScreenY, secondaryTransform);
          // Keep one transform across the complete avatar. Because both source
          // mappings are affine, a constant interpolation remains affine: lines
          // stay straight and shapes cannot bend merely to improve a seam score.
          const effectiveCompatibilityWeight = compatibilityWeight;
          source = {
            x: primarySource.x * (1 - effectiveCompatibilityWeight) + secondarySource.x * effectiveCompatibilityWeight,
            y: primarySource.y * (1 - effectiveCompatibilityWeight) + secondarySource.y * effectiveCompatibilityWeight,
          };
        }
        sourceShiftTotal += Math.hypot(
          primarySource.x - source.x,
          primarySource.y - source.y,
        );
        sourceShiftSamples += 1;
      }
      const isOutside = source.x < 0 || source.y < 0
        || source.x >= banner.width - 1 || source.y >= banner.height - 1;
      if (isOutside) outsideBanner += 1;
      const sampleContinuation = compatibilityActive
        ? (compatibility.continuation || continuation)
        : continuation;
      const bannerColor = sampleBannerWithContinuation(banner, source.x, source.y, sampleContinuation, fill);
      let output = bannerColor;

      if (mode === "portrait" && portrait) {
        const p = transformedPortraitCoordinate(qx, qy, portraitControls);
        const px = ((p.x + 1) / 2) * (portrait.width - 1);
        const py = ((p.y + 1) / 2) * (portrait.height - 1);
        const portraitColor = adjustPortrait(sampleBilinear(portrait, px, py, [0, 0, 0, 0]), portraitControls);
        const radialWeight = radius <= innerEnd
          ? 1
          : 1 - smoothstep(innerEnd, lockStart, radius);
        const alpha = (portraitColor[3] / 255) * portraitControls.opacity * radialWeight;
        output = [
          portraitColor[0] * alpha + bannerColor[0] * (1 - alpha),
          portraitColor[1] * alpha + bannerColor[1] * (1 - alpha),
          portraitColor[2] * alpha + bannerColor[2] * (1 - alpha),
          255,
        ];
        if (radius >= lockStart) portraitAtLock += alpha;
      }
      if (radius >= lockStart) lockedSamples += 1;

      data[index] = output[0];
      data[index + 1] = output[1];
      data[index + 2] = output[2];
      data[index + 3] = output[3] ?? 255;
    }
  }

  return {
    width: outputSize,
    height: outputSize,
    data,
    diagnostics: {
      outsideBannerFraction: outsideBanner / Math.max(1, outputSize * outputSize),
      portraitAtLock: portraitAtLock / Math.max(1, lockedSamples),
      innerEnd,
      imageRadius,
      transform,
      continuation: continuation ? {
        enabled: continuation.enabled,
        modelCount: continuation.models?.length || 0,
        extensionDepth: continuation.extensionDepth || 0,
      } : null,
      compatibility: compatibilityActive ? {
        enabled: true,
        platform: compatibility.platform || "android",
        weight: compatibilityWeight,
        region: compatibilitySourceMapping
          ? "optimized-uniform-similarity-geometry"
          : "uniform-affine-shared-geometry",
        sourceMapping: compatibilitySourceMapping,
        meanSourceShiftPx: sourceShiftTotal / Math.max(1, sourceShiftSamples),
      } : { enabled: false },
    },
  };
}

export function calculateLayoutSeamScore({
  avatarImage,
  banner,
  bannerRect,
  avatar,
  pageColor = [0, 0, 0],
  continuation = null,
  samples = 360,
  region = "full",
}) {
  const transform = computeCoverTransform(banner.width, banner.height, bannerRect);
  const imageRadius = Math.max(1, avatar.outerRadius - avatar.padding);
  const fill = [...pageColor, 255];
  const rings = [
    { radius: 0.86, weight: 0.14 },
    { radius: 0.91, weight: 0.2 },
    { radius: 0.95, weight: 0.26 },
    { radius: 0.985, weight: 0.4 },
  ];
  let weightedDifference = 0;
  let totalWeight = 0;
  let maximumDifference = 0;
  let featureSignal = 0;
  let pointCount = 0;
  const pointMismatches = [];
  const tangentStep = (Math.PI * 2) / samples;
  const radialStep = 0.012;
  const filteredSample = (sampler, x, y, footprintX, footprintY) => {
    if (footprintX <= 1.1 && footprintY <= 1.1) return sampler(x, y);
    const output = [0, 0, 0, 0];
    const offsets = [-0.34, 0, 0.34];
    for (const oy of offsets) {
      for (const ox of offsets) {
        const color = sampler(x + ox * footprintX, y + oy * footprintY);
        for (let channel = 0; channel < 4; channel += 1) output[channel] += color[channel] ?? 255;
      }
    }
    return output.map((value) => value / 9);
  };
  const avatarFootprint = Math.max(1, avatarImage.width / Math.max(1, imageRadius * 2));
  const bannerFootprintX = Math.max(1, 1 / Math.max(1e-6, transform.scaleX));
  const bannerFootprintY = Math.max(1, 1 / Math.max(1e-6, transform.scaleY));
  const avatarSample = (qx, qy) => filteredSample(
    (x, y) => sampleBilinear(avatarImage, x, y, fill),
    ((qx + 1) * avatarImage.width - 1) / 2,
    ((qy + 1) * avatarImage.height - 1) / 2,
    avatarFootprint,
    avatarFootprint,
  );
  const expectedSample = (qx, qy) => {
    const screenX = avatar.centerX + qx * imageRadius;
    const screenY = avatar.centerY + qy * imageRadius;
    const source = screenToSource(screenX, screenY, transform);
    return filteredSample(
      (x, y) => sampleBannerWithContinuation(banner, x, y, continuation, fill),
      source.x,
      source.y,
      bannerFootprintX,
      bannerFootprintY,
    );
  };
  for (const ring of rings) {
    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2;
      const qx = Math.cos(angle) * ring.radius;
      const qy = Math.sin(angle) * ring.radius;
      if (region === "lower" && qy < -0.01) continue;
      if (region === "visible-overlap") {
        const edgeX = avatar.centerX + Math.cos(angle) * avatar.outerRadius;
        const edgeY = avatar.centerY + Math.sin(angle) * avatar.outerRadius;
        if (edgeX < bannerRect.x || edgeX > bannerRect.x + bannerRect.width
          || edgeY < bannerRect.y || edgeY > bannerRect.y + bannerRect.height) continue;
      }
      const radialRadius = Math.max(0, ring.radius - radialStep);
      const radialQx = Math.cos(angle) * radialRadius;
      const radialQy = Math.sin(angle) * radialRadius;
      const tangentQx = Math.cos(angle + tangentStep) * ring.radius;
      const tangentQy = Math.sin(angle + tangentStep) * ring.radius;
      const point = structuralPointDifference({
        actual: avatarSample(qx, qy),
        actualRadial: avatarSample(radialQx, radialQy),
        actualTangent: avatarSample(tangentQx, tangentQy),
        expected: expectedSample(qx, qy),
        expectedRadial: expectedSample(radialQx, radialQy),
        expectedTangent: expectedSample(tangentQx, tangentQy),
      });
      const weight = point.featureWeight * ring.weight;
      weightedDifference += point.mismatch * weight;
      totalWeight += weight;
      maximumDifference = Math.max(maximumDifference, point.mismatch);
      featureSignal += point.expectedEdge * ring.weight;
      pointCount += 1;
      pointMismatches.push({ value: point.mismatch, weight });
    }
  }
  const meanDifference = weightedDifference / Math.max(1, totalWeight);
  const weightedPercentile = (percentile) => {
    if (!pointMismatches.length) return 255;
    const ordered = [...pointMismatches].sort((a, b) => a.value - b.value);
    const target = totalWeight * percentile;
    let cumulative = 0;
    for (const entry of ordered) {
      cumulative += entry.weight;
      if (cumulative >= target) return entry.value;
    }
    return ordered[ordered.length - 1].value;
  };
  const p90Difference = weightedPercentile(0.9);
  const p98Difference = weightedPercentile(0.98);
  // A mean alone lets a duplicated window or disconnected rail hide among
  // flat pixels. Keep the score artifact-based, but explicitly penalize the
  // worst structural portions of the rendered upload boundary.
  const broadTailExcess = Math.max(0, p90Difference - Math.max(18, meanDifference * 2.5));
  const narrowTailExcess = Math.max(0, p98Difference - Math.max(50, meanDifference * 5));
  const effectiveDifference = meanDifference
    + broadTailExcess * 0.2
    + narrowTailExcess * 0.03;
  return {
    score: pointCount ? mappingScore(effectiveDifference) : 0,
    meanDifference,
    effectiveDifference,
    p90Difference,
    p98Difference,
    maximumDifference,
    samples: pointCount,
    region,
    visibleSampleFraction: pointCount / Math.max(1, samples * rings.length),
    samplingFootprint: { avatar: avatarFootprint, bannerX: bannerFootprintX, bannerY: bannerFootprintY },
    featureSignal: featureSignal / Math.max(1, pointCount / rings.length),
    metric: "rendered-upload-visible-boundary-v3",
  };
}

export function calculatePairLayoutScore({
  referenceBanner,
  adjustedBanner,
  referenceMapping,
  platformMapping,
  bannerRect,
  avatar,
  referenceAvatar = null,
  pageColor = [0, 0, 0],
  referenceContinuation = null,
  platformContinuation = null,
  samples = 360,
}) {
  const fill = [...pageColor, 255];
  const imageRadius = Math.max(1, avatar.outerRadius - avatar.padding);
  const outerRatio = avatar.outerRadius / imageRadius;
  
  const refOuterRatio = referenceAvatar 
    ? referenceAvatar.outerRadius / Math.max(1, referenceAvatar.outerRadius - (referenceAvatar.padding || 0))
    : 1.0;
    
  const rings = [
    { radius: outerRatio + 0.004, weight: 0.46 },
    { radius: outerRatio + 0.012, weight: 0.34 },
    { radius: outerRatio + 0.024, weight: 0.2 },
  ];
  const tangentStep = (Math.PI * 2) / samples;
  const radialStep = 0.01;
  let weightedDifference = 0;
  let totalWeight = 0;
  let maximumDifference = 0;
  let featureSignal = 0;
  let pointCount = 0;
  const sampleMapping = (image, mapping, radius, angle, continuation) => {
    const x = mapping.centerX + Math.cos(angle) * radius * mapping.radiusX;
    const y = mapping.centerY + Math.sin(angle) * radius * mapping.radiusY;
    return sampleBannerWithContinuation(image, x, y, continuation, fill);
  };

  for (const ring of rings) {
    const deltaRadius = ring.radius - outerRatio;
    const refRingRadius = refOuterRatio + deltaRadius;
    
    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2;
      const qx = Math.cos(angle) * ring.radius;
      const qy = Math.sin(angle) * ring.radius;
      const screenX = avatar.centerX + qx * imageRadius;
      const screenY = avatar.centerY + qy * imageRadius;
      if (screenX < bannerRect.x || screenX > bannerRect.x + bannerRect.width
        || screenY < bannerRect.y || screenY > bannerRect.y + bannerRect.height) continue;
      const tangentAngle = angle + tangentStep;
      const point = structuralPointDifference({
        actual: sampleMapping(adjustedBanner, platformMapping, ring.radius, angle, platformContinuation),
        actualRadial: sampleMapping(
          adjustedBanner, platformMapping, ring.radius - radialStep, angle, platformContinuation,
        ),
        actualTangent: sampleMapping(
          adjustedBanner, platformMapping, ring.radius, tangentAngle, platformContinuation,
        ),
        expected: sampleMapping(referenceBanner, referenceMapping, refRingRadius, angle, referenceContinuation),
        expectedRadial: sampleMapping(
          referenceBanner, referenceMapping, refRingRadius - radialStep, angle, referenceContinuation,
        ),
        expectedTangent: sampleMapping(
          referenceBanner, referenceMapping, refRingRadius, tangentAngle, referenceContinuation,
        ),
      });
      const weight = point.featureWeight * ring.weight;
      weightedDifference += point.mismatch * weight;
      totalWeight += weight;
      maximumDifference = Math.max(maximumDifference, point.mismatch);
      featureSignal += point.expectedEdge * ring.weight;
      pointCount += 1;
    }
  }
  const meanDifference = weightedDifference / Math.max(1, totalWeight);
  return {
    score: pointCount ? mappingScore(meanDifference) : 100,
    meanDifference,
    maximumDifference,
    samples: pointCount,
    featureSignal: featureSignal / Math.max(1, pointCount / rings.length),
    metric: "visible-pair-boundary-v1",
    outerRatio,
  };
}

export function calculateQuality({ diagnostics, calibrated, calibrationResidual = 0, mode, portraitControls }) {
  let score = calibrated ? 100 : 86;
  const warnings = [];
  if (!calibrated) {
    warnings.push({ level: "info", text: "Preset-only output is best effort. Upload a profile screenshot to unlock Perfect Mode." });
  }
  if (diagnostics.outsideBannerFraction > 0) {
    const continuation = diagnostics.continuation;
    if (continuation?.enabled && continuation.modelCount > 0) {
      warnings.push({ level: "ok", text: `${continuation.modelCount} straight boundary feature${continuation.modelCount === 1 ? "" : "s"} continued into the missing lower source area.` });
    } else if (continuation?.enabled) {
      warnings.push({ level: "warn", text: "The lower source area is missing, but no reliable straight boundary features were detected. Adjust continuation sensitivity or use manual geometry." });
    } else {
      warnings.push({ level: "info", text: `${Math.round(diagnostics.outsideBannerFraction * 100)}% of the avatar lies below the banner and uses the selected page background.` });
    }
  }
  if (calibrated && calibrationResidual > 1.5) {
    score -= Math.min(20, (calibrationResidual - 1.5) * 5);
    warnings.push({ level: "warn", text: `Calibration residual is ${calibrationResidual.toFixed(1)} px. Refine the screenshot handles.` });
  }
  if (diagnostics.portraitAtLock > 0.005) {
    score -= 20;
    warnings.push({ level: "error", text: "Portrait pixels reached the locked boundary. Increase lock width or feather inward." });
  }
  if (mode === "portrait" && (portraitControls.scale > 1.18 || Math.hypot(portraitControls.offsetX, portraitControls.offsetY) > 0.24)) {
    score -= 3;
    warnings.push({ level: "warn", text: "The profile image is close to the locked boundary. Scale it down or move it toward center." });
  }
  score = Math.round(clamp(score, 0, 100));
  if (warnings.length === 0) warnings.push({ level: "ok", text: "The boundary is locked and the screenshot calibration is within tolerance." });
  return { score, warnings };
}

export function geometryFromPreset(preset, bannerRect, zoom = 100) {
  const zoomScale = zoom / 100;
  if (preset.androidDpGeometry) {
    const model = preset.androidDpGeometry;
    const dpScale = bannerRect.width / model.logicalWidthDp;
    const outerRadius = (model.sizeDp / 2) * dpScale;
    const borderWidth = model.borderDp * dpScale;
    return {
      centerX: bannerRect.x + (model.leftDp + model.sizeDp / 2) * dpScale,
      centerY: bannerRect.y + bannerRect.height - model.overlapDp * dpScale + outerRadius,
      outerRadius,
      // Android dp geometry is independent of desktop browser zoom.
      padding: model.borderConsumesImage === false ? 0 : borderWidth,
      borderWidth,
      borderConsumesImage: model.borderConsumesImage !== false,
      logicalWidthDp: model.logicalWidthDp,
      dpScale,
    };
  }
  return {
    centerX: bannerRect.x + bannerRect.width * preset.centerX,
    centerY: bannerRect.y + bannerRect.height * preset.centerY,
    outerRadius: bannerRect.width * preset.outerRadius,
    padding: preset.paddingPx * zoomScale,
  };
}

export function serializeProject(state, quality) {
  const exportBanner = state.mobileCompatibility?.enabled && state.mobileCompatibility.adjustedBanner
    ? state.mobileCompatibility.adjustedBanner
    : state.banner;
  return {
    schemaVersion: "1.0.0",
    rendererVersion: "1.5.0",
    createdAt: new Date().toISOString(),
    guarantee: state.calibrated ? "screenshot-calibrated" : "best-effort-preset",
    localOnly: true,
    assets: {
      banner: { width: exportBanner.width, height: exportBanner.height, name: state.bannerName },
      sourceBanner: state.sourceBanner
        ? { width: state.sourceBanner.width, height: state.sourceBanner.height, name: state.bannerName }
        : null,
      portrait: state.portrait ? { width: state.portrait.width, height: state.portrait.height, name: state.portraitName } : null,
      screenshot: state.screenshot ? { width: state.screenshot.width, height: state.screenshot.height, name: state.screenshotName } : null,
      androidScreenshot: state.mobileCompatibility.screenshot
        ? { width: state.mobileCompatibility.screenshot.width, height: state.mobileCompatibility.screenshot.height, name: state.mobileCompatibility.screenshotName }
        : null,
    },
    layout: {
      presetId: state.preset.id,
      surface: state.surface,
      theme: state.theme,
      accountShape: state.shape,
      browserZoom: state.browserZoom,
      devicePixelRatio: state.devicePixelRatio,
      bannerRect: state.bannerRect,
      avatar: state.avatar,
      bannerTransform: {
        active: Boolean(state.bannerTransform && (
          state.bannerTransform.mirrorX
          || state.bannerTransform.flipY
          || (state.bannerTransform.rotation || 0) !== 0
          || Math.abs(state.bannerTransform.zoom - 1) > 0.001
          || Math.abs(state.bannerTransform.offsetX) > 0.5
          || Math.abs(state.bannerTransform.offsetY) > 0.5
        )),
        ...(state.bannerTransform || {}),
      },
    },
    calibration: {
      source: state.calibrated ? "screenshot-manual" : "preset",
      residualPx: state.calibrationResidual,
    },
    composite: {
      mode: state.mode,
      lockStart: state.lockStart,
      featherWidth: state.featherWidth,
      opaqueCorners: state.opaqueCorners,
      portrait: state.portraitControls,
    },
    continuation: {
      enabled: state.continuation.enabled,
      sensitivity: state.continuation.sensitivity,
      detectorVersion: "boundary-hough-1.0.0",
      backgroundColor: state.continuation.model?.backgroundColor || null,
      extensionDepth: state.continuation.model?.extensionDepth || 0,
      detectedLines: state.continuation.model?.models || [],
    },
    mobileCompatibility: {
      enabled: state.mobileCompatibility.enabled,
      platform: "android",
      presetId: state.mobileCompatibility.preset?.id || PRESETS.androidApp.id,
      geometrySource: state.mobileCompatibility.enabled
        ? state.mobileCompatibility.calibrated ? "advanced-screenshot-override" : "x-android-code-derived-dp-model"
        : null,
      calibrated: state.mobileCompatibility.calibrated,
      androidWeight: state.mobileCompatibility.weight,
      sourceMapping: state.mobileCompatibility.sourceMapping || null,
      optimizer: state.mobileCompatibility.optimizer || null,
      pairAware: Boolean(state.mobileCompatibility.adjustedBanner),
      adjustedBannerRequired: Boolean(state.mobileCompatibility.adjustedBanner),
      pairDiagnostics: state.mobileCompatibility.pairDiagnostics || null,
      bannerRect: state.mobileCompatibility.calibrated
        ? state.mobileCompatibility.bannerRect
        : state.mobileCompatibility.presetLayout?.bannerRect || null,
      avatar: state.mobileCompatibility.calibrated
        ? state.mobileCompatibility.avatar
        : state.mobileCompatibility.presetLayout?.avatar || null,
      residualPx: state.mobileCompatibility.calibrationResidual,
      scores: state.mobileCompatibility.scores,
    },
    seamQuality: quality,
  };
}
