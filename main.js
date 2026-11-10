// Ultimate Fishing — core game loop and state machine.
// This file is the integration point. It only orchestrates; the realism
// (physics, fish AI, 3D rendering, UI) lives in the imported modules below,
// each of which must conform to the API documented next to its import.

import { CastController, isLureHome, retrieveSpeedFor, stepRetrieve } from './casting3d.js';
import { LineTensionSystem, fightTiming, stepFight } from './tension.js';
import { FISH_SPECIES, trySpawnBite, HookedFish, eligibleSpeciesFor, getSellPrice, runTensionFor } from './fish.js';
import { pointsForOffset, PLAYER_SEPARATION_M } from './constants.js';
import { initScene, renderScene3D, resizeScene, spawnSplash3D, initSplitScene, renderSplitScene, resizeSplitScene } from './scene3d.js';
import { renderHUD } from './render.js';
import {
  initMenus, showCatchResult, updateHUDSummary, updateCurrencyDisplay, createIdleMenuButtons,
  showModeSelect, showSharedMenu, dismissIdleOrResultPanel, showToast,
} from './ui.js';
import { createEconomy } from './economy.js';
import { installAudio, suspendAudio, resumeAudio } from './audio.js';
import { installTouchControls, isTouchDevice } from './touchControls.js';
import { pokiInit, pokiLoadingFinished, pokiGameplayStart, pokiGameplayStop } from './poki.js';
import { crazyGamesInit, crazyGamesLoadingStop, crazyGamesGameplayStart, crazyGamesGameplayStop } from './crazygames.js';
import { platformAdBreak } from './platformAds.js';
import { checkNewAchievements } from './achievements.js';

const canvas = document.getElementById('game-canvas');
const gameStage = document.getElementById('game-stage');
const hudOverlay = document.getElementById('hud-overlay');
const menuOverlay = document.getElementById('menu-overlay');
// Player 2's panes in 2P mode. Hidden/unused in single-player (see style.css).
const hudOverlayP2 = document.getElementById('hud-overlay-p2');
const menuOverlayP2 = document.getElementById('menu-overlay-p2');
const topBar = {
  catchCount: document.getElementById('catch-count'),
  bestCatch: document.getElementById('best-catch'),
  currency: document.getElementById('currency-display'),
};

// The single-player economy/idle-buttons, built unconditionally exactly as before Task 9.
// Inert in 2P mode: idleMenuButtons.hidden stays true because only setupSinglePlayer's own
// render() ever flips it, and that render() never runs unless '1 Player' is chosen.
const economy = createEconomy();
const idleMenuButtons = createIdleMenuButtons(gameStage, menuOverlay, economy);
installAudio(gameStage);

// Called once per economy at the start of a session: grants the daily login bonus (if today's
// isn't claimed yet) and surfaces any achievement that's newly true -- both as toasts, not
// blocking panels, so a returning player sees them without an extra click. Also covers
// achievements that became true in a past session before this feature existed.
function announceSessionStart(sessionEconomy, label = null) {
  const prefix = label ? `${label}: ` : '';
  const bonus = sessionEconomy.claimDailyLoginBonus();
  if (bonus) showToast(`${prefix}Daily bonus +$${bonus.amount} (day ${bonus.streak} streak)`, 'success');
  checkNewAchievements(sessionEconomy).forEach((achievement) => {
    showToast(`${prefix}Achievement unlocked — ${achievement.name} (+$${achievement.reward})`, 'success');
  });
}

// Fullscreen toggle: independent of 1P/2P mode, wired once at startup. Hidden entirely when the
// Fullscreen API isn't available (iOS Safari, or an embedding iframe that blocks it).
const fullscreenButton = document.getElementById('fullscreen-button');
if (fullscreenButton) {
  if (!document.fullscreenEnabled) {
    fullscreenButton.hidden = true;
  } else {
    const updateFullscreenButton = () => {
      fullscreenButton.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
    };
    fullscreenButton.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    });
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    updateFullscreenButton();
  }
}

