// Picks whichever portal ad SDK (poki.js or crazygames.js) is actually live in this build, so
// main.js's ad-break call sites and ui.js's rewarded-ad button don't need to know which portal
// they're running on. At most one of pokiAvailable()/crazyGamesAvailable() is ever true, since
// only one portal's SDK script tag is present in any given build.

import { pokiAvailable, pokiCommercialBreak, pokiRewardedBreak } from './poki.js';
import { crazyGamesAvailable, crazyGamesMidgameAd, crazyGamesRewardedAd } from './crazygames.js';

export function platformAdsAvailable() {
  return pokiAvailable() || crazyGamesAvailable();
}

// Call at a natural pause (restarting a cast, closing the shared 2P menu). No reward -- just an
// ad break. Resolves once any ad has finished (or immediately, if neither SDK is available).
export function platformAdBreak(handlers) {
  if (pokiAvailable()) return pokiCommercialBreak(handlers);
  if (crazyGamesAvailable()) return crazyGamesMidgameAd(handlers);
  handlers?.onResume?.();
  return Promise.resolve();
}

// Opt-in rewarded ad (the Shop's "Watch an Ad for +$" button). Resolves true only if the player
// watched the ad to completion and should be paid.
export function platformRewardedAd(handlers) {
  if (pokiAvailable()) return pokiRewardedBreak(handlers);
  if (crazyGamesAvailable()) return crazyGamesRewardedAd(handlers);
  handlers?.onResume?.();
  return Promise.resolve(false);
}
