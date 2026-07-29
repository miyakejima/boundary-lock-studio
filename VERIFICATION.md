# Implementation verification

Verified on 2026-06-24. This file records current evidence only; the rejected companion-banner/crossfade experiment is not treated as a successful implementation.

## Requirement audit

| Requirement | Current implementation | Evidence |
|---|---|---|
| Deterministic local tool | `index.html`, `app.js`, `core.js`, and `styles.css`; no generation or remote image API | Local HTTP/browser run; static source inspection |
| Banner-derived avatar | `buildAvatar()` inversely maps each output pixel into the banner | Unit tests and exact 400 × 400 fixtures |
| Portrait-center mode with locked boundary | Portrait weight reaches zero at `lockStart`; banner owns the outer ring | Unit test proves center ownership and zero ring leakage |
| Current Android geometry | Code-derived 3:1 Compose header, 12dp left inset, 80dp avatar, 28dp overlap, 2dp overlay border | Unit test predicts `(116, 331)`, radius `89`, border `4` at 914px; real screenshot fit is approximately `(115, 330)` |
| Android border behavior | Full 80dp image remains under the 2dp overlaid border; content is not shrunk to 76dp | Geometry regression and production composite renderer |
| Android mode is optional | Toggle defaults off and disabled output remains byte-identical to the desktop renderer | Unit test and browser DOM state |
| No second avatar/manual second workflow | Android-exact mode changes the mapping used for the one shared 400px avatar | Browser copy/state and export path inspection |
| No hidden banner warp | Android-exact mode leaves the banner untouched unless explicit banner quick-tools are active | Browser state: adjusted-banner export remains disabled after enabling Android-exact mode |
| Honest platform conflict | Desktop and Android are scored independently; no score averaging or annulus-reference scoring | Browser demo reports Android `96`, Desktop `42`, Worst `42` |
| Exact artifact scoring | `calculateLayoutSeamScore()` reads the rendered 400px upload, compares color and radial/tangential structure, and reports p90/p98 errors | Metric `rendered-upload-visible-boundary-v3` |
| Hidden pixels cannot inflate Android | Only angles whose outer circle lies inside the visible banner rectangle contribute | Regression verifies a partial Android circle uses `40.8%` of full ring samples |
| Local landmark failure prevents 90+ | Mean error plus structural-tail penalties reject a deliberately corrupted top arc | Regression assertion for duplicated-window-style sector |
| Failed Android output cannot export | Android-exact mode disables avatar export whenever Android score is below 90 | Browser/source inspection |
| Preview equals export renderer | Live preview uses the exact 400px `buildAvatar()` result; export independently calls the same options at 400px | Source inspection; no 256→400→layout pre-resample remains |
| Missing lower area | Straight boundary-crossing features use deterministic virtual-canvas continuation; banner remains unchanged | Synthetic detection/slope/continuation tests |
| Banner quick-tools | Mirror, flip, rotation cycle, pan, entered zoom, and wheel zoom rebuild the working banner | Browser UI/source inspection |
| Calibration and manual geometry | Screenshot/manual banner rectangle and avatar geometry controls remain available as optional overrides | Browser DOM/source inspection |
| Opaque upload corners | Default checked; renderer writes alpha 255 outside the circle | Unit test |
| Export | Avatar is 400 × 400 PNG with 2MB warning; banner export appears only for explicit banner transforms | Unit test and browser DOM state |

## Courtyard production regression

Fixture: `ChatGPT Image Jun 23, 2026, 04_16_50 AM.png` (`1448 × 1086`).

The verifier in `work/verify-courtyard-production.mjs` imports the production `core.js`, renders exact 400px uploads, composites the current Android border/layout at `915 × 437`, and scores only the visible overlap.

| Rendered upload/layout | Score | Mean structural difference | p90 | p98 |
|---|---:|---:|---:|---:|
| Android-exact avatar on Android | 97 | 2.11 | 4.42 | 11.38 |
| Desktop avatar on Android | 29 | 89.80 | 182.68 | 222.09 |
| Android-exact avatar on desktop | 29 | 90.98 | 173.63 | 214.48 |
| Desktop-exact avatar on desktop | 96 | 2.66 | 5.90 | 16.28 |

The production Android mapping differs from the independently fitted real-X mapping by `1.52` source pixels at center and `1.17` source pixels in radius. Visual inspection of `work/verified-courtyard-android-exact-crop.png` confirms that the lower window is no longer duplicated and the railing/courtyard edge continue through the border gap. `work/verified-courtyard-wrong-crop.png` reproduces the rejected duplicated-window and shifted-railing failure.

## Commands

```powershell
node --check app.js
node --check core.js
node core.test.mjs
node work/verify-courtyard-production.mjs
```

All current syntax/unit checks pass. The browser demo path reports Android `96`, Desktop `42`, Worst `42`, keeps adjusted-banner export disabled, and shows the current 914 × 880 Android preview.

## Known mathematical limitation

Desktop and Android require different source centers and radii for the same normalized avatar pixel. A single static avatar cannot be pixel-exact against both mappings for arbitrary detailed artwork. The production tool now exposes this conflict instead of blurring, warping, or assigning a false shared score. Use Android-exact mode when Android is the target; disable it for the desktop-exact crop.
