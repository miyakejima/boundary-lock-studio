# X Android profile geometry

Verified 2026-06-24 against the current Play-distributed build and the immediately newer package:

- `12.1.1-release.0` (`versionCode 312011000`), listed by Google Play as updated 2026-06-22.
- `12.2.0-release.0` (`versionCode 312020000`), distributed 2026-06-23.

Package SHA-256 values used during analysis:

- `12.1.1`: `337DC6E1A6B005A6972FA2990C513CB4A861E2EA909FF00F923A19A4DD8C839E`
- `12.2.0`: `0FB8DAA29A49F0A35C535F53C2AD5CC77BF72D8EB61FC89F78BF79A3C8DE5976`

## Active Compose rules

The updated profile shown by the supplied live screenshot does not use the legacy controller below. X 12.2 also ships a Compose profile header under `com.x.profile.header` (`UserProfileHeaderUi.kt`). Its active constants are:

```text
banner aspect ratio                 3.0
profile horizontal padding          12dp
avatar image size                   80dp
avatar border                        2dp
avatar presence wrapper inset        4dp
under-banner layout reserve         60dp (80dp × 3/4)
visible avatar overlap              28dp
```

The 28dp overlap follows from the 60dp reserve and 88dp avatar wrapper. The wrapper's 4dp visual inset is cancelled before drawing, so the visible 80dp image starts at the wrapper origin. For a logical width `Wdp`:

```text
centerX / screenWidth = 52 / Wdp
centerY / bannerHeight = 1 + 12 / Wdp
outerRadius / screenWidth = 40 / Wdp
border / screenWidth = 2 / Wdp
```

At the tool's 914px preview width and the supplied device's 411dp layout class, this is approximately:

```text
banner height  304.67px
centerX        115.65px
centerY        331.35px
outer radius    88.95px
border           4.45px
```

The independently detected circle in the supplied live X screenshot is approximately `(114.5, 329.5)` before accounting for screenshot raster/edge ambiguity. The old preview predicted approximately `(104.5, 309.1)`, which explains the visible up-left error.

## Legacy rules retained for regression

Both packages contain the same relevant resources:

```text
profile_avatar_over_header_height        -36dp
profile_header_avatar_size_with_border    76dp
profile_header_avatar_border             3.5dp
profile_header_padding_minus_avatar_border 9dp
```

`com.twitter.profiles.HeaderImageView` calls `setAspectRatio(3.0f)` in both versions. The profile controller places the avatar container using:

```text
left = 9dp
top = floor(screenWidthPx / 3) - 36dp
size = 76dp
border = 3.5dp
```

Therefore, for an Android logical width `Wdp`:

```text
centerX / screenWidth = 47 / Wdp
centerY / bannerHeight = 1 + 6 / Wdp
outerRadius / screenWidth = 38 / Wdp
border / screenWidth = 3.5 / Wdp
```

The legacy geometry at a 914px preview width was approximately:

```text
banner height  304.67px
centerX        104.52px
centerY        309.11px
outer radius    84.51px
border           7.78px
```

The previous approximation used `(111px, 304.67px)`, an 86px radius, and a fixed 4px border. Its inner image radius was therefore materially wrong even when its self-generated preview looked aligned.

## Renderer changes

- Android geometry is now computed from dp rules instead of fixed normalized screenshot coordinates.
- Android border width scales from the current Compose path's 2dp border and is independent of desktop browser zoom. Compose overlays that border on the full 80dp image; it does not shrink the image content to 76dp. The legacy preset retains its 3.5dp consumed border.
- Optional Android-exact mode samples one uniform affine avatar crop directly from the Android layout mapping. It never blends desktop and Android coordinates within the avatar.
- The previous companion-banner annulus/crossfade path was removed from production. On detailed landmarks it created doubled windows, smeared doors, and bent railings while its circular reference score remained high.
- The current score reads the exact 400 × 400 avatar artifact and samples only angles whose outer circle visibly overlaps the banner. It compares color plus radial/tangential structure, records p90/p98 errors, and penalizes localized structural tails.
- Android export is disabled when this artifact score is below 90. Desktop receives an independent score; the UI does not average incompatible transforms into a misleading compromise.

## Verification target

For `ChatGPT Image Jun 23, 2026, 04_16_50 AM.png` (`1448 × 1086`), source correlation against the supplied real X screenshot recovered the following Android mapping:

```text
Measured banner→source center at avatar  (183.80, 828.01)
Production Android mapping center          (183.20, 826.61)
Center error                                  1.52 source px
Measured source radius                       139.76 px
Production source radius                     140.92 px
Radius error                                   1.17 source px
```

The clean production verifier renders the exact 400px uploads through the same core used by the browser UI and scores only the visible overlap:

```text
Android-exact avatar on Android       97
Desktop avatar on Android             29
Android-exact avatar on desktop       29
Desktop-exact avatar on desktop       96
Android visible-circle sample share   40.4%
Desktop visible-circle sample share   50.1%
```

The wrong desktop-derived crop is therefore rejected on Android instead of receiving the former false 90+. Visual inspection agrees: Android-exact keeps the window outside the circle and reconnects the railing; the desktop crop duplicates the window and shifts the railing.

## Versioning

The active model is versioned as `x-android-compose-profile-header-12.2-2026-06-24`. The older path remains `x-android-legacy-profile-header-12.1-12.2-2026-06-23`. If X changes the composable or shared avatar primitives, the active model must be re-verified against the new package. The optional advanced override remains available for experiments or server-controlled variants.

## Why the renderer does not use a transparent adaptive ring

The current Android photo-upload request (`com.twitter.api.upload.request.d`) invokes `com.twitter.media.service.tasks.b`. That resize task encodes JPEG, and the request keeps the JPEG whenever the source exceeds the dimension limit or the encoded file is at most 70% of the original size. A transparent PNG avatar can therefore be flattened during the real upload path even if a local preview preserves alpha. Opaque output remains the production-safe default; transparency is not used to claim cross-platform adaptation.
