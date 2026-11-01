import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BITE_DEADLINE_S, CATCH_TIME_LIMIT_S, MAX_RETRIEVE_S } from '../constants.js';
import { CastController, isLureHome, retrieveSpeedFor, stepRetrieve } from '../casting3d.js';
import { FISH_SPECIES, HookedFish, getSellPrice, trySpawnBite } from '../fish.js';
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

function landingRate(species, line, lure, rod, policy, trials = TRIALS) {
  let landed = 0;
  for (let i = 0; i < trials; i += 1) {
    const result = simulateCatch(species, line, lure, rod, policy);
    if (result.outcome === 'landed') {
      landed += 1;
      assert.ok(result.clock <= CATCH_TIME_LIMIT_S, `${species.id} landed at ${result.clock.toFixed(1)}s`);
    }
  }
  return landed / trials;
}

// Legendary fish need the Kevlar line onward; mythic fish need the top line.
function matchingGear(species) {
  const lure = LURE_TIERS.find((tier) => tier.maxRarityTier >= species.rarityTier);
  if (species.rarityTier <= 4) {
    const index = species.rarityTier - 1;
    return [LINE_TIERS[index], lure, ROD_TIERS[index]];
  }
  if (species.rarityTier === 5) return [LINE_TIERS[5], lure, ROD_TIERS[5]];
  return [LINE_TIERS[LINE_TIERS.length - 1], lure, ROD_TIERS[ROD_TIERS.length - 1]];
}

const MYTHIC = FISH_SPECIES.filter((species) => species.rarityTier === 6);
const BEST_LURE = LURE_TIERS[LURE_TIERS.length - 1];
const BEST_ROD = ROD_TIERS[ROD_TIERS.length - 1];

for (const [name, policy] of [['always reel', alwaysReel], ['ease off at 70%', easeOff]]) {
  test(`${name}: every landed catch is within the limit, for every species and line`, () => {
    for (const species of FISH_SPECIES) {
      for (const line of LINE_TIERS) {
        landingRate(species, line, LURE_TIERS[0], BEST_ROD, policy, 60);
      }
    }
  });
}

test('never reeling never lands a fish', () => {
  for (const species of FISH_SPECIES) {
    for (const line of LINE_TIERS) {
      assert.equal(landingRate(species, line, LURE_TIERS[0], ROD_TIERS[0], neverReel, 40), 0, species.id);
    }
  }
});

test('a sensible player with matching gear usually lands every species', () => {
  const rows = FISH_SPECIES.map((species) => {
    const gear = matchingGear(species);
    return {
      species: species.id,
      tier: species.rarityTier,
      easeOff: landingRate(species, ...gear, easeOff),
      delayed250ms: landingRate(species, ...gear, delayedEaseOff()),
    };
  });
  console.table(rows);
  for (const row of rows) {
    const floor = row.tier >= 5 ? 0.6 : 0.75;
    assert.ok(row.easeOff >= 0.8, `${row.species} landed only ${row.easeOff}`);
    assert.ok(row.delayed250ms >= floor, `${row.species} landed only ${row.delayed250ms} with a human delay`);
  }
});

test('mythic fish snap the starter line and everything below the top two lines', () => {
  const rows = [];
  for (const species of MYTHIC) {
    const onStarter = landingRate(species, LINE_TIERS[0], BEST_LURE, BEST_ROD, delayedEaseOff());
    assert.ok(onStarter <= 0.02, `${species.id} landed ${onStarter} on starter line`);
    for (const line of LINE_TIERS.slice(0, -2)) {
      const rate = landingRate(species, line, BEST_LURE, BEST_ROD, delayedEaseOff());
      rows.push({ species: species.id, line: line.id, delayed250ms: rate });
      assert.ok(rate <= 0.1, `${species.id} landed ${rate} on ${line.id}`);
    }
  }
  console.table(rows);
});

test('rarity with the best lure: legendary about 5% of bites, mythic 1-2%', () => {
  const counts = {};
  const samples = 200000;
  for (let i = 0; i < samples; i += 1) {
    const cast = { landingDistance: 40 + Math.random() * 140 };
    const { rarityTier } = trySpawnBite(cast, BITE_DEADLINE_S, DT, BEST_LURE);
    counts[rarityTier] = (counts[rarityTier] || 0) + 1;
  }
  const share = (tier) => (counts[tier] || 0) / samples;
  console.log('bite share by tier', Object.fromEntries(Object.keys(counts).map((tier) => [tier, share(tier).toFixed(3)])));
  assert.ok(share(5) >= 0.035 && share(5) <= 0.065, `legendary share ${share(5)}`);
  assert.ok(share(6) >= 0.01 && share(6) <= 0.02, `mythic share ${share(6)}`);
  assert.ok(share(6) < share(5) && share(5) < share(4) && share(4) < share(3), 'rarer tiers bite less often');
});