const STATE = {
  MENU: 'menu',
  CHARGING: 'charging',
  CAST_FLIGHT: 'cast_flight',
  WAITING_BITE: 'waiting_bite',
  FIGHTING: 'fighting',
  RESULT: 'result',
};

// ---- Per-player state machine ----------------------------------------------
// Everything about running one player's cast/bite/fight cycle lives behind this
// factory, so a later task can create one of these per player for 2P split-screen.
// `elapsedTime` (the shared render clock) stays at module scope below, read here
// only inside getFrameState() by closure, exactly like today's render() does.
function createPlayerController({ economy, originPoints, menuOverlayElement, showShopLinks = true }) {
  const game = {
    state: STATE.MENU,
    cast: null,          // result of CastController.release()
    castElapsed: 0,
    waitElapsed: 0,
    sinceRelease: 0,      // seconds since the cast was released; the catch clock
    lurePos: { ...originPoints.homePoint },
    fightOrigin: null,    // where the fish was hooked; distanceRemaining 1 = here, 0 = homePoint
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
  let castController = new CastController(economy.getEquippedStats('rod'), economy.getCurrentMap(), originPoints.rodTip);

  let aimAngleDeg = 0;
  let touchAimDirection = 0;

  // The one big button casts when the lure is home and reels otherwise. What it does is fixed
  // when it's pressed, so a held REEL that brings the lure home doesn't turn into a cast.
  let actionHeldAs = null;

  function canStartCast() {
    return game.state === STATE.MENU || game.state === STATE.RESULT;
  }

  function startCast() {
    game.state = STATE.CHARGING;
    castController = new CastController(economy.getEquippedStats('rod'), economy.getCurrentMap(), originPoints.rodTip);
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

  function returnLureHome() {
    game.hookedFish = null;
    game.cast = null;
    game.fightOrigin = null;
    game.lastResult = null;
    game.lurePos = { ...originPoints.homePoint };
    game.state = STATE.MENU;
  }

  function lureEntersWater(point) {
    if (isLureHome(point, originPoints.homePoint)) {
      returnLureHome();
      return;
    }
    game.lurePos = { x: point.x, y: 0, z: point.z };
    game.cast = { ...game.cast, landingPoint: game.lurePos, landingDistance: -point.z };
    spawnSplash3D(game.lurePos);
    game.retrieveSpeed = retrieveSpeedFor(game.lurePos, originPoints.homePoint);
    game.waitElapsed = 0;
    game.state = STATE.WAITING_BITE;
  }

  function finishFight(result) {
    game.lastResult = result;
    game.state = STATE.RESULT;
    game.fightOrigin = null;
    game.lurePos = { ...originPoints.homePoint };
    showCatchResult(menuOverlayElement, result, { showShopLinks });
  }

  return {
    onAim(direction) {
      touchAimDirection = direction;
    },

    setAimAngle(deg) {
      aimAngleDeg = deg;
    },

    onActionPress() {
      if (canStartCast()) {
        actionHeldAs = 'cast';
        startCast();
      } else {
        actionHeldAs = 'reel';
        startReel();
      }
    },

    onActionRelease() {
      if (actionHeldAs === 'cast') releaseCast();
      if (actionHeldAs === 'reel') stopReel();
      actionHeldAs = null;
    },

    // Space is tracked in every state (not just via the one-button onActionPress/Release
    // above), so a hold carries from retrieve into a fight. Kept separate from
    // onActionPress/onActionRelease because it needs the keyboard's real isFreshPress
    // (e.repeat) semantics, which a single no-arg "button pressed" method can't carry.
    startReel,
    stopReel,

    // Canvas mouse/pointer "drag to charge" is cast-only and stays independent of the
    // touch overlay's one-button cast-or-reel dispatcher (onActionPress/onActionRelease):
    // a canvas press never touches actionHeldAs, so charging via the canvas can never be
    // left stuck by a concurrent press of the touch button (or vice versa).
    startCast,
    releaseCast,

    isMenuIdle() {
      return canStartCast();
    },

    // Hides this player's own idle start screen or result panel if either is currently
    // showing, the same way clicking that panel's own button would -- without running its
    // onStartCast/onRestart callback. bindPlayerKeys calls this before dispatching a keyboard
    // action-key press that starts a new cast, since (unlike a mouse click) a keyup/keydown
    // isn't blocked by the panel's own DOM/pointer-events stacking. See ui.js's
    // dismissIdleOrResultPanel for why this matters: otherwise the panel stays visible over a
    // cast that's now actually running, and a later "Cast Again" click on it would wipe that
    // cast via returnLureHome().
    dismissPanel() {
      dismissIdleOrResultPanel(menuOverlayElement);
    },

    resetToMenu() {
      game.state = STATE.MENU;
    },

    returnLureHome,

    update(dt) {
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
            game.lurePos = stepRetrieve(game.lurePos, game.retrieveSpeed, dt, originPoints.homePoint);
            if (isLureHome(game.lurePos, originPoints.homePoint)) {
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
            checkNewAchievements(economy).forEach((achievement) => {
              showToast(`Achievement unlocked — ${achievement.name} (+$${achievement.reward})`, 'success');
            });
            finishFight({ caught: true, species, weight, isRecord, isNewSpecies, soldFor: earned });
          }
          break;
        }
        default:
          break;
      }
    },

    getFrameState() {
      return {
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
      };
    },
  };
}

