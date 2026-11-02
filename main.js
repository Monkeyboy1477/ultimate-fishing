// The Reel Deal — core game loop and state machine.
// This file is the integration point. It only orchestrates; the realism
// (physics, fish AI, 3D rendering, UI) lives in the imported modules below,
// each of which must conform to the API documented next to its import.

import { CastController, isLureHome, retrieveSpeedFor, stepRetrieve } from './casting3d.js';
import { LineTensionSystem, fightTiming, stepFight } from './tension.js';
import { FISH_SPECIES, trySpawnBite, HookedFish, eligibleSpeciesFor, getSellPrice, runTensionFor } from './fish.js';
import { HOME_POINT } from './constants.js';
import { initScene, renderScene3D, resizeScene, spawnSplash3D } from './scene3d.js';
import { renderHUD } from './render.js';
import { initMenus, showCatchResult, updateHUDSummary, updateCurrencyDisplay, createIdleMenuButtons } from './ui.js';
import { createEconomy } from './economy.js';
import { installAudio } from './audio.js';
import { installTouchControls, isTouchDevice } from './touchControls.js';

const canvas = document.getElementById('game-canvas');
const hudOverlay = document.getElementById('hud-overlay');
const menuOverlay = document.getElementById('menu-overlay');
const topBar = {
  catchCount: document.getElementById('catch-count'),
  bestCatch: document.getElementById('best-catch'),
  currency: document.getElementById('currency-display'),
};

const economy = createEconomy();
const idleMenuButtons = createIdleMenuButtons(document.getElementById('game-stage'), menuOverlay, economy);
installAudio(document.getElementById('game-stage'));

const STATE = {
  MENU: 'menu',
  CHARGING: 'charging',
  CAST_FLIGHT: 'cast_flight',
  WAITING_BITE: 'waiting_bite',
  FIGHTING: 'fighting',
  RESULT: 'result',
};

const game = {
  state: STATE.MENU,
  cast: null,          // result of CastController.release()
  castElapsed: 0,
  waitElapsed: 0,
  sinceRelease: 0,      // seconds since the cast was released; the catch clock
  lurePos: { ...HOME_POINT },
  fightOrigin: null,    // where the fish was hooked; distanceRemaining 1 = here, 0 = HOME_POINT
  retrieveSpeed: 0,
  cutCast: false,       // Space pressed mid-flight: drop the lure where it is
  hookedFish: null,     // HookedFish instance
  tensionSystem: new LineTensionSystem(economy.getEquippedStats('line').breakThreshold),
  tensionState: { tension: 0, distanceRemaining: 1, broken: false, landed: false },
  reelInput: 0,         // set by holding the reel key/button
  lastResult: null,
};

// Rebuilt on every new cast so a rod bought/equipped mid-session (between casts, from the
// menu or result screen's shop) takes effect immediately rather than needing a page reload.
let castController = new CastController(economy.getEquippedStats('rod'), economy.getCurrentMap());

initScene(canvas);

// ---- Input handling -------------------------------------------------------
// First-person aiming: horizontal mouse position across the canvas sets the
// lateral aim angle (0 = straight out over the water, positive = right,
// negative = left), matching casting3d.js's documented sign convention. The
// camera itself stays fixed — aim is conveyed by the rod/reticle, like a
// first-person weapon, so there's no pointer-lock/mouselook complexity.
const MAX_AIM_ANGLE_DEG = 40;
const TOUCH_AIM_DEG_PER_S = 45;

let castPointerId = null; // the mouse or finger holding the canvas to charge a cast
let aimAngleDeg = 0;
let touchAimDirection = 0;

function aimAngleFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const fx = (e.clientX - rect.left) / rect.width; // 0..1 across the canvas
  const clamped = Math.max(0, Math.min(1, fx));
  return (clamped - 0.5) * 2 * MAX_AIM_ANGLE_DEG;
}

function canStartCast() {
  return game.state === STATE.MENU || game.state === STATE.RESULT;
}

function startCast() {
  game.state = STATE.CHARGING;
  castController = new CastController(economy.getEquippedStats('rod'), economy.getCurrentMap());
  castController.startCharging();
}

function releaseCast() {
  if (game.state !== STATE.CHARGING) return;
  game.cast = castController.release(aimAngleDeg);
  game.castElapsed = 0;
  game.sinceRelease = 0;
  game.cutCast = false;
  game.state = STATE.CAST_FLIGHT;
}

