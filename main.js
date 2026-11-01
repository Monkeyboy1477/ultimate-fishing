// Ultimate Fishing — core game loop and state machine.
// This file is the integration point. It only orchestrates; the realism
// (physics, fish AI, 3D rendering, UI) lives in the imported modules below,
// each of which must conform to the API documented next to its import.

import { CastController, isLureHome, retrieveSpeedFor, stepRetrieve } from './casting3d.js';
import { LineTensionSystem, fightTiming, stepFight } from './tension.js';
import { FISH_SPECIES, trySpawnBite, HookedFish, getSellPrice } from './fish.js';
import { HOME_POINT } from './constants.js';
import { initScene, renderScene3D, spawnSplash3D } from './scene3d.js';
import { renderHUD } from './render.js';
import { initMenus, showCatchResult, updateHUDSummary, updateCurrencyDisplay, createIdleShopButton } from './ui.js';
import { createEconomy } from './economy.js';
import { installAudio } from './audio.js';

const canvas = document.getElementById('game-canvas');
const hudOverlay = document.getElementById('hud-overlay');
const menuOverlay = document.getElementById('menu-overlay');
const topBar = {
  catchCount: document.getElementById('catch-count'),
  bestCatch: document.getElementById('best-catch'),
  currency: document.getElementById('currency-display'),
};

const economy = createEconomy();
const idleShopButton = createIdleShopButton(document.getElementById('game-stage'), menuOverlay, economy);
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
let castController = new CastController(economy.getEquippedStats('rod'));

initScene(canvas);

// ---- Input handling -------------------------------------------------------
// First-person aiming: horizontal mouse position across the canvas sets the
// lateral aim angle (0 = straight out over the water, positive = right,
// negative = left), matching casting3d.js's documented sign convention. The
// camera itself stays fixed — aim is conveyed by the rod/reticle, like a
// first-person weapon, so there's no pointer-lock/mouselook complexity.
const MAX_AIM_ANGLE_DEG = 40;

let charging = false;
let aimAngleDeg = 0;

function aimAngleFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const fx = (e.clientX - rect.left) / rect.width; // 0..1 across the canvas
  const clamped = Math.max(0, Math.min(1, fx));
  return (clamped - 0.5) * 2 * MAX_AIM_ANGLE_DEG;
}

canvas.addEventListener('mousedown', (e) => {
  if (game.state !== STATE.MENU && game.state !== STATE.RESULT) return;
  charging = true;
  game.state = STATE.CHARGING;
  aimAngleDeg = aimAngleFromEvent(e);
  castController = new CastController(economy.getEquippedStats('rod'));
  castController.startCharging();
});

canvas.addEventListener('mousemove', (e) => {
  if (!charging) return;
  aimAngleDeg = aimAngleFromEvent(e);
});

window.addEventListener('mouseup', () => {
  if (game.state !== STATE.CHARGING) return;
  charging = false;
  game.cast = castController.release(aimAngleDeg);
  game.castElapsed = 0;
  game.sinceRelease = 0;
  game.cutCast = false;
  game.state = STATE.CAST_FLIGHT;
});

// Reel input: Space is tracked in every state, so a hold carries from retrieve into a fight.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  game.reelInput = 1;
  if (game.state === STATE.CAST_FLIGHT && !e.repeat) game.cutCast = true;
});
window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  game.reelInput = 0;
});
window.addEventListener('blur', () => {
  game.reelInput = 0;
});

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
      const bite = trySpawnBite({ landingDistance: lureDistance }, game.waitElapsed, dt, economy.getEquippedStats('lure'));
      if (bite) {
        const timing = fightTiming(bite, lureDistance, game.sinceRelease);
        game.hookedFish = new HookedFish(bite, timing.budgetS);
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
        finishFight({ caught: false, reason: step.outcome, species: game.hookedFish.species });
      } else if (step.outcome === 'landed') {
        const species = game.hookedFish.species;
        const weight = game.hookedFish.weight;
        const sellPrice = getSellPrice(species, weight);
        const { earned, isRecord } = economy.recordCatch(species, weight, sellPrice);
        finishFight({ caught: true, species, weight, isRecord, soldFor: earned });
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
  });

  idleShopButton.hidden = game.state !== STATE.MENU || menuOverlay.classList.contains('active');
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