// Wires keydown/keyup window listeners to one player's three input methods, with the same
// "action does whatever it meant when pressed" semantics main.js already uses for the single
// big touch button (see onActionPress/onActionRelease above) -- scoped per player so Player 1
// and Player 2 track their own actionHeldAs independently. Not called anywhere yet; Task 9
// wires this up for real 2P controllers.
//
// leftHeld/rightHeld track which aim key is physically down so that releasing one aim key
// while the other is still held resumes aiming in the still-held key's direction instead of
// snapping back to center -- e.g. hold left, tap-and-release right mid-charge should keep
// aiming left, not zero out. On keydown the most recently pressed key still wins outright
// (matching the touch/mouse aim's single-direction model), same as before this fix.
function bindPlayerKeys(controller, { aimLeftKey, aimRightKey, actionKey, isPaused }) {
  let actionHeldAs = null;
  let aimDirection = 0;
  let leftHeld = false;
  let rightHeld = false;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    // While the shared menu is open, these keys (including Player 2's arrow keys, which
    // double as the shared Shop/Fish Book/Maps panel's normal scroll keys) must behave like
    // the panel has focus, not like a still-live aim/cast input underneath it: skip
    // preventDefault and every dispatch below entirely.
    if (isPaused && isPaused()) return;
    if (e.code === aimLeftKey) { leftHeld = true; aimDirection = -1; }
    else if (e.code === aimRightKey) { rightHeld = true; aimDirection = 1; }
    else if (e.code === actionKey) {
      if (controller.isMenuIdle()) {
        actionHeldAs = 'cast';
        // Dismiss this player's own idle/result panel first -- a keyboard press isn't
        // blocked by the panel's pointer-events the way a mouse click would be, so without
        // this the panel stays visible over the cast that's about to start.
        controller.dismissPanel();
        controller.onActionPress();
      } else { actionHeldAs = 'reel'; controller.onActionPress(); }
    } else return;
    e.preventDefault();
    controller.onAim(aimDirection);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === aimLeftKey || e.code === aimRightKey) {
      if (e.code === aimLeftKey) leftHeld = false;
      else rightHeld = false;
      aimDirection = rightHeld ? 1 : leftHeld ? -1 : 0;
      controller.onAim(aimDirection);
    } else if (e.code === actionKey) {
      controller.onActionRelease();
      actionHeldAs = null;
    } else return;
    e.preventDefault();
  });
  // If the window loses focus while the action key is physically held, its keyup may never
  // fire, leaving this player's reel/charge input stuck "on" (mirrors the single-player
  // Space-key blur handler below). Releases whatever the key currently means; a no-op if it
  // wasn't held.
  window.addEventListener('blur', () => {
    if (actionHeldAs) {
      controller.onActionRelease();
      actionHeldAs = null;
    }
  });
}

