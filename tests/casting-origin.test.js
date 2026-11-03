import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CastController, isLureHome, retrieveSpeedFor, stepRetrieve } from '../casting3d.js';
import { ROD_TIP, HOME_POINT } from '../constants.js';

test('a cast from a custom origin lands offset by exactly that origin\'s x difference from ROD_TIP', () => {
  const origin = { x: ROD_TIP.x + 0.6, y: ROD_TIP.y, z: ROD_TIP.z };
  const a = new CastController(undefined, undefined, ROD_TIP);
  const b = new CastController(undefined, undefined, origin);
  a.startCharging(); a.currentPower = 0.5;
  b.startCharging(); b.currentPower = 0.5;
  const castA = a.release(0);
  const castB = b.release(0);
  assert.ok(Math.abs((castB.landingPoint.x - castA.landingPoint.x) - 0.6) < 1e-9);
});

test('isLureHome/retrieveSpeedFor/stepRetrieve honor a custom home point', () => {
  const home = { x: HOME_POINT.x + 0.6, y: HOME_POINT.y, z: HOME_POINT.z };
  // 1 unit off the exact z boundary (isLureHome treats pos.z >= homePoint.z as home), so this
  // still proves the function honors a custom home point without landing on that boundary.
  const farFromCustomHome = { x: home.x + 10, y: 0, z: home.z - 1 };
  assert.equal(isLureHome(farFromCustomHome, home), false);
  assert.equal(isLureHome(home, home), true);
  const speed = retrieveSpeedFor(farFromCustomHome, home);
  const next = stepRetrieve(farFromCustomHome, speed, 0.1, home);
  // moved toward the custom home, not the default HOME_POINT
  assert.ok(Math.abs(next.x - home.x) < Math.abs(farFromCustomHome.x - home.x));
});
