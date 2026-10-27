// Umtimatefishing — core game loop and state machine.
// This file is the integration point. It only orchestrates; the realism
// (physics, fish AI, 3D rendering, UI) lives in the imported modules below,
// each of which must conform to the API documented next to its import.

import { CastController } from './casting3d.js';
import { LineTensionSystem } from './tension.js';
import { FISH_SPECIES, trySpawnBite, HookedFish, getSellPrice } from './fish.js';
import { initScene, renderScene3D, spawnSplash3D } from './scene3d.js';
import { renderHUD } from './render.js';
import { initMenus, showCatchResult, updateHUDSummary, updateCurrencyDisplay } from './ui.js';
import { createEconomy } from './economy.js';

const canvas = document.getElementById('game-canvas');
const hudOverlay = document.getElementById('hud-overlay');
const menuOverlay = document.getElementById('menu-overlay');
const topBar = {
  catchCount: document.getElementById('catch-count'),
  bestCatch: document.getElementById('best-catch'),
  currency: document.getElementById('currency-display'),
};

const economy = createEconomy();

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
  game.state = STATE.CAST_FLIGHT;
});

// Reel input: hold Space while fighting a fish.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  if (game.state === STATE.FIGHTING) game.reelInput = 1;
});
window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  game.reelInput = 0;
});

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
      if (game.castElapsed >= game.cast.flightDuration) {
        spawnSplash3D(game.cast.landingPoint);
        game.waitElapsed = 0;
        game.state = STATE.WAITING_BITE;
      }
      break;
    }
    case STATE.WAITING_BITE: {
      game.waitElapsed += dt;
      const bite = trySpawnBite(game.cast, game.waitElapsed, dt, economy.getEquippedStats('lure'));
      if (bite) {
        game.hookedFish = new HookedFish(bite);
        game.tensionSystem = new LineTensionSystem(economy.getEquippedStats('line').breakThreshold);
        game.tensionState = game.tensionSystem.update(0, { x: 0, y: 0 }, 0);
        game.state = STATE.FIGHTING;
      }
      break;
    }
    case STATE.FIGHTING: {
      const fishUpdate = game.hookedFish.update(dt, game.tensionState);
      game.tensionState = game.tensionSystem.update(
        dt,
        fishUpdate.pullVector,
        game.reelInput
      );

      if (game.tensionState.broken) {
        game.lastResult = { caught: false, reason: 'line_snapped' };
        game.state = STATE.RESULT;
        showCatchResult(menuOverlay, game.lastResult);
      } else if (fishUpdate.escaped) {
        game.lastResult = { caught: false, reason: 'fish_escaped' };
        game.state = STATE.RESULT;
        showCatchResult(menuOverlay, game.lastResult);
      } else if (game.tensionState.landed) {
        const species = game.hookedFish.species;
        const weight = game.hookedFish.weight;
        const sellPrice = getSellPrice(species, weight);
        const { earned, isRecord } = economy.recordCatch(species, weight, sellPrice);
        game.lastResult = { caught: true, species, weight, isRecord, soldFor: earned };
        game.state = STATE.RESULT;
        showCatchResult(menuOverlay, game.lastResult);
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
  });

  renderHUD(hudOverlay, {
    state: game.state,
    chargePower: castController.currentPower,
    tensionState: game.tensionState,
    hookedFish: game.hookedFish,
  });
}

initMenus(menuOverlay, {
  onStartCast: () => {
    game.state = STATE.MENU;
  },
  onRestart: () => {
    game.hookedFish = null;
    game.cast = null;
    game.state = STATE.MENU;
  },
}, economy);

requestAnimationFrame((t) => {
  lastTime = t;
  requestAnimationFrame(tick);
});

export { STATE, FISH_SPECIES };
