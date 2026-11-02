# Two-Player Split-Screen Mode — Design

## Intent

Ultimate Fishing is currently strictly single-player: one mouse-aimed rod,
one camera, one wallet, one `game` state object in `main.js`, and one set
of singleton rod/line/lure/fish-visual state in `scene3d.js`. The player
wants to add an **opt-in 2-Player mode** where two people on the same
keyboard fish side by side on a split screen, into the *same* lake, each
controlling their own line.

This is for local co-op/competitive play (two people, one keyboard, one
screen), not online multiplayer.

## Goals

- A new menu option, alongside the existing single-player start, to begin
  a 2-Player session. Single-player remains the default/unchanged
  experience when 2P isn't chosen.
- Two side-by-side (left/right) first-person viewports into **one shared
  3D world/lake**. Each player can see the other player's rod, line,
  lure, splash, and hooked fish in the distance, because they're real
  objects in the same scene — not mirrored/faked state.
- Each player casts, waits for a bite, and fights their own fish
  independently, using keyboard-only controls (no mouse — only one mouse
  exists for two players).
- Two 2-Player sub-modes, chosen when starting a 2P session:
  - **Team** — one shared wallet/catch log for both players.
  - **Competitive** — separate currency, catch count, and best-catch
    record per player; each buys/equips their own gear.
- Each player gets their own HUD (charge meter, tension bar, catch
  count/currency) rendered inside their own half of the screen.

## Non-goals

- Online/networked multiplayer.
- More than 2 players.
- Touch/mobile support for 2P mode (there's only one touchscreen and two
  players need independent simultaneous input; 2P is keyboard/desktop
  only). Single-player keeps its existing mouse + touch support unchanged.
- Independent pause/shop access per player while the other keeps fishing
  (see "Shared menu in 2P" below) — both players pause together to shop,
  check the fish book, or change maps.
- Fish-bite arbitration/competition for the *same* bite (that's the
  "Competitive" rendering of economy, not of fish — each player's bite
  eligibility is computed independently off their own lure's position,
  same as today).

## Anti-goals

- Don't fake the "shared lake" by mirroring position data between two
  independent scenes — that was explicitly rejected (see Approaches).
- Don't let the 2P refactor change or regress single-player behavior,
  feel, or performance.

## Constraints / key finding from the existing code

Most of the game's non-visual logic is already instance-friendly:

- `casting3d.js`'s `CastController` is a class — already instantiable
  per player.
- `tension.js`'s `LineTensionSystem` is a class — already instantiable
  per player.
- `fish.js`'s `trySpawnBite`/`HookedFish`/etc. are pure functions / plain
  classes, parameterized by whatever lure position and gear you pass in
  — no singleton state.
- `economy.js`'s `createEconomy()` is a factory returning a plain object
  — can be called once (Team) or twice (Competitive).
- `render.js`'s `renderHUD(hudElement, state)` and `ui.js`'s
  `updateHUDSummary`/`updateCurrencyDisplay` already take a DOM element
  and a state/stats object as arguments — not singletons. They can be
  called twice against two different DOM nodes without modification.

The one place that **is** a true singleton is `scene3d.js`: `camera`,
`renderer`, `scene`, and the rod/line/lure/fish-visual groups (`rod`,
`lureTarget`, `fishGroup`, `fishShadow`, `lurePivot`, `activeLure`, wake
state, etc.) are all module-level mutable variables, and `renderScene3D`
drives exactly one of each per frame. `world3d.js`'s static environment
(terrain, water, dock, trees, sky, clouds) is also a singleton, but that's
correct and should **stay** a singleton — it's the one shared lake both
players look at.

This means the real work of this feature is: split `scene3d.js`'s
per-player visual rig out of its module scope into something
instantiable twice, while leaving `world3d.js` alone.

