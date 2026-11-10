// CrazyGames SDK integration — see https://docs.crazygames.com/sdk/intro/ for the contract
// these calls follow. The SDK script tag is only added to the CrazyGames build's index.html
// (see the packaging script), so window.CrazyGames is undefined on every other build (itch.io,
// GitHub Pages) and every function here is a safe no-op there, the same way poki.js handles
// window.PokiSDK being absent. This module is shared by every build rather than forked per portal.

function sdk() {
  return typeof window !== 'undefined' ? window.CrazyGames?.SDK : undefined;
}

// True once init() has resolved and the SDK isn't running in CrazyGames' "disabled" environment
// (their docs: calls made in that environment throw, so every other export below gates on this
// instead of just on sdk() existing).
let ready = false;

export function crazyGamesAvailable() {
  return ready;
}

export function crazyGamesInit() {
  const s = sdk();
  if (!s) return Promise.resolve();
  return s.init().then(() => {
    ready = s.environment !== 'disabled';
  }).catch(() => {});
}

export function crazyGamesLoadingStop() {
  if (ready) sdk().game.loadingStop();
}

// gameplayStart()/gameplayStop() must never fire twice in a row, so this tracks the last call
// made and only forwards an edge -- mirrors poki.js's pokiGameplayStart/Stop exactly.
let gameplayActive = false;

export function crazyGamesGameplayStart() {
  if (!ready || gameplayActive) return;
  gameplayActive = true;
  sdk().game.gameplayStart();
}

export function crazyGamesGameplayStop() {
  if (!ready || !gameplayActive) return;
  gameplayActive = false;
  sdk().game.gameplayStop();
}

// Shared by crazyGamesMidgameAd/crazyGamesRewardedAd below. Mutes via onPause once the ad
// actually starts (not just on request) and restores via onResume once it finishes or errors;
// both run even with no SDK present so callers can pass their real resume logic unconditionally.
function requestAd(type, { onPause, onResume } = {}) {
  if (!ready) {
    onResume?.();
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    sdk().ad.requestAd(type, {
      adStarted: () => onPause?.(),
      adFinished: () => { onResume?.(); resolve(true); },
      adError: () => { onResume?.(); resolve(false); },
    });
  });
}

// Call at a natural pause (e.g. "Cast Again", resuming from the shared pause menu) -- same
// moments main.js already calls poki.js's pokiCommercialBreak at.
export function crazyGamesMidgameAd(handlers) {
  return requestAd('midgame', handlers);
}

export function crazyGamesRewardedAd(handlers) {
  return requestAd('rewarded', handlers);
}
