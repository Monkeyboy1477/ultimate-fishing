import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEconomy } from '../economy.js';
import { checkNewAchievements, ACHIEVEMENTS } from '../achievements.js';
import { FISH_SPECIES } from '../fish.js';

function withFakeLocalStorage(fn) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  try { fn(); } finally { delete globalThis.localStorage; }
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

test('claimDailyLoginBonus grants once per day and only once on a fresh save', () => {
  withFakeLocalStorage(() => {
    const economy = createEconomy();
    const startingCurrency = economy.getCurrency();
    const first = economy.claimDailyLoginBonus();
    assert.ok(first, 'first claim of a new save grants a bonus');
    assert.equal(first.amount, 20, 'day-1 streak gets the base bonus with no streak bonus yet');
    assert.equal(first.streak, 1);
    assert.equal(economy.getCurrency(), startingCurrency + 20);

    const second = economy.claimDailyLoginBonus();
    assert.equal(second, null, 'a second claim the same day grants nothing');
    assert.equal(economy.getCurrency(), startingCurrency + 20, 'currency unchanged by the no-op claim');
  });
});

test('claiming on the very next day continues the streak and raises the bonus', () => {
  withFakeLocalStorage(() => {
    const saveKey = 'reel-realism-save-v1';
    const yesterday = dateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    localStorage.setItem(saveKey, JSON.stringify({ lastLoginDate: yesterday, loginStreak: 4, currency: 0 }));

    const economy = createEconomy();
    const result = economy.claimDailyLoginBonus();
    assert.equal(result.streak, 5, 'streak continues from a save claimed yesterday');
    assert.equal(result.amount, 20 + 4 * 5, 'bonus scales with streak day');
  });
});

test('missing a day resets the streak to 1 instead of continuing it', () => {
  withFakeLocalStorage(() => {
    const saveKey = 'reel-realism-save-v1';
    const threeDaysAgo = dateKey(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
    localStorage.setItem(saveKey, JSON.stringify({ lastLoginDate: threeDaysAgo, loginStreak: 9, currency: 0 }));

    const economy = createEconomy();
    const result = economy.claimDailyLoginBonus();
    assert.equal(result.streak, 1, 'a gap in days restarts the streak');
    assert.equal(result.amount, 20, 'restarted streak gets the base bonus only');
  });
});

test('the streak bonus caps out and does not grow forever', () => {
  withFakeLocalStorage(() => {
    const saveKey = 'reel-realism-save-v1';
    const yesterday = dateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    localStorage.setItem(saveKey, JSON.stringify({ lastLoginDate: yesterday, loginStreak: 50, currency: 0 }));

    const economy = createEconomy();
    const result = economy.claimDailyLoginBonus();
    assert.equal(result.amount, 20 + 6 * 5, 'bonus is capped at the day-7+ amount');
  });
});

test('grantBonus adds currency with no other side effects', () => {
  withFakeLocalStorage(() => {
    const economy = createEconomy();
    const before = economy.getCurrency();
    const statsBefore = economy.getStats().catchCount;
    economy.grantBonus(50);
    assert.equal(economy.getCurrency(), before + 50);
    assert.equal(economy.getStats().catchCount, statsBefore, 'grantBonus never touches catch stats');
  });
});

test('unlockAchievement pays out once and never again for the same id', () => {
  withFakeLocalStorage(() => {
    const economy = createEconomy();
    const before = economy.getCurrency();
    assert.equal(economy.unlockAchievement('test_id', 30), true);
    assert.equal(economy.getCurrency(), before + 30);
    assert.equal(economy.isAchievementUnlocked('test_id'), true);

    assert.equal(economy.unlockAchievement('test_id', 30), false, 're-unlocking the same id is a no-op');
    assert.equal(economy.getCurrency(), before + 30, 'no double payout');
  });
});

test('checkNewAchievements unlocks "First Catch" after one landed fish, and never repeats it', () => {
  withFakeLocalStorage(() => {
    const economy = createEconomy();
    assert.deepEqual(checkNewAchievements(economy), [], 'nothing unlocked before any catch');

    economy.recordCatch(FISH_SPECIES[0], 1, 5);
    const unlocked = checkNewAchievements(economy);
    assert.ok(unlocked.some((a) => a.id === 'first_catch'), 'First Catch unlocks after the first recorded catch');

    const reward = ACHIEVEMENTS.find((a) => a.id === 'first_catch').reward;
    const before = economy.getCurrency();
    assert.deepEqual(checkNewAchievements(economy), [], 'already-unlocked achievements are not returned again');
    assert.equal(economy.getCurrency(), before, 'no further payout on the repeat check');
    assert.ok(reward > 0);
  });
});
