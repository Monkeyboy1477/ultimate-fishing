# Two-Player Split-Screen Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in 2-Player mode where two people on one keyboard fish side by side (left/right split screen) into one shared lake, each with their own rod/line/lure, in either a Team (shared wallet) or Competitive (separate wallets) sub-mode.

**Architecture:** Extract today's single-player singletons — `scene3d.js`'s rod/line/lure/fish/camera rig and `main.js`'s `game` state machine — into instantiable factories (`createPlayerRig`, `createPlayerController`), each parameterized by a per-player world-space offset and economy. Single-player creates exactly one of each, unchanged in behavior. 2P creates two of each sharing one `THREE.Scene`/world, rendered into one canvas via `renderer.setViewport`/`setScissor` (one WebGLRenderer, two cameras).

**Tech Stack:** Vanilla JS modules, Three.js (`three@0.160.0` via CDN import map), `node:test` for logic-layer unit tests, no build step.

**Spec:** `docs/superpowers/specs/2026-11-02-two-player-splitscreen-design.md`

## Global Constraints

- Split orientation is left/right (side-by-side), never top/bottom.
- 2P is opt-in via a mode-select screen shown before today's start screen; single-player is the default and must be byte-for-byte behaviorally unchanged.
- 2P has exactly two sub-modes: **Team** (one shared wallet/catch log) and **Competitive** (separate currency/catch-count/best-catch per player, separate gear).
- Shared lake, separate lines: one `THREE.Scene`/world, two independent rods/lines/lures/cameras, so each player sees the other's rod/line/lure/splash for real.
- 2P input is keyboard-only: Player 1 = `A`/`D` aim, `S` action (charge/release cast, hold-reel). Player 2 = `ArrowLeft`/`ArrowRight` aim, `ArrowDown` action. No mouse, no touch controls in 2P.
- Rendering uses one `WebGLRenderer`, one `THREE.Scene`, two `PerspectiveCamera`s, split via `renderer.setViewport`/`setScissor` — never two renderers/canvases.
- `world3d.js`'s static geometry (terrain/water/dock/trees/sky) is not modified. Per-player separation comes from a lateral offset of roughly ±0.6m applied to each player's own copy of `EYE_POS`/`ROD_TIP`/`HOME_POINT`.
- Shop/Fish Book/Maps stay one shared overlay (with a Player 1/Player 2 tab in Competitive mode only), opened by a key bound to neither player's aim/action keys (`Escape`), and opening it freezes both players' cast/fight timers.
- Save keys: single-player's existing `localStorage` key is untouched. Team 2P gets one new shared key; Competitive 2P gets two new per-player keys.

## Review Focus

- Opening the shared `Escape` menu mid-cast or mid-fight must freeze **both** players' timers, not just stop rendering updates for one — a player must not be able to keep casting while the overlay is up.
- Player 1's and Player 2's keys must drive fully independent `CastController`/reel state at the same time — holding both action keys at once must not collapse into one shared "reel input" the way today's single global `game.reelInput` does.
- Adding Team/Competitive save-key suffixes must not change the existing single-player save key, so returning single-player users keep their save.
- Two rigs sharing one scene must not double-advance shared/global state: `updateWorld(dt, time)` (clouds, water, birds) must run exactly once per frame in split mode, not once per rig.
- Each camera's aspect ratio in split mode must be computed from its **half**-width viewport, not the full canvas width, or both views will look horizontally stretched.

---

### Task 1: Per-player world-offset points in `constants.js`

**Files:**
- Modify: `constants.js`
- Test: `tests/constants.test.js` (new)

**Interfaces:**
- Produces: `PLAYER_SEPARATION_M` (number, exported constant), `pointsForOffset(offsetX: number): { eyePos: {x,y,z}, rodTip: {x,y,z}, homePoint: {x,y,z} }` (exported function).

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EYE_POS, ROD_TIP, HOME_POINT, PLAYER_SEPARATION_M, pointsForOffset } from '../constants.js';

test('pointsForOffset(0) matches the single-player points exactly', () => {
  assert.deepEqual(pointsForOffset(0), { eyePos: EYE_POS, rodTip: ROD_TIP, homePoint: HOME_POINT });
});

test('pointsForOffset shifts only x, on all three points, by the given amount', () => {
  const shifted = pointsForOffset(0.6);
  assert.equal(shifted.eyePos.x, EYE_POS.x + 0.6);
  assert.equal(shifted.eyePos.y, EYE_POS.y);
  assert.equal(shifted.eyePos.z, EYE_POS.z);
  assert.equal(shifted.rodTip.x, ROD_TIP.x + 0.6);
  assert.equal(shifted.homePoint.x, HOME_POINT.x + 0.6);
});