// ---- Input handling -------------------------------------------------------
// First-person aiming: horizontal mouse position across the canvas sets the
// lateral aim angle (0 = straight out over the water, positive = right,
// negative = left), matching casting3d.js's documented sign convention. The
// camera itself stays fixed — aim is conveyed by the rod/reticle, like a
// first-person weapon, so there's no pointer-lock/mouselook complexity.
const MAX_AIM_ANGLE_DEG = 40;
const TOUCH_AIM_DEG_PER_S = 45;

// On Poki the game sits inside a scrollable page; stop arrow keys/space/wheel from scrolling
// it out from under the player. Harmless on itch.io/GitHub Pages, where the game already fills
// the viewport and nothing scrolls anyway.
window.addEventListener('keydown', (e) => {
  if (['ArrowDown', 'ArrowUp', ' '].includes(e.key)) e.preventDefault();
});
window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

const PLAYING_STATES = new Set([STATE.CHARGING, STATE.CAST_FLIGHT, STATE.WAITING_BITE, STATE.FIGHTING]);
// Tells whichever portal SDK is live (Poki, CrazyGames) whether the player is actively fishing
// right now vs. idle at a menu/result panel. Safe to call every frame and on every build: each
// platform's gameplayStart/Stop only forwards an actual state change, and is a no-op without
// that platform's SDK.
function syncPlatformGameplay(states) {
  if (states.some((s) => PLAYING_STATES.has(s))) {
    pokiGameplayStart();
    crazyGamesGameplayStart();
  } else {
    pokiGameplayStop();
    crazyGamesGameplayStop();
  }
}

// Set once mode selection resolves (Step 3); read by fitSceneToCanvas (Step 6) to pick
// resizeScene vs resizeSplitScene, since both setup paths share the same ResizeObserver.
let twoPlayer = false;

// The stage fills the window (or the whole screen in full screen), so the 3D view follows its size.
function fitSceneToCanvas() {
  const { clientWidth, clientHeight } = canvas;
  if (clientWidth > 0 && clientHeight > 0) {
    if (twoPlayer) resizeSplitScene(clientWidth, clientHeight);
    else resizeScene(clientWidth, clientHeight);
  }
  const topBarEl = document.getElementById('top-bar');
  if (topBarEl) document.documentElement.style.setProperty('--top-bar-height', `${topBarEl.offsetHeight}px`);
}
new ResizeObserver(fitSceneToCanvas).observe(canvas);

function enableTouchLayout() {
  if (document.body.classList.contains('touch')) return;
  document.body.classList.add('touch');
  fitSceneToCanvas();
}

// Touchscreen laptops report a mouse, so their first touch switches the layout on as well.
if (isTouchDevice()) enableTouchLayout();
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') enableTouchLayout();
}, { capture: true });

// ---- Main loop --------------------------------------------------------------
// Shared by both modes: whichever setup function runs below installs its own per-frame
// update+render as frameTick. Nothing renders until mode selection resolves and calls one.
let lastTime = performance.now();
let elapsedTime = 0;
let frameTick = null;