**Correction after builder review:** `main.js` is itself a second
singleton of equivalent size to the `scene3d.js` one. Its module-level
`game` state object (the `menu`/`charging`/`cast_flight`/`waiting_bite`/
`fighting`/`result` state machine), the module-level `castController`
variable, and the `startCast`/`releaseCast`/`startReel`/`stopReel`/
`update`/`render` functions all assume exactly one player. None of
`casting3d.js`'s or `tension.js`'s per-player-friendliness helps unless
something in `main.js` actually creates two of them and drives both each
tick. This refactor (extracting a `createPlayerController(economy)`
factory out of today's `main.js` body, one instance per player, each
fed its own input device) is in scope and is roughly as much work as the
`scene3d.js` rig split — not a footnote.

## Approaches considered

**A — One scene, one renderer, two cameras, viewport/scissor split.**
Build the static world once (`world3d.js`, unchanged). Refactor
`scene3d.js`'s rod/line/lure/fish/camera/wake state into a
`createPlayerRig(scene)` factory; create two rigs for 2P (one for 1P),
both added to the same `THREE.Scene`. Each frame, update both rigs'
animation state, then call `renderer.render(scene, rig.camera)` twice,
using `renderer.setViewport`/`setScissor` to confine each render to its
half of the canvas. Both players' rod/line/lure/fish are real objects in
one scene, so each genuinely sees the other.

**B — Two renderers/scenes, mirrored state.** Keep `scene3d.js` as a
pure singleton and run two full copies of the game, each with its own
canvas/renderer/scene, syncing the other player's lure/fish position into
each scene as a lightweight stand-in object. Much less refactoring, but
"shared lake" becomes something we fake and keep in sync by hand (bugs
when the two copies drift), and it roughly doubles GPU/CPU cost since the
terrain/water/trees get built and rendered twice.

**Decision: Approach A.** The player explicitly wants a real shared lake
where both lines/catches are visible to each other, which is exactly the
case Approach B can only fake. The cost is accepted: a non-trivial
refactor of `scene3d.js`'s module-level rod/line/lure/fish/camera state
into an instantiable rig.

## Decided

- **Split orientation:** left/right (side-by-side), not top/bottom.
- **Shared world, separate lines:** one lake, one set of terrain/dock/sky
  geometry, two independent rods/lines/lures/hooked-fish, two cameras.
- **Two sub-modes under 2P:** Team (shared wallet) and Competitive
  (separate wallets), chosen at 2P session start.
- **2P is opt-in**, selected from a mode-select screen before the menu;
  single-player remains the default path and is otherwise unchanged.

## My calls (defaults the builder should follow; flag if wrong)

- **Rendering technique:** Approach A as described above — one
  `WebGLRenderer`, one `THREE.Scene`, two `PerspectiveCamera`s, rendered
  via `setViewport`/`setScissor` into left/right halves of one canvas.
  This is the standard Three.js split-screen technique.
- **Rig refactor shape:** extract a `createPlayerRig(scene)` factory in
  (or alongside) `scene3d.js` that owns one player's camera, rod group,
  line, lure, fish group/shadow, and wake trail, with its own
  `updateRod`/`updateLine`/`placeLure`/`updateFish`/`updateCamera`
  methods (today's module-level functions, parameterized by rig instead
  of closed over module variables). Ambient/shared effects that aren't
  tied to one player's lure — splash rings, droplets, clouds, birds — can
  stay in a single shared pool that either rig's splash call feeds into,
  same as today.
- **Keyboard bindings (no mouse in 2P):**
  - Player 1 (left): `A`/`D` to aim left/right (replaces mouse-X aim),
    `S` to charge/release a cast and to hold-reel (replaces
    click-and-hold / Space).
  - Player 2 (right): `←`/`→` to aim, `↓` to charge/release/hold-reel.
  - This reuses the existing touch-control abstraction's shape
    (`onAim(direction)` continuous turn rate +
    `onActionPress`/`onActionRelease` for charge/release/reel) rather
    than inventing a new input model — `touchControls.js` already proves
    that pattern works for charge/cast/reel without a mouse.
  - Single-player's existing mouse-aim + Space-reel controls are
    untouched; the new keyboard scheme only applies when a 2P session is
    active.
