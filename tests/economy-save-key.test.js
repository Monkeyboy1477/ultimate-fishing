import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEconomy } from '../economy.js';
import { FISH_SPECIES } from '../fish.js';

function withFakeLocalStorage(fn) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  try { fn(); } finally { delete globalThis.localStorage; }
}

test('createEconomy() with no suffix keeps using the original single-player save key', () => {
  withFakeLocalStorage(() => {
    const a = createEconomy();
    a.recordCatch(FISH_SPECIES[0], 2, 10);
    const b = createEconomy();
    assert.equal(b.getStats().catchCount, 1, 'second instance with no suffix reads the same save');
  });
});

test('two suffixed economies never share currency or catch stats', () => {
  withFakeLocalStorage(() => {
    const team = createEconomy('-team');
    team.recordCatch(FISH_SPECIES[0], 2, 10);
    const p1 = createEconomy('-p1');
    const p2 = createEconomy('-p2');
    assert.equal(p1.getStats().catchCount, 0);
    assert.equal(p2.getStats().catchCount, 0);
    p1.recordCatch(FISH_SPECIES[0], 1, 5);
    assert.equal(createEconomy('-p1').getStats().catchCount, 1);
    assert.equal(createEconomy('-p2').getStats().catchCount, 0);
    assert.equal(createEconomy('-team').getStats().catchCount, 1);
  });
});
