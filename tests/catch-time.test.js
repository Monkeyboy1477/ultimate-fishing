import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BITE_DEADLINE_S, CATCH_TIME_LIMIT_S, MAX_RETRIEVE_S } from '../constants.js';
import { CastController, isLureHome, retrieveSpeedFor, stepRetrieve } from '../casting3d.js';
import { FISH_SPECIES, HookedFish, canLureHook, eligibleSpeciesFor, getSellPrice, trySpawnBite } from '../fish.js';
import { LineTensionSystem, fightTiming, stepFight } from '../tension.js';
import { LINE_TIERS, LURE_TIERS, ROD_TIERS, createEconomy } from '../economy.js';
import { MAPS, getMap, mapsForSpecies } from '../maps.js';

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
  const fish = new HookedFish(species, timing.budgetS, lure.minFishLb);
  const system = new LineTensionSystem(line.breakThreshold, timing);
  let state = system.update(0, { x: 0, y: 0 }, 0);
  for (;;) {
    const step = stepFight(fish, system, state, DT, policy(state));
    state = step.tensionState;
    clock += DT;
    if (step.outcome) return { outcome: step.outcome, clock, weight: fish.weight };
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

// Kevlar is the bare minimum for legendary fish and Titanium for mythic ones. A typical player
// is comfortable one line above that minimum.
function matchingGear(species) {
  const lure = LURE_TIERS.find((tier) => canLureHook(tier, species));
  if (species.rarityTier <= 4) {
    const index = species.rarityTier - 1;
    return [LINE_TIERS[index], lure, ROD_TIERS[index]];
  }
  if (species.rarityTier === 5) return [LINE_TIERS[6], lure, ROD_TIERS[5]];
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
    const giant = row.tier >= 5;
    assert.ok(row.easeOff >= (giant ? 0.6 : 0.8), `${row.species} landed only ${row.easeOff}`);
    assert.ok(row.delayed250ms >= (giant ? 0.2 : 0.75), `${row.species} landed only ${row.delayed250ms} with a human delay`);
    if (giant) assert.ok(row.delayed250ms <= 0.85, `${row.species} is too easy at ${row.delayed250ms}`);
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

test('even perfect timing cannot land a giant on a line that is too weak', () => {
  const required = { 5: 'line_kevlar', 6: 'line_titanium' };
  for (const species of FISH_SPECIES.filter((fish) => fish.rarityTier >= 5)) {
    const requiredIndex = LINE_TIERS.findIndex((line) => line.id === required[species.rarityTier]);
    for (const line of LINE_TIERS.slice(0, requiredIndex)) {
      const rate = landingRate(species, line, BEST_LURE, BEST_ROD, easeOff, 80);
      assert.equal(rate, 0, `${species.id} landed ${rate} on ${line.id}`);
    }
    const rate = landingRate(species, LINE_TIERS[requiredIndex], BEST_LURE, BEST_ROD, easeOff, 80);
    assert.ok(rate >= 0.3, `${species.id} landed only ${rate} on ${LINE_TIERS[requiredIndex].id}`);
  }
});

test('bigger lures only catch bigger fish', () => {
  for (const lure of LURE_TIERS) {
    for (let i = 0; i < 1500; i += 1) {
      const cast = { landingDistance: 7 + Math.random() * 173 };
      const species = trySpawnBite(cast, BITE_DEADLINE_S, DT, lure);
      const fish = new HookedFish(species, 20, lure.minFishLb);
      assert.ok(fish.weight >= lure.minFishLb, `${lure.id} hooked a ${fish.weight} lb ${species.id}`);
      assert.ok(fish.weight <= species.maxWeight);
    }
  }
  const floors = LURE_TIERS.map((lure) => lure.minFishLb);
  assert.deepEqual(floors, [...floors].sort((a, b) => a - b));
  assert.equal(LURE_TIERS[0].minFishLb, 0, 'the free bait still catches small fish');
  const bluegill = FISH_SPECIES.find((species) => species.id === 'bluegill');
  assert.equal(canLureHook(BEST_LURE, bluegill), false);
});

test('every species in the Fish Book can be caught with some lure', () => {
  for (const species of FISH_SPECIES) {
    assert.ok(LURE_TIERS.some((lure) => canLureHook(lure, species)), species.id);
  }
});

test('the Fish Book records each species, its count and its best weight', () => {
  const economy = createEconomy();
  const [first, second] = FISH_SPECIES;
  assert.equal(economy.getCollectionEntry(first.id), null);
  assert.equal(economy.recordCatch(first, 1, 5).isNewSpecies, true);
  assert.equal(economy.recordCatch(first, 0.5, 5).isNewSpecies, false);
  assert.deepEqual(economy.getCollectionEntry(first.id), { count: 2, bestWeight: 1 });
  assert.equal(economy.getCollectionEntry(second.id), null);
});

test('rarity with the best lure: legendary is uncommon and mythic rarest', () => {
  const counts = {};
  const samples = 200000;
  for (let i = 0; i < samples; i += 1) {
    const cast = { landingDistance: 40 + Math.random() * 140 };
    const { rarityTier } = trySpawnBite(cast, BITE_DEADLINE_S, DT, BEST_LURE, 'ocean');
    counts[rarityTier] = (counts[rarityTier] || 0) + 1;
  }
  const share = (tier) => (counts[tier] || 0) / samples;
  console.log('bite share by tier', Object.fromEntries(Object.keys(counts).map((tier) => [tier, share(tier).toFixed(3)])));
  assert.ok(share(5) >= 0.08 && share(5) <= 0.3, `legendary share ${share(5)}`);
  assert.ok(share(6) >= 0.01 && share(6) <= 0.05, `mythic share ${share(6)}`);
  assert.ok(share(6) < share(5) && share(5) < share(4), 'rarer tiers bite less often');
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

test('every species lives on a map, and every map id on it exists', () => {
  const ids = new Set(FISH_SPECIES.map((species) => species.id));
  for (const map of MAPS) {
    for (const id of map.speciesIds) assert.ok(ids.has(id), `${map.id} lists unknown ${id}`);
    assert.equal(new Set(map.speciesIds).size, map.speciesIds.length, map.id);
  }
  for (const species of FISH_SPECIES) assert.ok(mapsForSpecies(species.id).length >= 1, species.id);
});

test('saltwater fish only live in the ocean, and freshwater fish never do', () => {
  const ocean = getMap('ocean');
  const saltwater = ['great_white_shark', 'bull_shark', 'tiger_shark', 'blue_marlin', 'swordfish',
    'bluefin_tuna', 'yellowfin_tuna', 'sailfish', 'mahi_mahi', 'red_snapper', 'barracuda', 'atlantic_mackerel'];
  for (const id of saltwater) assert.deepEqual(mapsForSpecies(id).map((map) => map.id), ['ocean'], id);
  for (const id of ['bluegill', 'largemouth_bass', 'lake_sturgeon', 'beluga_sturgeon', 'channel_catfish']) {
    assert.ok(!ocean.speciesIds.includes(id), id);
  }
});

test('a bite only ever comes from the current map', () => {
  for (const map of MAPS) {
    for (const lure of LURE_TIERS) {
      for (let i = 0; i < 400; i += 1) {
        const species = trySpawnBite({ landingDistance: Math.random() * map.maxCastM }, BITE_DEADLINE_S, DT, lure, map.id);
        if (eligibleSpeciesFor(lure, map.id).length === 0) assert.equal(species, null);
        else assert.ok(map.speciesIds.includes(species.id), `${species.id} on ${map.id}`);
      }
    }
  }
});

test('every map can be fished with something from the shop, and maps get pricier', () => {
  for (const map of MAPS) assert.ok(LURE_TIERS.some((lure) => eligibleSpeciesFor(lure, map.id).length > 0), map.id);
  const prices = MAPS.map((map) => map.price);
  assert.equal(prices[0], 0);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  assert.equal(MAPS[MAPS.length - 1].id, 'ocean');
});

test('a cast stays inside the map however strong the rod is', () => {
  for (const map of MAPS) {
    const controller = new CastController(BEST_ROD, map);
    controller.startCharging();
    controller.currentPower = 1;
    const cast = controller.release(40);
    assert.ok(cast.landingDistance <= map.maxCastM + 1e-9, map.id);
    assert.ok(Math.abs(cast.landingLateral) <= map.maxLateralM + 1e-9, map.id);
  }
});

test('buying a map costs money, travels there, and needs enough cash', () => {
  const economy = createEconomy();
  assert.equal(economy.getCurrentMap().id, 'pond');
  assert.equal(economy.travelTo('river'), false);
  assert.deepEqual(economy.buyMap('river'), { ok: false, reason: 'cannot_afford' });
  const river = getMap('river');
  economy.recordCatch(FISH_SPECIES[0], 1, river.price);
  const before = economy.getCurrency();
  assert.deepEqual(economy.buyMap('river'), { ok: true });
  assert.equal(economy.getCurrency(), before - river.price);
  assert.equal(economy.getCurrentMap().id, 'river');
  assert.equal(economy.travelTo('pond'), true);
  assert.deepEqual(economy.buyMap('river'), { ok: false, reason: 'already_owned' });
});

// Buys the cheapest next item as soon as it's affordable, and fishes the newest map it owns with
// the biggest lure that still gets bites there.
function playThrough() {
  const owned = { rod: 0, line: 0, lure: 0, map: 0 };
  const tables = { rod: ROD_TIERS, line: LINE_TIERS, lure: LURE_TIERS, map: MAPS };
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
    const map = MAPS[owned.map];
    const lure = LURE_TIERS.slice(0, owned.lure + 1).reverse().find((tier) => eligibleSpeciesFor(tier, map.id).length > 0)
      ?? LURE_TIERS[0];
    const species = trySpawnBite(
      { landingDistance: 7 + Math.random() * (Math.min(rod.maxDistance, map.maxCastM) - 7) },
      BITE_DEADLINE_S,
      DT,
      lure,
      eligibleSpeciesFor(lure, map.id).length > 0 ? map.id : undefined,
    );
    const result = simulateCatch(species, LINE_TIERS[owned.line], lure, rod, delayedEaseOff());
    attempts += 1;
    seconds += result.clock + 4;
    if (result.outcome === 'landed') cash += getSellPrice(species, result.weight);
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
