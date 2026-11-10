// Poki SDK integration — see https://developers.poki.com/guide/sdk-html5 for the contract
// these calls follow. Every function is a safe no-op when window.PokiSDK isn't present (the
// itch.io and GitHub Pages builds never load the Poki script tag), so this module is shared by
// every build rather than forked per portal.

function sdk() {
  return typeof window !== 'undefined' ? window.PokiSDK : undefined;
}

// Whether a rewarded/commercial break can actually run right now (the Poki build only).
export function pokiAvailable() {
  return !!sdk();
}

export function pokiInit() {
  const s = sdk();
  if (!s) return Promise.resolve();
  return s.init().catch(() => {});
}

export function pokiLoadingFinished() {
  sdk()?.gameLoadingFinished();
}

// gameplayStart()/gameplayStop() must never fire twice in a row (Poki's requirement), so this
// tracks the last call made and only forwards an edge, regardless of how many call sites (both
// players in 2P mode, the shared pause menu, etc.) ask for the same transition.
let gameplayActive = false;

export function pokiGameplayStart() {
  const s = sdk();
  if (!s || gameplayActive) return;
  gameplayActive = true;
  s.gameplayStart();
}

export function pokiGameplayStop() {
  const s = sdk();
  if (!s || !gameplayActive) return;
  gameplayActive = false;
  s.gameplayStop();
}

// Call at a natural pause (e.g. "Cast Again", resuming from the shared pause menu). Mutes via
// onPause before the break and restores via onResume once it's done; both run even with no SDK
// present so callers can pass their real resume logic unconditionally.
export function pokiCommercialBreak({ onPause, onResume } = {}) {
  const s = sdk();
  if (!s) {
    onResume?.();
    return Promise.resolve();
  }
  return s.commercialBreak(() => onPause?.()).then(() => onResume?.());
}

export function pokiRewardedBreak({ onPause, onResume } = {}) {
  const s = sdk();
  if (!s) {
    onResume?.();
    return Promise.resolve(false);
  }
  return s.rewardedBreak(() => onPause?.()).then((success) => {
    onResume?.();
    return success;
  });
}
