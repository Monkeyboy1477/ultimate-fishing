import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BITE_DEADLINE_S, CATCH_TIME_LIMIT_S, MAX_RETRIEVE_S } from '../constants.js';
import { CastController, isLureHome, retrieveSpeedFor, stepRetrieve } from '../casting3d.js';
import { FISH_SPECIES, HookedFish, trySpawnBite } from '../fish.js';
import { LineTensionSystem, fightTiming, stepFight } from '../tension.js';
import { LINE_TIERS, LURE_TIERS, ROD_TIERS } from '../economy.js';

const DT = 1 / 60;
const TRIALS = 200;

const alwaysReel = () => 1;
const easeOff = (state) => (state.tension > 0.7 * state.breakThreshold ? 0 : 1);
const neverReel = () => 0;

// A fresh policy per call site would share its queue across fights, which only shifts reaction
// timing by a frame or two between trials.
function delayedEaseOff(frames = 15) {
  const queue = [];
  return (state) => {
    queue.push(easeOff(state));
    return queue.length > frames ? queue.shift() : 1;
  };
}

function releaseCast(rod, power, aim) {
  const controller = new CastController(rod);
  controller.startCharging();
  controller.currentPower = power;
  return controller.release(aim);
}

function waitForBite(cast, lure) {
  for (let wait = DT; ; wait += DT) {
    if (trySpawnBite(cast, wait, DT, lure)) return wait;
  }
}

function simulateCatch(species, line, lure, rod, policy) {
  const cast = releaseCast(rod, Math.random(), (Math.random() - 0.5) * 80);
  let clock = cast.flightDuration + waitForBite(cast, lure);
  const timing = fightTiming(species, cast.landingDistance, clock);
  const fish = new HookedFish(species, timing.budgetS);
  const system = new LineTensionSystem(line.breakThreshold, timing);
  let state = system.update(0, { x: 0, y: 0 }, 0);
  for (;;) {
    const step = stepFight(fish, system, state, DT, policy(state));
    state = step.tensionState;
    clock += DT;
    if (step.outcome) return { outcome: step.outcome, clock };
    assert.ok(clock < 120, 'fight never resolved');
  }
}

function landingRate(species, line, lure, rod, policy) {
  let landed = 0;
  for (let i = 0; i < TRIALS; i += 1) {
    const result = simulateCatch(species, line, lure, rod, policy);
    if (result.outcome === 'landed') {
      landed += 1;
      assert.ok(result.clock <= CATCH_TIME_LIMIT_S, `${species.id} landed at ${result.clock.toFixed(1)}s`);
    }
  }
  return landed / TRIALS;
}

for (const [name, policy] of [['always reel', alwaysReel], ['ease off at 70%', easeOff]]) {
  test(`${name}: every landed catch is within the limit, for every species and line`, () => {
    for (const species of FISH_SPECIES) {
      for (const line of LINE_TIERS) {
        landingRate(species, line, LURE_TIERS[0], ROD_TIERS[ROD_TIERS.length - 1], policy);
      }
    }
  });
}

test('never reeling never lands a fish', () => {
  for (const species of FISH_SPECIES) {
    for (const line of LINE_TIERS) {
      assert.equal(landingRate(species, line, LURE_TIERS[0], ROD_TIERS[0], neverReel), 0, species.id);
    }
  }
});

test('a sensible player with matching gear usually lands every species', () => {
  const rows = FISH_SPECIES.map((species) => {
    const index = species.rarityTier - 1;
    const gear = [LINE_TIERS[index], LURE_TIERS[index], ROD_TIERS[index]];
    return {
      species: species.id,
      tier: species.rarityTier,
      easeOff: landingRate(species, ...gear, easeOff),
      delayed250ms: landingRate(species, ...gear, delayedEaseOff()),
    };
  });
  console.table(rows);
  for (const row of rows) {
    assert.ok(row.easeOff >= 0.8, `${row.species} landed only ${row.easeOff}`);
    assert.ok(row.delayed250ms >= 0.75, `${row.species} landed only ${row.delayed250ms} with a human delay`);
  }
});

test('reeling flat out can still snap the line', () => {
  const catfish = FISH_SPECIES.find((species) => species.id === 'channel_catfish');
  const rate = landingRate(catfish, LINE_TIERS[1], LURE_TIERS[1], ROD_TIERS[1], alwaysReel);
  assert.ok(rate < 0.5, `flat-out reeling landed ${rate}`);
});

test('bites wait at least 1.5s and always arrive by the deadline', () => {
  const cast = { landingDistance: 40 };
  for (const lure of LURE_TIERS) {
    const waits = Array.from({ length: 1000 }, () => waitForBite(cast, lure)).sort((a, b) => a - b);
    assert.ok(waits[0] >= 1.5);
    assert.ok(waits[waits.length - 1] <= BITE_DEADLINE_S + DT);
    console.log(`${lure.id}: median bite wait ${waits[500].toFixed(1)}s`);
  }
});

test('a bite still respects the lure rarity ceiling', () => {
  for (let i = 0; i < 500; i += 1) {
    const species = trySpawnBite({ landingDistance: 100 }, BITE_DEADLINE_S, DT, LURE_TIERS[0]);
    assert.ok(species.rarityTier <= LURE_TIERS[0].maxRarityTier);
  }
});

test('a free retrieve reaches home within the limit from any cast', () => {
  for (const rod of ROD_TIERS) {
    for (const power of [0, 0.5, 1]) {
      for (const aim of [-40, 0, 40]) {
        let pos = releaseCast(rod, power, aim).landingPoint;
        const speed = retrieveSpeedFor(pos);
        let elapsed = 0;
        while (!isLureHome(pos)) {
          pos = stepRetrieve(pos, speed, DT);
          elapsed += DT;
          assert.ok(elapsed <= MAX_RETRIEVE_S + DT, `retrieve took over ${MAX_RETRIEVE_S}s`);
        }
      }
    }
  }
});

test('a lure cut off over the dock counts as home', () => {
  const cast = releaseCast(ROD_TIERS[0], 1, 0);
  assert.equal(isLureHome(cast.trajectoryFn(0)), true);
  assert.equal(isLureHome(cast.landingPoint), false);
});