function tick(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  elapsedTime += dt;

  if (frameTick) frameTick(dt);

  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// 1 Player — unchanged behavior from before Task 9, just moved behind the mode-select
// callback so initScene (vs initSplitScene) only ever runs once per session.
// ---------------------------------------------------------------------------
function setupSinglePlayer() {
  initScene(canvas);

  announceSessionStart(economy);

  const singlePlayer = createPlayerController({ economy, originPoints: pointsForOffset(0), menuOverlayElement: menuOverlay });

  let castPointerId = null; // the mouse or finger holding the canvas to charge a cast

  function aimAngleFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width; // 0..1 across the canvas
    const clamped = Math.max(0, Math.min(1, fx));
    return (clamped - 0.5) * 2 * MAX_AIM_ANGLE_DEG;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!singlePlayer.isMenuIdle()) return;
    castPointerId = e.pointerId;
    singlePlayer.setAimAngle(aimAngleFromEvent(e));
    singlePlayer.startCast();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== castPointerId) return;
    singlePlayer.setAimAngle(aimAngleFromEvent(e));
  });

  function endCanvasCast(e) {
    if (e.pointerId !== castPointerId) return;
    castPointerId = null;
    singlePlayer.releaseCast();
  }
  window.addEventListener('pointerup', endCanvasCast);
  window.addEventListener('pointercancel', endCanvasCast);

  // Reel input: Space is tracked in every state, so a hold carries from retrieve into a fight.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    singlePlayer.startReel(!e.repeat);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    singlePlayer.stopReel();
  });
  window.addEventListener('blur', () => singlePlayer.stopReel());

  const touchControls = installTouchControls(gameStage, {
    onActionPress: () => singlePlayer.onActionPress(),
    onActionRelease: () => singlePlayer.onActionRelease(),
    onAim: (direction) => singlePlayer.onAim(direction),
  });

  function render() {
    const frameState = singlePlayer.getFrameState();
    syncPlatformGameplay([frameState.state]);
    renderScene3D(frameState);

    renderHUD(hudOverlay, {
      state: frameState.state,
      chargePower: frameState.chargePower,
      tensionState: frameState.tensionState,
      hookedFish: frameState.hookedFish,
      touch: document.body.classList.contains('touch'),
      noFishForLure: eligibleSpeciesFor(economy.getEquippedStats('lure'), economy.getCurrentMap().id).length === 0
        && !menuOverlay.classList.contains('active'),
    });

    const menuOpen = menuOverlay.classList.contains('active');
    idleMenuButtons.hidden = frameState.state !== STATE.MENU || menuOpen;
    touchControls.update({
      label: singlePlayer.isMenuIdle() || frameState.state === STATE.CHARGING ? 'CAST' : 'REEL',
      visible: !menuOpen,
      aimEnabled: singlePlayer.isMenuIdle() || frameState.state === STATE.CHARGING,
    });

    updateHUDSummary(topBar, economy.getStats());
    updateCurrencyDisplay(topBar.currency, economy.getCurrency());
  }

  frameTick = (dt) => {
    singlePlayer.update(dt);
    render();
  };

  initMenus(menuOverlay, {
    onStartCast: () => singlePlayer.resetToMenu(),
    onRestart: () => {
      platformAdBreak({ onPause: suspendAudio, onResume: resumeAudio })
        .then(() => singlePlayer.returnLureHome());
    },
  }, economy);

  fitSceneToCanvas();
}

