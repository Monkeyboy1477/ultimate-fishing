import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformAdsAvailable, platformAdBreak, platformRewardedAd } from '../platformAds.js';

// Neither window.PokiSDK nor window.CrazyGames exists in this Node test environment, so the
// dispatcher must fall through to "no ad platform available" and behave like a safe no-op.

test('platformAdsAvailable is false with no portal SDK present', () => {
  assert.equal(platformAdsAvailable(), false);
});

test('platformAdBreak still resumes the caller and resolves with no portal SDK', async () => {
  const calls = [];
  await platformAdBreak({ onPause: () => calls.push('pause'), onResume: () => calls.push('resume') });
  assert.deepEqual(calls, ['resume']);
});

test('platformRewardedAd resolves false and still resumes the caller with no portal SDK', async () => {
  const calls = [];
  const success = await platformRewardedAd({ onPause: () => calls.push('pause'), onResume: () => calls.push('resume') });
  assert.equal(success, false);
  assert.deepEqual(calls, ['resume']);
});