- **HUD layout:** each half gets its own HUD overlay (charge meter,
  tension bar, catch count, currency) positioned via CSS within that
  half, using the existing `renderHUD`/`updateHUDSummary`/
  `updateCurrencyDisplay` functions called once per player against that
  player's own DOM nodes and state. In Team mode, currency/catch-count
  is the same number shown in both halves (one shared stat, read twice);
  in Competitive mode each half shows its own player's stats.
- **Shared menu in 2P:** shop / fish book / map-select / pause remain a
  single full-screen overlay shared by both players (as today), opened
  by a key that isn't bound to either player's aim/action keys (e.g.
  `Esc` or `Tab`). Opening it pauses both players' casting state. This
  keeps scope bounded — true independent per-player shopping while the
  other keeps fishing is a non-goal above.
- **Mode-select screen:** a new first screen (shown before today's idle
  menu) with "1 Player" and, if chosen, "2 Player" → "Team" / "Competitive".
  Implemented as another `ui.js` overlay view, reusing the existing
  overlay/menu machinery.
- **Per-player world position:** `constants.js`'s `ROD_TIP`, `EYE_POS`,
  and `HOME_POINT` are single fixed points (one angler, slightly
  right-of-center on a dock with `DOCK_HALF_WIDTH = 1.3`, i.e. a 2.6m-wide
  deck). Rather than rebuild `world3d.js`'s dock geometry, give each
  player a lateral offset (e.g. roughly ±0.6m from center) applied to
  their own copies of these three points, so both anglers stand side by
  side on the existing dock without their rods/lines overlapping. This
  keeps `world3d.js` itself unchanged, as originally intended — only the
  per-player constants feeding `casting3d.js`/`scene3d.js` need the
  offset.
- **Save persistence in 2P:** `economy.js` writes to one fixed
  `localStorage` key. 2P progress should persist like single-player
  does, so `createEconomy()` takes an optional storage-key suffix:
  single-player keeps today's key, Team 2P uses one new shared key, and
  Competitive 2P uses two new per-player keys. This is a small,
  backward-compatible change to `economy.js`, not a redesign of it.
- **Shop/book/maps overlay with two economies (Competitive only):** the
  shared overlay's panel builders (`buildShopPanel` etc.) currently take
  a single `economy`. In Competitive mode, add a simple "Player 1 /
  Player 2" tab at the top of the shop/book/maps overlay that switches
  which player's economy instance the panel is reading and writing;
  Team mode needs no tabs since there's only one economy to show.
- **Freezing both players for the shared menu:** today the shop/book/map
  overlay is only reachable from idle/result states, so there's never a
  running cast/fight timer to freeze. In 2P, since either or both
  players could be mid-cast or mid-fight when the shared menu opens
  (bound to a key not used for aiming/casting, e.g. `Esc`), the main
  loop must skip calling `update(dt)` for both player controllers while
  the overlay is open, while still rendering so the frozen scene stays
  visible behind it.

## What's left to the builder

- The exact function-by-function split of `scene3d.js`'s ~1200 lines into
  rig-instance methods vs. shared-effect functions — the design above
  specifies the boundary (per-player: camera/rod/line/lure/fish/wake;
  shared: world, splash rings/droplets, clouds, birds) but not every
  variable's new home.
- Exact CSS/pixel math for the two canvas halves, HUD overlay positioning
  within each half, and how the existing responsive/resize-observer
  logic in `main.js` (`fitSceneToCanvas`) adapts to two half-width
  viewports.
- Whether `index.html`/`main.js` use one `<canvas>` (viewport-split, as
  Approach A implies) — this should be one canvas, not two, since
  Approach A's viewport/scissor technique renders both halves from a
  single `WebGLRenderer`.
- Any fine-tuning of the keyboard turn-rate/charge feel for the new
  discrete-key aim scheme vs. today's continuous mouse aim.
