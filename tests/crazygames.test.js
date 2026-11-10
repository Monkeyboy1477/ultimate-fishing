import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crazyGamesAvailable, crazyGamesInit, crazyGamesLoadingStop,
  crazyGamesGameplayStart, crazyGamesGameplayStop, crazyGamesMidgameAd, crazyGamesRewardedAd,
} from '../crazygames.js';

// No `window.CrazyGames` exists in this Node test environment (nor on the itch.io/GitHub Pages
// builds, which never load the CrazyGames SDK script tag), so every call here must be a safe
// no-op, mirroring poki.test.js's coverage of poki.js.

test('crazyGamesAvailable is false and crazyGamesInit resolves with no SDK present', async () => {
  assert.equal(crazyGamesAvailable(), false);
  await assert.doesNotReject(crazyGamesInit());
  assert.equal(crazyGamesAvailable(), false, 'init() with no SDK must not flip availability on');
});

test('crazyGamesLoadingStop/GameplayStart/GameplayStop never throw with no SDK', () => {
  assert.doesNotThrow(() => {
    crazyGamesLoadingStop();
    crazyGamesGameplayStart();
    crazyGamesGameplayStop();
  });
});

test('crazyGamesMidgameAd still pauses/resumes the caller and resolves with no SDK', async () => {
  const calls = [];
  await crazyGamesMidgameAd({ onPause: () => calls.push('pause'), onResume: () => calls.push('resume') });
  assert.deepEqual(calls, ['resume'], 'onPause is only for muting during a real ad; onResume must still run');
});

test('crazyGamesRewardedAd resolves false and still resumes the caller with no SDK', async () => {
  const calls = [];
  const success = await crazyGamesRewardedAd({ onPause: () => calls.push('pause'), onResume: () => calls.push('resume') });
  assert.equal(success, false, 'no ad played, so no reward should be granted');
  assert.deepEqual(calls, ['resume']);
});