// ---------------------------------------------------------------------------
// 2 Player — Team (one shared wallet) or Competitive (two separate wallets).
// Split canvas via scene3d's two-camera path, two independent HUD panes, two independent
// idle/result panels (no shop links — Shop/Fish Book/Maps only reachable via the shared
// Escape menu), and the shared pause menu that freezes both players' simulation.
// ---------------------------------------------------------------------------
function setupTwoPlayer(economyMode) {
  twoPlayer = true;
  let pausedForMenu = false;

  let economyP1;
  let economyP2;
  if (economyMode === 'team') {
    const shared = createEconomy('-team');
    economyP1 = shared;
    economyP2 = shared;
  } else {
    economyP1 = createEconomy('-p1');
    economyP2 = createEconomy('-p2');
  }

  if (economyMode === 'team') {
    announceSessionStart(economyP1, 'Team');
  } else {
    announceSessionStart(economyP1, 'Player 1');
    announceSessionStart(economyP2, 'Player 2');
  }

  gameStage.classList.add('split-screen');
  initSplitScene(canvas);

  const p1 = createPlayerController({
    economy: economyP1,
    originPoints: pointsForOffset(-PLAYER_SEPARATION_M / 2),
    menuOverlayElement: menuOverlay,
    showShopLinks: false,
  });
  const p2 = createPlayerController({
    economy: economyP2,
    originPoints: pointsForOffset(PLAYER_SEPARATION_M / 2),
    menuOverlayElement: menuOverlayP2,
    showShopLinks: false,
  });

  bindPlayerKeys(p1, {
    aimLeftKey: 'KeyA', aimRightKey: 'KeyD', actionKey: 'KeyS', isPaused: () => pausedForMenu,
  });
  bindPlayerKeys(p2, {
    aimLeftKey: 'ArrowLeft', aimRightKey: 'ArrowRight', actionKey: 'ArrowDown', isPaused: () => pausedForMenu,
  });

  initMenus(menuOverlay, {
    onStartCast: () => p1.resetToMenu(),
    onRestart: () => {
      platformAdBreak({ onPause: suspendAudio, onResume: resumeAudio })
        .then(() => p1.returnLureHome());
    },
  }, economyP1, {
    showShopLinks: false,
    instructionsText: 'Player 1: A/D to aim, hold S to cast and to reel in. Press Escape anytime to open the shared menu (pauses both players).',
  });

  initMenus(menuOverlayP2, {
    onStartCast: () => p2.resetToMenu(),
    onRestart: () => {
      platformAdBreak({ onPause: suspendAudio, onResume: resumeAudio })
        .then(() => p2.returnLureHome());
    },
  }, economyP2, {
    showShopLinks: false,
    instructionsText: 'Player 2: Left/Right arrows to aim, hold Down arrow to cast and to reel in. Press Escape anytime to open the shared menu (pauses both players).',
  });

  function renderPlayerHUD(hudEl, menuEl, frameState, playerEconomy) {
    renderHUD(hudEl, {
      state: frameState.state,
      chargePower: frameState.chargePower,
      tensionState: frameState.tensionState,
      hookedFish: frameState.hookedFish,
      touch: document.body.classList.contains('touch'),
      noFishForLure: eligibleSpeciesFor(playerEconomy.getEquippedStats('lure'), playerEconomy.getCurrentMap().id).length === 0
        && !menuEl.classList.contains('active'),
      // Each half shows its own player's live currency/catch count in Competitive mode, since
      // the two wallets differ there; Team mode already shows the one shared number on the
      // top bar, so this stays off (render.js's statsPanel is just hidden, per-element).
      // Hidden while the shared menu is open: the shared menu already shows both players'
      // numbers via its Player 1/Player 2 tabs, and hud-overlay-p2 stacks above #menu-overlay
      // in DOM order, so this panel would otherwise visually sit on top of the shared menu's
      // own content (pointer-events:none keeps it from blocking clicks either way, but there's
      // no reason to clutter the shared menu with a redundant floating number).
      playerStats: economyMode === 'competitive' && !pausedForMenu
        ? { catchCount: playerEconomy.getStats().catchCount, currency: playerEconomy.getCurrency() }
        : null,
    });
  }

  function render() {
    sharedMenuButton.hidden = pausedForMenu;
    const frameP1 = p1.getFrameState();
    const frameP2 = p2.getFrameState();
    if (!pausedForMenu) syncPlatformGameplay([frameP1.state, frameP2.state]);
    renderSplitScene([frameP1, frameP2]);

    renderPlayerHUD(hudOverlay, menuOverlay, frameP1, economyP1);
    renderPlayerHUD(hudOverlayP2, menuOverlayP2, frameP2, economyP2);

    // The single shared top bar mirrors Player 1's wallet/catch count — in Team mode this is
    // the shared wallet; in Competitive each player's own numbers live in their own Shop
    // (reachable from the shared Escape menu's Player 1/Player 2 tabs), not in this bar.
    updateHUDSummary(topBar, economyP1.getStats());
    updateCurrencyDisplay(topBar.currency, economyP1.getCurrency());
  }

  // Satisfies Review Focus item 1: while the shared menu is open, neither player's state
  // machine advances (no update(dt) calls at all), but renderSplitScene still runs every
  // frame so the frozen scene stays visible behind the menu instead of going blank.
  frameTick = (dt) => {
    if (!pausedForMenu) {
      p1.update(dt);
      p2.update(dt);
    }
    render();
  };

  // Whatever P1's own overlay (idle start screen or a result panel) held before the shared
  // menu opened, so closing the shared menu puts it back instead of leaving P1's half blank.
  // Actual DOM nodes (not innerHTML strings) so Start Fishing/Cast Again keep their listeners.
  let savedMenuChildren = [];
  let savedMenuWasActive = false;

  function closeSharedMenu() {
    platformAdBreak({ onPause: suspendAudio, onResume: resumeAudio }).then(() => {
      menuOverlay.innerHTML = '';
      savedMenuChildren.forEach((node) => menuOverlay.appendChild(node));
      menuOverlay.classList.toggle('active', savedMenuWasActive);
      gameStage.classList.remove('shared-menu-open');
      savedMenuChildren = [];
      pausedForMenu = false;
    });
  }

  function openSharedMenu() {
    pausedForMenu = true;
    pokiGameplayStop();
    crazyGamesGameplayStop();
    savedMenuChildren = Array.from(menuOverlay.childNodes);
    savedMenuWasActive = menuOverlay.classList.contains('active');
    gameStage.classList.add('shared-menu-open');
    const players = economyMode === 'team'
      ? [{ label: 'Team', economy: economyP1 }]
      : [{ label: 'Player 1', economy: economyP1 }, { label: 'Player 2', economy: economyP2 }];
    showSharedMenu(menuOverlay, players, closeSharedMenu);
  }

  // Active only in 2P mode: this listener is only ever registered when setupTwoPlayer runs.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat) return;
    e.preventDefault();
    if (pausedForMenu) closeSharedMenu();
    else openSharedMenu();
  });

  // A visible, clickable equivalent of the Escape key: the shared menu (Shop/Fish Book/
  // Maps/Achievements, both players paused) was previously keyboard-only and easy to never
  // discover. Shown at all times during 2P play, not just when idle (unlike idleMenuButtons,
  // which only ever applies to single-player). Hidden while the shared menu is already open,
  // since it'd otherwise sit underneath that overlay doing nothing.
  const sharedMenuButton = document.createElement('button');
  sharedMenuButton.type = 'button';
  sharedMenuButton.id = 'shared-menu-button';
  sharedMenuButton.className = 'menu-button menu-button-secondary';
  sharedMenuButton.textContent = 'Menu / Shop';
  sharedMenuButton.addEventListener('click', openSharedMenu);
  gameStage.appendChild(sharedMenuButton);

  fitSceneToCanvas();
}

Promise.all([pokiInit(), crazyGamesInit()]).then(() => {
  pokiLoadingFinished();
  crazyGamesLoadingStop();

  showModeSelect(menuOverlay, (choice) => {
    if (choice.mode === '1p') {
      setupSinglePlayer();
    } else {
      setupTwoPlayer(choice.economyMode);
    }
  });

  requestAnimationFrame((t) => {
    lastTime = t;
    requestAnimationFrame(tick);
  });
});

export { STATE, FISH_SPECIES };
