// achievements.js — static achievement definitions and the check that unlocks new ones.
// Each achievement's `check` reads a plain context object built off one economy instance,
// so the same list works for single-player and for either wallet in 2P: checkNewAchievements
// is called once per economy, wherever that economy's stats might have just changed (after a
// catch, and once at session start to cover streak changes and pre-existing save data).

import { FISH_SPECIES } from './fish.js';

export const ACHIEVEMENTS = [
  { id: 'first_catch', name: 'First Catch', description: 'Catch your first fish.', reward: 25,
    check: (ctx) => ctx.stats.catchCount >= 1 },
  { id: 'catches_10', name: 'Getting the Hang of It', description: 'Catch 10 fish.', reward: 50,
    check: (ctx) => ctx.stats.catchCount >= 10 },
  { id: 'catches_50', name: 'Seasoned Angler', description: 'Catch 50 fish.', reward: 150,
    check: (ctx) => ctx.stats.catchCount >= 50 },
  { id: 'catches_100', name: 'Master Angler', description: 'Catch 100 fish.', reward: 400,
    check: (ctx) => ctx.stats.catchCount >= 100 },
  { id: 'big_one', name: 'Big One', description: 'Catch a fish over 20 lb.', reward: 75,
    check: (ctx) => ctx.stats.bestWeight >= 20 },
  { id: 'collector_5', name: 'Collector', description: 'Catch 5 different species.', reward: 100,
    check: (ctx) => ctx.collectionCount >= 5 },
  { id: 'collector_all', name: 'Encyclopedia', description: 'Catch every species in the Fish Book.', reward: 500,
    check: (ctx) => ctx.collectionCount >= ctx.totalSpecies },
  { id: 'streak_3', name: 'Regular', description: 'Log in 3 days in a row.', reward: 50,
    check: (ctx) => ctx.streak >= 3 },
  { id: 'streak_7', name: 'Dedicated', description: 'Log in 7 days in a row.', reward: 200,
    check: (ctx) => ctx.streak >= 7 },
];

export function checkNewAchievements(economy) {
  const context = {
    stats: economy.getStats(),
    collectionCount: FISH_SPECIES.filter((species) => economy.getCollectionEntry(species.id)).length,
    totalSpecies: FISH_SPECIES.length,
    streak: economy.getLoginStreak(),
  };
  const unlocked = [];
  ACHIEVEMENTS.forEach((achievement) => {
    if (!economy.isAchievementUnlocked(achievement.id) && achievement.check(context)) {
      economy.unlockAchievement(achievement.id, achievement.reward);
      unlocked.push(achievement);
    }
  });
  return unlocked;
}