test('only the top lure attracts mythic fish, and legendary fish need a big-game lure', () => {
  for (const lure of LURE_TIERS) {
    for (let i = 0; i < 2000; i += 1) {
      const species = trySpawnBite({ landingDistance: 170 }, BITE_DEADLINE_S, DT, lure);
      assert.ok(species.rarityTier <= lure.maxRarityTier, `${lure.id} hooked ${species.id}`);
    }
  }
  assert.equal(LURE_TIERS.filter((lure) => lure.maxRarityTier >= 6).length, 1);
  assert.equal(LURE_TIERS.find((lure) => lure.id === 'lure_legendary').maxRarityTier, 4);
});

test('all saved gear ids still exist and every tier has its visual data', () => {
  const ids = [...ROD_TIERS, ...LINE_TIERS, ...LURE_TIERS].map((tier) => tier.id);
  for (const id of ['rod_starter', 'rod_graphite', 'rod_carbon', 'rod_tournament',
    'line_starter', 'line_braided', 'line_fluoro', 'line_deepsea',
    'lure_basic', 'lure_spinner', 'lure_jig', 'lure_legendary']) {
    assert.ok(ids.includes(id), id);
  }
  for (const rod of ROD_TIERS) for (const key of ['blankColor', 'gripColor', 'accentColor']) assert.equal(typeof rod.visual[key], 'number');
  for (const line of LINE_TIERS) assert.equal(typeof line.visual.color, 'number');
  const kinds = ['bobber', 'spinner', 'jig', 'spoon', 'crankbait', 'popper', 'squid', 'livebait'];
  for (const lure of LURE_TIERS) assert.ok(kinds.includes(lure.visual.kind), lure.id);
  assert.equal(new Set(ids).size, ids.length);
});

// Buys the cheapest next tier in any category as soon as it's affordable.
function playThrough() {
  const owned = { rod: 0, line: 0, lure: 0 };
  const tables = { rod: ROD_TIERS, line: LINE_TIERS, lure: LURE_TIERS };
  const steps = [];
  let cash = 25;
  let attempts = 0;
  let seconds = 0;
  for (;;) {
    const next = Object.keys(tables)
      .filter((category) => owned[category] < tables[category].length - 1)
      .map((category) => ({ category, tier: tables[category][owned[category] + 1] }))
      .sort((a, b) => a.tier.price - b.tier.price)[0];
    if (!next) return { steps, seconds };
    const rod = ROD_TIERS[owned.rod];
    const lure = LURE_TIERS[owned.lure];
    const species = trySpawnBite(
      { landingDistance: 7 + Math.random() * (rod.maxDistance - 7) },
      BITE_DEADLINE_S,
      DT,
      lure,
    );
    const result = simulateCatch(species, LINE_TIERS[owned.line], lure, rod, delayedEaseOff());
    attempts += 1;
    seconds += result.clock + 4;
    if (result.outcome === 'landed') cash += getSellPrice(species, randomWeight(species));
    while (cash >= next.tier.price) {
      cash -= next.tier.price;
      owned[next.category] += 1;
      steps.push({ id: next.tier.id, price: next.tier.price, attempts });
      attempts = 0;
      break;
    }
    assert.ok(seconds < 24 * 3600, 'progression stalled');
  }
}

function randomWeight(species) {
  return species.minWeight + Math.random() * (species.maxWeight - species.minWeight);
}

test('pacing: first upgrade in 5-8 catches, later tiers in a steady grind, top gear in a few hours', () => {
  const runs = Array.from({ length: 25 }, playThrough);
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const rows = runs[0].steps.map((step) => ({ ...step }));
  const table = [];
  const ids = new Set(runs.flatMap((run) => run.steps.map((step) => step.id)));
  for (const id of ids) {
    const found = runs.map((run) => run.steps.find((step) => step.id === id));
    table.push({ id, price: found[0].price, medianAttempts: median(found.map((step) => step.attempts)) });
  }
  table.sort((a, b) => a.price - b.price);
  console.table(table);
  const hours = median(runs.map((run) => run.seconds)) / 3600;
  console.log(`median time to all gear: ${hours.toFixed(1)} hours (${rows.length} purchases)`);

  assert.ok(table[0].medianAttempts >= 5 && table[0].medianAttempts <= 8, `first upgrade took ${table[0].medianAttempts}`);
  for (const row of table) assert.ok(row.medianAttempts <= 45, `${row.id} took ${row.medianAttempts}`);
  assert.ok(hours >= 1 && hours <= 5, `all gear took ${hours.toFixed(1)} hours`);
});

test('legendary and mythic catches are huge paydays', () => {
  const pay = (species) => getSellPrice(species, (species.minWeight + species.maxWeight) / 2);
  for (const species of FISH_SPECIES) {
    if (species.rarityTier === 5) assert.ok(pay(species) >= 10000, species.id);
    if (species.rarityTier === 6) assert.ok(pay(species) >= 100000, species.id);
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
    const species = trySpawnBite({ landingDistance: 100 + Math.random() * 80 }, BITE_DEADLINE_S, DT, LURE_TIERS[0]);
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
