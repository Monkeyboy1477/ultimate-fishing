import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EYE_POS, ROD_TIP, HOME_POINT, PLAYER_SEPARATION_M, pointsForOffset } from '../constants.js';

test('pointsForOffset(0) matches the single-player points exactly', () => {
  assert.deepEqual(pointsForOffset(0), { eyePos: EYE_POS, rodTip: ROD_TIP, homePoint: HOME_POINT });
});

test('pointsForOffset shifts only x, on all three points, by the given amount', () => {
  const shifted = pointsForOffset(0.6);
  assert.equal(shifted.eyePos.x, EYE_POS.x + 0.6);
  assert.equal(shifted.eyePos.y, EYE_POS.y);
  assert.equal(shifted.eyePos.z, EYE_POS.z);
  assert.equal(shifted.rodTip.x, ROD_TIP.x + 0.6);
  assert.equal(shifted.homePoint.x, HOME_POINT.x + 0.6);
});

test('PLAYER_SEPARATION_M is a small positive lateral gap that fits the dock', () => {
  assert.ok(PLAYER_SEPARATION_M > 0 && PLAYER_SEPARATION_M < 1.3, 'must fit inside DOCK_HALF_WIDTH * 2');
});