function startReel(isFreshPress = true) {
  game.reelInput = 1;
  if (game.state === STATE.CAST_FLIGHT && isFreshPress) game.cutCast = true;
}

function stopReel() {
  game.reelInput = 0;
}

canvas.addEventListener('pointerdown', (e) => {
  if (!canStartCast()) return;
  castPointerId = e.pointerId;
  aimAngleDeg = aimAngleFromEvent(e);
  startCast();
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== castPointerId) return;
  aimAngleDeg = aimAngleFromEvent(e);
});

function endCanvasCast(e) {
  if (e.pointerId !== castPointerId) return;
  castPointerId = null;
  releaseCast();
}
window.addEventListener('pointerup', endCanvasCast);
window.addEventListener('pointercancel', endCanvasCast);

// Reel input: Space is tracked in every state, so a hold carries from retrieve into a fight.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  startReel(!e.repeat);
});
window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  stopReel();
});
window.addEventListener('blur', stopReel);

// The one big button casts when the lure is home and reels otherwise. What it does is fixed
// when it's pressed, so a held REEL that brings the lure home doesn't turn into a cast.
let actionHeldAs = null;

const touchControls = installTouchControls(document.getElementById('game-stage'), {
  onActionPress: () => {
    if (canStartCast()) {
      actionHeldAs = 'cast';
      startCast();
    } else {
      actionHeldAs = 'reel';
      startReel();
    }
  },
  onActionRelease: () => {
    if (actionHeldAs === 'cast') releaseCast();
    if (actionHeldAs === 'reel') stopReel();
    actionHeldAs = null;
  },
  onAim: (direction) => {
    touchAimDirection = direction;
  },
});

// Phones fill the screen, so the 3D view has to follow the stage's shape.
function fitSceneToCanvas() {
  const { clientWidth, clientHeight } = canvas;
  if (clientWidth > 0 && clientHeight > 0) resizeScene(clientWidth, clientHeight);
}

function enableTouchLayout() {
  if (document.body.classList.contains('touch')) return;
  document.body.classList.add('touch');
  new ResizeObserver(fitSceneToCanvas).observe(canvas);
  fitSceneToCanvas();
}

// Touchscreen laptops report a mouse, so their first touch switches the layout on as well.
if (isTouchDevice()) enableTouchLayout();
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') enableTouchLayout();
}, { capture: true });

function returnLureHome() {
  game.hookedFish = null;
  game.cast = null;
  game.fightOrigin = null;
  game.lastResult = null;
  game.lurePos = { ...HOME_POINT };
  game.state = STATE.MENU;
}

function lureEntersWater(point) {
  if (isLureHome(point)) {
    returnLureHome();
    return;
  }
  game.lurePos = { x: point.x, y: 0, z: point.z };
  game.cast = { ...game.cast, landingPoint: game.lurePos, landingDistance: -point.z };
  spawnSplash3D(game.lurePos);
  game.retrieveSpeed = retrieveSpeedFor(game.lurePos);
  game.waitElapsed = 0;
  game.state = STATE.WAITING_BITE;
}

function finishFight(result) {
  game.lastResult = result;
  game.state = STATE.RESULT;
  game.fightOrigin = null;
  game.lurePos = { ...HOME_POINT };
  showCatchResult(menuOverlay, result);
}

// ---- Main loop --------------------------------------------------------------
let lastTime = performance.now();
let elapsedTime = 0;

function tick(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  elapsedTime += dt;

  update(dt);
  render();

  requestAnimationFrame(tick);
}