test('PLAYER_SEPARATION_M is a small positive lateral gap that fits the dock', () => {
  assert.ok(PLAYER_SEPARATION_M > 0 && PLAYER_SEPARATION_M < 1.3, 'must fit inside DOCK_HALF_WIDTH * 2');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/constants.test.js`
Expected: FAIL (`pointsForOffset` is not a function)

- [ ] **Step 3: Implement in `constants.js`**

Add `export const PLAYER_SEPARATION_M = 1.2;` and `export function pointsForOffset(offsetX) { ... }` returning new plain objects (don't mutate/alias `EYE_POS`/`ROD_TIP`/`HOME_POINT`) with `x` shifted by `offsetX` and `y`/`z` copied through.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/constants.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add constants.js tests/constants.test.js
git commit -m "feat: add per-player world-offset points for 2P mode"
```

---

### Task 2: Parameterize `casting3d.js`'s origin and home point

**Files:**
- Modify: `casting3d.js`
- Test: `tests/catch-time.test.js` (existing — must keep passing unmodified), `tests/casting-origin.test.js` (new)

**Interfaces:**
- Consumes: nothing new from Task 1 directly (caller passes plain `{x,y,z}` points from `pointsForOffset`).
- Produces: `new CastController(rodStats, map, originPoint = ROD_TIP)`; `isLureHome(pos, homePoint = HOME_POINT)`; `retrieveSpeedFor(pos, homePoint = HOME_POINT)`; `stepRetrieve(pos, speed, dt, homePoint = HOME_POINT)`. All four keep their current behavior exactly when called with the same argument count as today (defaults match current constants).

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CastController, isLureHome, retrieveSpeedFor, stepRetrieve } from '../casting3d.js';
import { ROD_TIP, HOME_POINT } from '../constants.js';

test('a cast from a custom origin lands offset by exactly that origin\'s x difference from ROD_TIP', () => {
  const origin = { x: ROD_TIP.x + 0.6, y: ROD_TIP.y, z: ROD_TIP.z };
  const a = new CastController(undefined, undefined, ROD_TIP);
  const b = new CastController(undefined, undefined, origin);
  a.startCharging(); a.currentPower = 0.5;
  b.startCharging(); b.currentPower = 0.5;
  const castA = a.release(0);
  const castB = b.release(0);
  assert.ok(Math.abs((castB.landingPoint.x - castA.landingPoint.x) - 0.6) < 1e-9);
});

test('isLureHome/retrieveSpeedFor/stepRetrieve honor a custom home point', () => {
  const home = { x: HOME_POINT.x + 0.6, y: HOME_POINT.y, z: HOME_POINT.z };
  const farFromCustomHome = { x: home.x + 10, y: 0, z: home.z };
  assert.equal(isLureHome(farFromCustomHome, home), false);
  assert.equal(isLureHome(home, home), true);
  const speed = retrieveSpeedFor(farFromCustomHome, home);
  const next = stepRetrieve(farFromCustomHome, speed, 0.1, home);
  // moved toward the custom home, not the default HOME_POINT
  assert.ok(Math.abs(next.x - home.x) < Math.abs(farFromCustomHome.x - home.x));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/casting-origin.test.js`
Expected: FAIL (extra constructor/function arguments ignored, both casts land identically)

- [ ] **Step 3: Implement in `casting3d.js`**

Add a third constructor parameter `originPoint = ROD_TIP` and store it as `this.origin`. Replace every direct `ROD_TIP.x/y/z` reference inside `release()` with `this.origin.x/y/z`. Add a `homePoint = HOME_POINT` parameter (last position) to `isLureHome`, `retrieveSpeedFor`, and `stepRetrieve`, and to their internal `horizontalDistanceToHome(pos, homePoint)` helper, replacing direct `HOME_POINT` references with the parameter.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/casting-origin.test.js tests/catch-time.test.js`
Expected: PASS (both files, including the untouched existing suite)

- [ ] **Step 5: Commit**

```bash
git add casting3d.js tests/casting-origin.test.js
git commit -m "feat: let CastController and retrieve helpers use a per-player origin/home point"
```

---

### Task 3: Per-save-slot economy in `economy.js`

**Files:**
- Modify: `economy.js`
- Test: `tests/economy-save-key.test.js` (new)

**Interfaces:**
- Produces: `createEconomy(storageKeySuffix = '')`. With no argument, behavior and the `localStorage` key are unchanged from today. A non-empty suffix uses a distinct key, so two `createEconomy()` calls with different suffixes never share currency/stats/owned gear.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEconomy } from '../economy.js';
import { FISH_SPECIES } from '../fish.js';

function withFakeLocalStorage(fn) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  try { fn(); } finally { delete globalThis.localStorage; }
}

test('createEconomy() with no suffix keeps using the original single-player save key', () => {
  withFakeLocalStorage(() => {
    const a = createEconomy();
    a.recordCatch(FISH_SPECIES[0], 2, 10);
    const b = createEconomy();
    assert.equal(b.getStats().catchCount, 1, 'second instance with no suffix reads the same save');
  });
});

test('two suffixed economies never share currency or catch stats', () => {
  withFakeLocalStorage(() => {
    const team = createEconomy('-team');
    team.recordCatch(FISH_SPECIES[0], 2, 10);
    const p1 = createEconomy('-p1');
    const p2 = createEconomy('-p2');
    assert.equal(p1.getStats().catchCount, 0);
    assert.equal(p2.getStats().catchCount, 0);
    p1.recordCatch(FISH_SPECIES[0], 1, 5);
    assert.equal(createEconomy('-p1').getStats().catchCount, 1);
    assert.equal(createEconomy('-p2').getStats().catchCount, 0);
    assert.equal(createEconomy('-team').getStats().catchCount, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/economy-save-key.test.js`
Expected: FAIL (all instances share one key, so the second test's assertions on independence fail)

- [ ] **Step 3: Implement in `economy.js`**

Change `createEconomy()` to `createEconomy(storageKeySuffix = '')`, and build the key used by `loadState`/`persist` as `` `${SAVE_KEY}${storageKeySuffix}` `` (keep the existing `SAVE_KEY` constant as the base string).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/economy-save-key.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add economy.js tests/economy-save-key.test.js
git commit -m "feat: let createEconomy take a save-key suffix for Team/Competitive 2P slots"
```

---

### Task 4: Extract `createPlayerRig` from `scene3d.js` (pure refactor, no behavior change)

**Files:**
- Modify: `scene3d.js`

**Interfaces:**
- Consumes: `pointsForOffset` shape from Task 1 (an object `{ eyePos, rodTip, homePoint }`).
- Produces: an internal (not yet exported) `createPlayerRig(scene, originPoints)` factory returning `{ camera, updateFrame(frameState, dt, time), renderInto(renderer) }`, where `updateFrame`/`renderInto` together do exactly what today's module-level `renderScene3D` body does for the rod/line/lure/fish/camera, but reading/writing only this rig's own closure state instead of module-level variables. `initScene(canvas)` and `renderScene3D(frameState)` keep their exact current signatures and behavior by internally creating and delegating to exactly one rig.

- [ ] **Step 1: Move per-player module state into the factory**

In `scene3d.js`, wrap the "Rod" / "Line" / "Lure and wake" / "Fish" / camera-related module-level `let`/`const` declarations (everything listed under those comment headers, plus `cameraYaw`, `previousState`, `tipWorld`, `lineGeometry`/`lineMaterial`/`linePoints`, `lurePivot`/`activeLure`/`activeLureKind`/`wakeMesh`/wake state, `fishGroup`/`fishShadow`/fish animation state, and the `camera` object itself) inside a new `createPlayerRig(scene, originPoints)` function body, so each becomes a local variable captured by that function's closure. Move `buildRod`, `buildLine`, `buildLure`, `buildFish`, `updateRod`, `rebuildBlank`, `setLineColor`, `updateLine`, `placeLure`, `updateWake`, `clearWake`, `updateFish`, `updateFishWake`, `computeFishPosition`, `updateTrophy`, `applyGear`, `updateCamera`, and the body of today's `renderScene3D` (from `const frame = previewFrame(...)` down to `renderer.render(scene, camera)`, minus the one `updateWorld(dt, time)` call) inside the same function, as inner functions closing over the rig's own state, replacing every reference to `ROD_TIP`/`EYE_POS`/`HOME_POINT` inside them with `originPoints.rodTip`/`originPoints.eyePos`/`originPoints.homePoint`. The camera's own creation (`new THREE.PerspectiveCamera(...)`, initial `position.set(originPoints.eyePos...)`) moves here too.
Split the old `renderScene3D` body into `updateFrame(frameState, dt, time)` (everything up to and including `updateEffects(dt)`/`previousState = state`) and `renderInto(renderer)` (just the final `renderer.render(scene, camera)`), both returned from the factory along with `camera`.
`buildEffects()` (rings/droplets pools) and the shared `applyGear`-free module variables that aren't per-rig (e.g. the pure vector scratch space `v1`..`v4`, `color1`, `zAxis`, `localUp` can stay module-level since they're reused as temporaries, not state) stay at module scope, called once regardless of player count.

- [ ] **Step 2: Rewire `initScene` and `renderScene3D` to use one rig**

`initScene(canvas)` becomes: build `renderer`/`scene` as today, `buildWorld(scene, renderer)`, `buildEffects()`, then `const defaultRig = createPlayerRig(scene, { eyePos: EYE_POS, rodTip: ROD_TIP, homePoint: HOME_POINT })`, store `defaultRig` in a module-level variable, and keep returning `{ renderer, scene, camera: defaultRig.camera }`. `renderScene3D(frameState)` becomes: run the existing top section (`previewFrame`, map switching, `const dt = ...`, `updateWorld(dt, time)`) once, then `defaultRig.updateFrame(frameState, dt, time)` then `defaultRig.renderInto(renderer)`. `resizeScene(width, height)` keeps setting `renderer`'s size and now sets `defaultRig.camera.aspect`/`fov` (same math as today, just addressed through the rig).

- [ ] **Step 3: Manually verify no regression**

Run the game (open `index.html` via a local static server, e.g. `npx serve .` or any static file server) and play one full single-player cycle: charge and release a cast, let a bite happen, reel in and land or lose a fish, confirm the trophy pose on a catch, confirm HUD/camera/rod motion look identical to before the refactor.

- [ ] **Step 4: Commit**

```bash
git add scene3d.js
git commit -m "refactor: extract createPlayerRig from scene3d.js module state, no behavior change"
```

---

### Task 5: Split-screen rendering — `initSplitScene`/`renderSplitScene`/`resizeSplitScene`

**Files:**
- Modify: `scene3d.js`

**Interfaces:**
- Consumes: `createPlayerRig` from Task 4; `pointsForOffset`/`PLAYER_SEPARATION_M` from Task 1.
- Produces: `export function initSplitScene(canvas): { rigs: [rigP1, rigP2] }` (builds the renderer/scene/world/effects once, then two rigs via `createPlayerRig(scene, pointsForOffset(-PLAYER_SEPARATION_M / 2))` and `pointsForOffset(PLAYER_SEPARATION_M / 2)`); `export function renderSplitScene([frameStateP1, frameStateP2])` (updates the world once, updates both rigs, renders each into its half of the canvas); `export function resizeSplitScene(width, height)` (sizes the renderer to the full canvas, and each rig's camera aspect to a **half**-width viewport).

- [ ] **Step 1: Implement `initSplitScene`**

Mirror `initScene`'s renderer/scene/`buildWorld`/`buildEffects` setup, but create and return two rigs using the left/right offsets above instead of one. Store both in a module-level `splitRigs` variable (alongside, not replacing, the single-player `defaultRig`, so single-player keeps working if `initScene` was already called) and store `renderer`/`scene` if not already created by `initScene`'s own module-level `renderer`/`scene` variables (reuse those same module-level `renderer`/`scene` references — only one of `initScene`/`initSplitScene` runs per session).

- [ ] **Step 2: Implement `renderSplitScene`**

```js
export function renderSplitScene(frameStates) {
  if (!started) return;
  const dt = Math.min(clock ? clock.getDelta() : 0.016, 0.05);
  const time = /* running total, same pattern as renderScene3D's caller-supplied frame.time */ frameStates[0].time ?? 0;
  const mapId = frameStates[0].mapId || 'pond';
  if (mapId !== worldMapId) { worldMapId = mapId; setWorldMap(mapId); }
  updateWorld(dt, time);
  const [rigP1, rigP2] = splitRigs;
  rigP1.updateFrame(frameStates[0], dt, time);
  rigP2.updateFrame(frameStates[1], dt, time);
  const { width, height } = renderer.domElement;
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, width / 2, height);
  renderer.setScissor(0, 0, width / 2, height);
  rigP1.renderInto(renderer);
  renderer.setViewport(width / 2, 0, width / 2, height);
  renderer.setScissor(width / 2, 0, width / 2, height);
  rigP2.renderInto(renderer);
  renderer.setScissorTest(false);
}
```
Use the exact same `gear`/`applyGear` handling each rig's `updateFrame` already does per-player (each `frameState` carries its own `gear`), and the same per-rig `cast`/`hookedFish`/`tensionState` fields `renderScene3D` already reads — `updateFrame`'s signature from Task 4 is unchanged, so each frameState in the pair is exactly what a single-player `frameState` looks like today.

- [ ] **Step 3: Implement `resizeSplitScene`**

```js
export function resizeSplitScene(width, height) {
  if (!renderer) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  const halfAspect = (width / 2) / height;
  for (const rig of splitRigs) {
    rig.camera.aspect = halfAspect;
    rig.camera.fov = BASE_FOV_DEG; // split panes are already narrower than one full view; no letterbox compensation needed
    rig.camera.updateProjectionMatrix();
  }
}
```

- [ ] **Step 4: Manually verify split rendering in isolation**

Add a temporary call (e.g. a one-line console-triggered test in the browser dev tools, or a scratch HTML file that imports `initSplitScene`/`renderSplitScene` directly) to confirm: both halves render the same lake from two slightly different, side-by-side positions; moving one rig's simulated lure doesn't affect the other half; resizing the window keeps both halves looking square/undistorted. Remove the temporary scratch file before committing (not game code — it's throwaway verification).

- [ ] **Step 5: Commit**

```bash
git add scene3d.js
git commit -m "feat: add initSplitScene/renderSplitScene/resizeSplitScene for 2P split-screen rendering"
```

---

### Task 6: Extract `createPlayerController` from `main.js` (pure refactor, no behavior change)

**Files:**
- Modify: `main.js`

**Interfaces:**
- Consumes: `economy` instance (from `createEconomy`, Task 3), `originPoints` (from `pointsForOffset`, Task 1), an `input` adapter shaped like `{ onAim(direction: -1|0|1), onActionPress(), onActionRelease() }` consumer side (i.e. the controller exposes these three methods for whatever wires up input) plus the existing `startReel`/`stopReel`-style `isFreshPress` semantics.
- Produces: `createPlayerController({ economy, originPoints })` returning `{ onAim(direction), onActionPress(), onActionRelease(), update(dt), getFrameState(), isMenuIdle(): boolean }`. `getFrameState()` returns exactly the object shape today's `render()` builds for `renderScene3D` (the `{ state, aimAngleDeg, chargePower, cast, ... gear }` object), so Task 7/9 can pass it straight to `renderScene3D`/`renderSplitScene` unchanged.

- [ ] **Step 1: Move today's module-level `game`, `castController`, `aimAngleDeg`, `touchAimDirection`, `castPointerId`, `actionHeldAs`, and the `STATE` machine functions (`canStartCast`, `startCast`, `releaseCast`, `startReel`, `stopReel`, `returnLureHome`, `lureEntersWater`, `finishFight`, and the body of today's `update(dt)`) into `createPlayerController({ economy, originPoints })`**, as closure-local state/functions, replacing `HOME_POINT` references with `originPoints.homePoint` and passing `originPoints.rodTip` into `new CastController(economy.getEquippedStats('rod'), economy.getCurrentMap(), originPoints.rodTip)`. Rename the touch/mouse-specific `aimAngleFromEvent`/pointer listeners' *targets* (not their logic) so they call the controller's `onAim`/`onActionPress`/`onActionRelease` — those DOM listener registrations themselves stay at module scope in Task 7, this task only needs the controller to expose the three methods they'll call.
`getFrameState()` returns the same object `render()` builds today (the argument to `renderScene3D`), reading this controller's own `game`/`castController`/`aimAngleDeg`.
`isMenuIdle()` returns `canStartCast()`'s current value, for the idle-button-visibility logic Task 9 needs per player.

- [ ] **Step 2: Rewire the top-level `tick`/`update`/`render` to use one controller**

Create `const singlePlayer = createPlayerController({ economy, originPoints: pointsForOffset(0) })` at module scope (import `pointsForOffset` from `constants.js`). The existing mouse/pointer/`Space` listeners now call `singlePlayer.onAim(...)`/`singlePlayer.onActionPress()`/`singlePlayer.onActionRelease()` (mouse aim keeps setting an absolute angle: give the controller a fourth method `setAimAngle(deg)` used only by the mouse path, since mouse aim is absolute position and keyboard aim in Task 7/9 is a continuous turn rate — keep both methods on the controller). `tick`'s `update(dt)` becomes `singlePlayer.update(dt)`; `render()` becomes `renderScene3D(singlePlayer.getFrameState())` plus the existing `renderHUD`/`updateHUDSummary`/`updateCurrencyDisplay`/idle-button/touch-control calls, now reading `singlePlayer.getFrameState().state` and `economy` exactly as before.

- [ ] **Step 3: Manually verify no regression**

Run the game and play a full single-player cycle (cast, bite, fight, catch/loss, result, shop) exactly as in Task 4 Step 3, confirming mouse aim, Space-reel, touch controls, and the shop/menu flow all behave identically to before this refactor.

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "refactor: extract createPlayerController from main.js module state, no behavior change"
```

---

### Task 7: Mode-select screen and shared Player-tab menu in `ui.js`

**Files:**
- Modify: `ui.js`, `style.css`
- Test: manual (DOM-building UI, no existing test coverage pattern in this project for `ui.js`)

**Interfaces:**
- Consumes: nothing new from earlier tasks (works with whatever `economy`-shaped object(s) it's handed).
- Produces: `export function showModeSelect(menuOverlayElement, onChoose)` where `onChoose` is called with either `{ mode: '1p' }` or `{ mode: '2p', economyMode: 'team' | 'competitive' }`. `export function showSharedMenu(menuOverlayElement, players, onClose)` where `players` is `[{ label: string, economy }]` (one entry for Team, two for Competitive); renders a Player-tab row only when `players.length > 1`, then the selected player's Shop/Fish Book/Maps tabs reusing the existing `buildShopPanel(economy, onClose)`/`buildBookPanel(economy, onClose)`/`buildMapsPanel(economy, onClose)` (no change to those three functions). Also add an optional 4th parameter `{ showShopLinks = true } = {}` to `initMenus`'s internal `buildStartScreen` and to `showCatchResult`, so a 2P per-player idle/result panel can be shown with `showShopLinks: false` (omitting the Shop/Fish Book/Maps buttons, since 2P reaches those only through `showSharedMenu`).

- [ ] **Step 1: Build `showModeSelect`**

A new panel (same `menu-panel` styling as `buildStartScreen`) with a "1 Player" button calling `onChoose({ mode: '1p' })`, and a "2 Player" button that reveals (or navigates to) two further buttons, "Team" and "Competitive", calling `onChoose({ mode: '2p', economyMode: 'team' })` / `onChoose({ mode: '2p', economyMode: 'competitive' })`.

- [ ] **Step 2: Add `showShopLinks` option to `buildStartScreen`/`showCatchResult`**

Thread a `{ showShopLinks = true } = {}` options object through `buildStartScreen(menuOverlayElement, callbacks, options)` and `showCatchResult(menuOverlayElement, result, options)`, wrapping each existing `appendMenuButtons(...)` call in `if (options.showShopLinks) { ... }`. `initMenus` and existing single-player call sites don't pass the new argument, so default `true` preserves today's behavior exactly.

- [ ] **Step 3: Build `showSharedMenu`**

```js
export function showSharedMenu(menuOverlayElement, players, onClose) {
  let activeIndex = 0;
  function render() {
    menuOverlayElement.innerHTML = '';
    const wrapper = document.createElement('div');
    if (players.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'menu-player-tabs';
      players.forEach((player, i) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `menu-button menu-button-secondary${i === activeIndex ? ' active' : ''}`;
        tab.textContent = player.label;
        tab.addEventListener('click', () => { activeIndex = i; render(); });
        tabs.appendChild(tab);
      });
      wrapper.appendChild(tabs);
    }
    wrapper.appendChild(buildShopPanel(players[activeIndex].economy, onClose));
    menuOverlayElement.appendChild(wrapper);
    menuOverlayElement.classList.add('active');
  }
  render();
}
```
(Starts on the Shop tab; reuse the existing `MENU_SCREENS`-style Fish Book/Maps buttons already present inside `buildShopPanel`'s panel via `appendMenuButtons`, if that's how the current panel already links to the other two screens — otherwise add the same three-button row `buildStartScreen` uses, calling `buildBookPanel`/`buildMapsPanel` in place of `buildShopPanel` when clicked, keeping `activeIndex`'s player fixed.)

- [ ] **Step 4: Add minimal CSS for the mode-select screen and player tabs**

In `style.css`, add `.menu-player-tabs { display: flex; gap: 8px; margin-bottom: 12px; }` and `.menu-player-tabs .active { border-color: var(--color-ui-accent); }`, following the existing `.menu-button`/`.menu-panel` visual language already in the file.

- [ ] **Step 5: Manually verify**

Temporarily call `showModeSelect` from a scratch snippet (or wait for Task 9's real wiring) to confirm: 1P/2P/Team/Competitive buttons render and call back with the right payload; `showSharedMenu` with one vs. two `players` entries shows/hides the tab row correctly and switches panels per tab.

- [ ] **Step 6: Commit**

```bash
git add ui.js style.css
git commit -m "feat: add mode-select screen and shared Player-tab shop/book/maps menu"
```

---

### Task 8: Keyboard-only input adapters for 2P

**Files:**
- Modify: `main.js`

**Interfaces:**
- Consumes: `createPlayerController`'s `onAim(direction)`/`onActionPress()`/`onActionRelease()` from Task 6.
- Produces: an internal `bindPlayerKeys(controller, { aimLeftKey, aimRightKey, actionKey })` helper wiring `keydown`/`keyup` window listeners to that controller's three input methods, with the same "action does whatever it meant when pressed" semantics `main.js` already uses for the single big touch button (`actionHeldAs`-style logic, scoped per player so Player 1 and Player 2 track their own `actionHeldAs` independently).

- [ ] **Step 1: Implement `bindPlayerKeys`**

```js
function bindPlayerKeys(controller, { aimLeftKey, aimRightKey, actionKey }) {
  let actionHeldAs = null;
  let aimDirection = 0;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === aimLeftKey) aimDirection = -1;
    else if (e.code === aimRightKey) aimDirection = 1;
    else if (e.code === actionKey) {
      if (controller.isMenuIdle()) { actionHeldAs = 'cast'; controller.onActionPress(); }
      else { actionHeldAs = 'reel'; controller.onActionPress(); }
    } else return;
    e.preventDefault();
    controller.onAim(aimDirection);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === aimLeftKey || e.code === aimRightKey) {
      aimDirection = 0;
      controller.onAim(0);
    } else if (e.code === actionKey) {
      controller.onActionRelease();
      actionHeldAs = null;
    } else return;
    e.preventDefault();
  });
}
```
Player 1 binds `{ aimLeftKey: 'KeyA', aimRightKey: 'KeyD', actionKey: 'KeyS' }`; Player 2 binds `{ aimLeftKey: 'ArrowLeft', aimRightKey: 'ArrowRight', actionKey: 'ArrowDown' }`. This function is only called when a 2P session starts (Task 9); single-player's existing mouse/`Space`/touch listeners from Task 6 are untouched and keep working as-is.

- [ ] **Step 2: Manually verify key independence**

With two keyboards (or one keyboard pressing both sets of keys in quick succession/together), confirm Player 1's `A`/`D`/`S` and Player 2's arrow keys drive independent aim/charge/reel state without either affecting the other, and that holding both action keys at once charges/releases both casts independently (Review Focus item 2).

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat: add independent keyboard input adapters for 2P"
```

---

### Task 9: Wire up mode selection, split canvas, split HUD, and the shared pause menu in `main.js`/`index.html`/`style.css`

**Files:**
- Modify: `main.js`, `index.html`, `style.css`

**Interfaces:**
- Consumes: everything from Tasks 1–8 (`pointsForOffset`, `createEconomy(suffix)`, `initSplitScene`/`renderSplitScene`/`resizeSplitScene`, `createPlayerController`, `bindPlayerKeys`, `showModeSelect`/`showSharedMenu`).
- Produces: the finished feature — a player sees the mode-select screen first; choosing 1 Player behaves exactly as today; choosing 2 Player (Team or Competitive) shows a left/right split canvas, two independent HUD panes, two independent idle/result panels (without shop links), and a shared `Escape`-triggered pause menu that freezes both players.

- [ ] **Step 1: Add split-mode DOM scaffolding to `index.html`**

Inside `#game-stage`, add two new sibling overlay containers next to the existing `#hud-overlay`/`#menu-overlay`: `#hud-overlay-p2` and `#menu-overlay-p2` (the existing `#hud-overlay`/`#menu-overlay` double as Player 1's panes in 2P mode). Add a `#game-stage.split-screen` CSS hook.

- [ ] **Step 2: Add split-screen CSS to `style.css`**

```css
#game-stage.split-screen #hud-overlay,
#game-stage.split-screen #menu-overlay { right: 50%; left: 0; }
#game-stage.split-screen #hud-overlay-p2,
#game-stage.split-screen #menu-overlay-p2 { position: absolute; top: 0; bottom: 0; left: 50%; right: 0; pointer-events: none; }
#game-stage.split-screen #menu-overlay-p2.active { pointer-events: auto; }
#game-stage.split-screen::after { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; background: rgba(255,255,255,0.25); pointer-events: none; }
```
(`inset: 0` on the base `#hud-overlay`/`#menu-overlay` rule from today is overridden by the more specific `right: 50%; left: 0` selector above when `.split-screen` is present; `#hud-overlay-p2`/`#menu-overlay-p2` start with `display: none` by default outside `.split-screen`, shown only via the new rule's `position: absolute` once that class is present — add a plain `#hud-overlay-p2, #menu-overlay-p2 { display: none; }` base rule and drop it to `display: block`/flex inside the `.split-screen` scope to avoid them ever appearing in single-player.)

- [ ] **Step 3: Wire mode selection in `main.js`**

Before today's `initMenus(...)` call, call `showModeSelect(menuOverlay, (choice) => { ... })`. On `{ mode: '1p' }`, call `initMenus` exactly as today (no behavior change). On `{ mode: '2p', economyMode }`: build economies — Team: `const shared = createEconomy('-team'); const economyP1 = shared; const economyP2 = shared;`; Competitive: `const economyP1 = createEconomy('-p1'); const economyP2 = createEconomy('-p2');` — then `document.getElementById('game-stage').classList.add('split-screen')`, `initSplitScene(canvas)`, create `const p1 = createPlayerController({ economy: economyP1, originPoints: pointsForOffset(-PLAYER_SEPARATION_M / 2) })` and `const p2 = createPlayerController({ economy: economyP2, originPoints: pointsForOffset(PLAYER_SEPARATION_M / 2) })`, `bindPlayerKeys(p1, { aimLeftKey: 'KeyA', aimRightKey: 'KeyD', actionKey: 'KeyS' })`, `bindPlayerKeys(p2, { aimLeftKey: 'ArrowLeft', aimRightKey: 'ArrowRight', actionKey: 'ArrowDown' })`, and show each player's idle start screen via `initMenus`-equivalent calls against `menuOverlay`/`menuOverlayP2` with `{ showShopLinks: false }` (Task 7).

- [ ] **Step 4: Branch the main loop for 2P**

Replace the single `tick`/`update`/`render` path with a check on a module-level `twoPlayer` flag (or dispatch object) set in Step 3: single-player keeps calling `singlePlayer.update(dt)` / `renderScene3D(singlePlayer.getFrameState())` as today; 2P calls `p1.update(dt)`, `p2.update(dt)` (both skipped while the shared menu is open — see Step 5), then `renderSplitScene([p1.getFrameState(), p2.getFrameState()])`, then `renderHUD(hudOverlay, ...p1 state...)` and `renderHUD(hudOverlayP2, ...p2 state...)`, and the per-player idle-button/result-panel visibility driven by each controller's own `isMenuIdle()`/result state against its own overlay pair.

- [ ] **Step 5: Wire the shared `Escape` pause menu**

Add a `keydown` listener for `e.code === 'Escape'` active only in 2P mode: toggles a module-level `pausedForMenu` flag and calls `showSharedMenu(menuOverlay, players, onClose)` where `players` is built from `economyMode` (one entry for Team, two labeled "Player 1"/"Player 2" for Competitive); `onClose` hides the overlay and clears `pausedForMenu`. In Step 4's loop, skip calling `p1.update(dt)`/`p2.update(dt)` entirely while `pausedForMenu` is true (still call `renderSplitScene` so the frozen frame stays visible), satisfying Review Focus item 1.

- [ ] **Step 6: Resize handling for split mode**

Update the existing `ResizeObserver`/`fitSceneToCanvas` callback to call `resizeSplitScene(clientWidth, clientHeight)` instead of `resizeScene(...)` when `twoPlayer` is true.

- [ ] **Step 7: Manually verify end-to-end**

Play a full 2 Player Team session: both players cast independently, see each other's rod/line/lure across the split, one player catches a fish while the other is still waiting, the shared wallet/catch count updates and matches on both sides, `Escape` opens one shared shop with no player tabs and freezes both players' timers, closing it resumes both. Repeat for Competitive: confirm separate currency/catch counts, and that the shared menu now shows a Player 1/Player 2 tab switching between two independent wallets. Finally re-verify 1 Player mode still behaves exactly as before (mode-select "1 Player" button skips all of the above).

- [ ] **Step 8: Commit**

```bash
git add main.js index.html style.css
git commit -m "feat: wire up 2-player split-screen mode selection, rendering, HUD, and shared pause menu"
```
