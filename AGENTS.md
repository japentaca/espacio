# AGENTS.md

Repo: **ESPACIO** — static 3D web experience (Three.js + Tone.js + Partykals + lodash) with declarative config in `scene.definition.json`. No build step, no package.json, no test/lint/typecheck pipeline.

## Run locally

Must be served over HTTP, never `file://` (the scene fetches JSON, ES module imports, and audio).

- `python -m http.server 8000` → http://localhost:8000/
- or `npx serve -l 8000`

Append `?debugBootstrap=1` to the URL to enable `[bootstrap]` console logs. Local script imports in `index.html` and `scene.js` use a per-load random `?r=…` query and a hardcoded `?v=20260524a` version, so hard reloads pick up edits without manual cache clearing.

## Real entrypoints

- `index.html` — only HTML page. Loads `lodash`, `Tone`, `three.min.js`, `partykals.js` as classic scripts, then dynamically imports `modules/scene.js` + `modules/sceneDefinition.js` and drives the loading overlay.
- `modules/scene.js` — orchestrator. Exports `init`, `initAudio`, `addBase`, `addAudioSet`, `toggleAudio`, `audio`. Public scene API consumed by `index.html`.
- `modules/sceneDefinition.js` — `loadSceneDefinition()` + `normalizeSceneDefinition()`. Always goes through normalization; raw JSON does not reach the runtime.
- `scene.definition.json` — declarative source of truth. Top-level keys: `initializeScene`, `scene3d` (camera/sun/lights/sky/renderer/bodies/probeTargetKeys/cameraTourTargetKeys/marsEffects/reactive), `audioMixer`, `audioSetLibrary`, `audioQueue`, `baseTracks`.

## Architecture

Modules under `modules/scene/` each expose a `createXxxController({...})` factory and own one responsibility. `modules/scene.js` wires them. Detailed "where to change X" map lives in `modules/scene/CHANGE_MAP.md` — read it before touching anything non-trivial; it stays current.

Key files:

- `modules/scene/toursController.js` — probe + camera planet tours, exponential damping, mode switching.
- `modules/scene/uiController.js` — keyboard, resize, FPS HUD. Keys: `f` FPS, `t` top-down, `o` toggle orbit mode.
- `modules/scene/reactiveController.js` — audio-reactive visuals, exposes `getProbeReactiveDrive()` / `getProbeColorWork()`.
- `modules/scene/cosmicTextController.js` — letter-by-letter text sprite animation triggered from audio.
- `modules/scene/marsParticles.js` — Partykals ember + smoke systems.
- `modules/scene/sceneUtils.js` — shared math/render helpers (`mapRange`, `solveKeplerEccentricAnomaly`, `getSphereSegments`, `makeTextSprite`, `createFresnelAtmosphere`).
- `modules/scene/sceneStateFactory.js` — `createSceneState` (tour + camera state) and `createAnimationConfig` (damping + reactive tuning defaults).
- `modules/audio.js`, `modules/audioSet.js`, `modules/mixer/mixer.js`, `modules/mixer/mixerChannel.js` — Tone.js graph.

## Repo conventions

- `modules/sceneUtils.js` and `modules/marsParticles.js` are re-export shims from `modules/scene/*`. The canonical source is the `scene/` subfolder. New code goes in `modules/scene/`.
- `THREE`, `Tone`, `_`, `Partykals` are loaded as classic scripts in `index.html` and are **globals** inside ES modules. Do not `import` them.
- `scene.definition.json` is always normalized on load; unknown `buses`, `tap: "pre"`, send-target mismatches, etc. emit `[bootstrap] scene definition validation` warnings instead of failing.
- Audio is unlocked only after the user clicks the loading overlay (`index.html` → `waitForUserStart` → `Tone.start()`). Audio-dependent code must not run before that promise resolves.
- The reactive probe uses a separate `MeshStandardMaterial` (emissive) and its trail is a custom `ShaderMaterial` ribbon in `modules/scene.js` (block "Comet-style ribbon trail"). Don't replace it with a particle chain.

## Camera / probe smoothing (already implemented)

Tours use framerate-independent exponential damping: `alpha = clamp(1 - exp(-damping * deltaSec), min, max)`. Tunables live in `createSceneState` (`modules/scene/sceneStateFactory.js`):

- `cameraTour.positionDamping` (2.6), `lookDamping` (1.9), `rotationDamping` (1.6), `verticalPosDamping` (1.45), `verticalLookDamping` (1.2). Higher = snappier.
- `probeTour.positionDamping` (3.6), `lookDamping` (4.3).

Smoothstep variants (`t * t * (3 - 2t)`) wrap phase progress (approach / transfer) on top of the damping. The mode-switch between planet tour and free orbit uses a 2600 ms `smoothstep` blend with `slerp` on the quaternion (`toursController.switchOrbitModeSmooth`).

If a future task asks to "smooth" or "soften" camera motion, edit these damping values first; do not add new lerps in the per-frame `animate()` path (it already runs at 60 fps with reused scratch vectors).

## Performance knobs

- `scene.definition.json` → `scene3d.renderer`: `antialias` (default false), `powerPreference` (default `"high-performance"`), `maxPixelRatio` (default 1.5). Drop to 1.0 on mobile.
- Per-body `materialType`: `"lambert"` (default, fastest), `"standard"`, `"phong"` (reserved for `mode: "displacement"`). The probe is always `MeshStandardMaterial` for emissive.
- `scene.definition.json` → `scene3d.reactive`: `probeSensitivity` (default 1.5), `probeResponseCurve` (default 1.6). See `CHANGE_MAP.md` for the curve semantics.
- Probe ribbon, scratch `THREE.Vector3` instances, and a circular history buffer (`PROBE_RIBBON_SEGMENTS = 60`) are the hot path. Avoid allocating inside `updateProbeRibbon` / `updateProbeTour` / `updatePlanetTourCamera`.

## Deploy

- `.github/workflows/pages.yml` — publishes the repo root to GitHub Pages on push to `main`. No build step; the artifact is the working tree as-is.
- `FFMPEG_BIN_DIR` is declared in `.env` (gitignored) and is a local helper, not used by the deploy.

## Validation before finishing a change

1. Reload the page, watch the loading overlay progress (45 → 52 → 65 → 70–98 → 100).
2. Check the console for new warnings, especially `[bootstrap] scene definition validation` and Three.js texture-resize warnings.
3. Confirm audio still starts on click, tours still cycle, and the FPS overlay (`f`) reads > 30 on desktop.

## Known noise in the codebase

These are intentional and harmless; do not "fix" them unsolicited:

- `console.log("mixer...", mixer)` in `modules/audio.js:4`.
- `console.log("comienza", ...)` and `console.log(this.myAudioSet)` in `modules/audioSet.js:7,39`.
- `reactiveController.js` clamps `sunLight`, `ambientLight`, `hemiLight`, and `jupiter.scale` to fixed values per frame — they override the values set from `scene.definition.json` at runtime. If you intend to change those visuals, edit `reactiveController.js`, not the config.