function update(dt) {
  switch (game.state) {
    case STATE.CHARGING: {
      castController.updateCharge(dt);
      aimAngleDeg = Math.max(
        -MAX_AIM_ANGLE_DEG,
        Math.min(MAX_AIM_ANGLE_DEG, aimAngleDeg + touchAimDirection * TOUCH_AIM_DEG_PER_S * dt),
      );
      break;
    }
    case STATE.CAST_FLIGHT: {
      game.castElapsed += dt;
      game.sinceRelease += dt;
      game.lurePos = game.cast.trajectoryFn(game.castElapsed);
      if (game.cutCast) {
        game.cutCast = false;
        lureEntersWater(game.lurePos);
      } else if (game.castElapsed >= game.cast.flightDuration) {
        lureEntersWater(game.cast.landingPoint);
      }
      break;
    }
    case STATE.WAITING_BITE: {
      game.sinceRelease += dt;
      game.waitElapsed += dt;
      if (game.reelInput) {
        game.lurePos = stepRetrieve(game.lurePos, game.retrieveSpeed, dt);
        if (isLureHome(game.lurePos)) {
          returnLureHome();
          break;
        }
      }
      const lureDistance = -game.lurePos.z;
      const bite = trySpawnBite(
        { landingDistance: lureDistance },
        game.waitElapsed,
        dt,
        economy.getEquippedStats('lure'),
        economy.getCurrentMap().id,
      );
      if (bite) {
        const timing = fightTiming(bite, lureDistance, game.sinceRelease);
        game.hookedFish = new HookedFish(bite, timing.budgetS, economy.getEquippedStats('lure').minFishLb);
        game.tensionSystem = new LineTensionSystem(economy.getEquippedStats('line').breakThreshold, timing);
        game.tensionState = game.tensionSystem.update(0, { x: 0, y: 0 }, 0);
        game.fightOrigin = { ...game.lurePos };
        game.state = STATE.FIGHTING;
      }
      break;
    }
    case STATE.FIGHTING: {
      game.sinceRelease += dt;
      const step = stepFight(game.hookedFish, game.tensionSystem, game.tensionState, dt, game.reelInput);
      game.tensionState = step.tensionState;

      if (step.outcome === 'line_snapped' || step.outcome === 'fish_escaped') {
        const species = game.hookedFish.species;
        const lineTooWeak = runTensionFor(species) > economy.getEquippedStats('line').breakThreshold;
        finishFight({ caught: false, reason: step.outcome, species, lineTooWeak });
      } else if (step.outcome === 'landed') {
        const species = game.hookedFish.species;
        const weight = game.hookedFish.weight;
        const sellPrice = getSellPrice(species, weight);
        const { earned, isRecord, isNewSpecies } = economy.recordCatch(species, weight, sellPrice);
        finishFight({ caught: true, species, weight, isRecord, isNewSpecies, soldFor: earned });
      }
      break;
    }
    default:
      break;
  }

  updateHUDSummary(topBar, economy.getStats());
  updateCurrencyDisplay(topBar.currency, economy.getCurrency());
}

function render() {
  renderScene3D({
    state: game.state,
    aimAngleDeg,
    chargePower: castController.currentPower,
    cast: game.cast,
    castElapsed: game.castElapsed,
    hookedFish: game.hookedFish,
    tensionState: game.tensionState,
    time: elapsedTime,
    lurePos: game.lurePos,
    reeling: game.reelInput === 1 && (game.state === STATE.WAITING_BITE || game.state === STATE.FIGHTING),
    mapId: economy.getCurrentMap().id,
    fightOrigin: game.fightOrigin,
    lastResult: game.lastResult,
    gear: {
      rod: economy.getEquippedStats('rod').visual,
      line: economy.getEquippedStats('line').visual,
      lure: economy.getEquippedStats('lure').visual,
    },
  });

  renderHUD(hudOverlay, {
    state: game.state,
    chargePower: castController.currentPower,
    tensionState: game.tensionState,
    hookedFish: game.hookedFish,
    touch: document.body.classList.contains('touch'),
    noFishForLure: eligibleSpeciesFor(economy.getEquippedStats('lure'), economy.getCurrentMap().id).length === 0
      && !menuOverlay.classList.contains('active'),
  });

  const menuOpen = menuOverlay.classList.contains('active');
  idleMenuButtons.hidden = game.state !== STATE.MENU || menuOpen;
  touchControls.update({
    label: canStartCast() || game.state === STATE.CHARGING ? 'CAST' : 'REEL',
    visible: !menuOpen,
    aimEnabled: canStartCast() || game.state === STATE.CHARGING,
  });
}

initMenus(menuOverlay, {
  onStartCast: () => {
    game.state = STATE.MENU;
  },
  onRestart: () => {
    returnLureHome();
  },
}, economy);

requestAnimationFrame((t) => {
  lastTime = t;
  requestAnimationFrame(tick);
});

export { STATE, FISH_SPECIES };
