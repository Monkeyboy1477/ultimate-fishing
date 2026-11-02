// fish.js
// Species data, bite spawning, and the HookedFish fight-simulation model for
// The Reel Deal. Fish are meant to feel like distinct living creatures: each
// species has its own weight range, toughness, and "pullPattern" that drives
// how its pull vector is generated frame to frame during the fight.

import { BITE_DEADLINE_S, CATCH_TIME_LIMIT_S } from './constants.js';
import { getMap } from './maps.js';

// ---------------------------------------------------------------------------
// Species table
// ---------------------------------------------------------------------------

export const FISH_SPECIES = [
  {
    id: 'bluegill',
    name: 'Bluegill',
    minWeight: 0.25,
    maxWeight: 1.5,
    staminaMax: 18,
    pullStrength: 0.30,
    pullPattern: 'erratic',
    preferredDistance: 0.15,
    rarity: 0.95,
    biteChance: 0.38,
    rarityTier: 1,
    color: 0x5d8c6b,
    sellBasePrice: 6,
    sellPricePerPound: 2,
  },
  {
    id: 'rainbow_trout',
    name: 'Rainbow Trout',
    minWeight: 0.5,
    maxWeight: 6,
    staminaMax: 32,
    pullStrength: 0.55,
    pullPattern: 'erratic',
    preferredDistance: 0.45,
    rarity: 0.55,
    biteChance: 0.22,
    rarityTier: 1,
    color: 0x7a9bb0,
    sellBasePrice: 8,
    sellPricePerPound: 2,
  },
  {
    id: 'largemouth_bass',
    name: 'Largemouth Bass',
    minWeight: 1,
    maxWeight: 8,
    staminaMax: 42,
    pullStrength: 0.62,
    pullPattern: 'surge',
    preferredDistance: 0.35,
    rarity: 0.6,
    biteChance: 0.24,
    rarityTier: 2,
    color: 0x4a6b3a,
    sellBasePrice: 4,
    sellPricePerPound: 6,
  },
  {
    id: 'common_carp',
    name: 'Common Carp',
    minWeight: 4,
    maxWeight: 30,
    staminaMax: 65,
    pullStrength: 0.60,
    pullPattern: 'steady',
    preferredDistance: 0.55,
    rarity: 0.4,
    biteChance: 0.16,
    rarityTier: 2,
    color: 0x9c8a5a,
    sellBasePrice: 3,
    sellPricePerPound: 4,
  },
  {
    id: 'northern_pike',
    name: 'Northern Pike',
    minWeight: 2,
    maxWeight: 15,
    staminaMax: 55,
    pullStrength: 0.78,
    pullPattern: 'surge',
    preferredDistance: 0.65,
    rarity: 0.35,
    biteChance: 0.12,
    rarityTier: 2,
    color: 0x3f5c3f,
    sellBasePrice: 5,
    sellPricePerPound: 7,
  },
  {
    id: 'channel_catfish',
    name: 'Channel Catfish',
    minWeight: 5,
    maxWeight: 40,
    staminaMax: 85,
    pullStrength: 0.72,
    pullPattern: 'diving',
    preferredDistance: 0.8,
    rarity: 0.28,
    biteChance: 0.1,
    rarityTier: 2,
    color: 0x6b7b8a,
    sellBasePrice: 5,
    sellPricePerPound: 6,
  },
  // -- rarityTier 3: rare, tough, worth seeking out --------------------------
  {
    id: 'muskellunge',
    name: 'Muskellunge',
    minWeight: 8,
    maxWeight: 38,
    staminaMax: 115,
    pullStrength: 0.85,
    pullPattern: 'surge',
    preferredDistance: 0.68,
    rarity: 0.3,
    biteChance: 0.18,
    rarityTier: 3,
    color: 0x5a6b45,
    sellBasePrice: 12,
    sellPricePerPound: 7,
  },
  {
    id: 'striped_bass',
    name: 'Striped Bass',
    minWeight: 5,
    maxWeight: 45,
    staminaMax: 105,
    pullStrength: 0.82,
    pullPattern: 'diving',
    preferredDistance: 0.72,
    rarity: 0.3,
    biteChance: 0.2,
    rarityTier: 3,
    color: 0x8a95a0,
    sellBasePrice: 11,
    sellPricePerPound: 6,
  },
  {
    id: 'flathead_catfish',
    name: 'Flathead Catfish',
    minWeight: 10,
    maxWeight: 70,
    staminaMax: 130,
    pullStrength: 0.80,
    pullPattern: 'diving',
    preferredDistance: 0.78,
    rarity: 0.26,
    biteChance: 0.16,
    rarityTier: 3,
    color: 0x7a6a3f,
    sellBasePrice: 14,
    sellPricePerPound: 7,
  },
  // -- rarityTier 4: legendary trophy fish ------------------------------------
  {
    id: 'blue_catfish',
    name: 'Blue Catfish',
    minWeight: 20,
    maxWeight: 120,
    staminaMax: 170,
    pullStrength: 0.90,
    pullPattern: 'diving',
    preferredDistance: 0.85,
    rarity: 0.16,
    biteChance: 0.18,
    rarityTier: 4,
    color: 0x5b6b78,
    sellBasePrice: 30,
    sellPricePerPound: 10,
  },
  {
    id: 'lake_sturgeon',
    name: 'Lake Sturgeon',
    minWeight: 15,
    maxWeight: 180,
    staminaMax: 200,
    pullStrength: 0.88,
    pullPattern: 'steady',
    preferredDistance: 0.90,
    rarity: 0.15,
    biteChance: 0.17,
    rarityTier: 4,
    color: 0x6e6a5e,
    sellBasePrice: 35,
    sellPricePerPound: 12,
  },
  {
    id: 'alligator_gar',
    name: 'Alligator Gar',
    minWeight: 30,
    maxWeight: 200,
    staminaMax: 190,
    pullStrength: 0.92,
    pullPattern: 'surge',
    preferredDistance: 0.88,
    rarity: 0.14,
    biteChance: 0.16,
    rarityTier: 4,
    color: 0x4a5a3a,
    sellBasePrice: 40,
    sellPricePerPound: 13,
  },
  {
    id: 'paddlefish',
    name: 'Paddlefish',
    minWeight: 15,
    maxWeight: 100,
    staminaMax: 150,
    pullStrength: 0.80,
    pullPattern: 'steady',
    preferredDistance: 0.82,
    rarity: 0.16,
    biteChance: 0.18,
    rarityTier: 4,
    color: 0x7d8a8f,
    sellBasePrice: 28,
    sellPricePerPound: 9,
  },
  // -- More everyday and rare fish --------------------------------------------
  {
    id: 'yellow_perch',
    name: 'Yellow Perch',
    minWeight: 0.2,
    maxWeight: 2,
    staminaMax: 20,
    pullStrength: 0.32,
    pullPattern: 'erratic',
    preferredDistance: 0.2,
    rarity: 0.8,
    biteChance: 0.3,
    rarityTier: 1,
    color: 0xb8a23a,
    sellBasePrice: 6,
    sellPricePerPound: 2,
  },
  {
    id: 'walleye',
    name: 'Walleye',
    minWeight: 1,
    maxWeight: 12,
    staminaMax: 45,
    pullStrength: 0.6,
    pullPattern: 'steady',
    preferredDistance: 0.5,
    rarity: 0.4,
    biteChance: 0.18,
    rarityTier: 2,
    color: 0x8a8445,
    sellBasePrice: 5,
    sellPricePerPound: 7,
  },
  {
    id: 'smallmouth_bass',
    name: 'Smallmouth Bass',
    minWeight: 1,
    maxWeight: 7,
    staminaMax: 48,
    pullStrength: 0.7,
    pullPattern: 'surge',
    preferredDistance: 0.4,
    rarity: 0.4,
    biteChance: 0.17,
    rarityTier: 2,
    color: 0x6e6a3e,
    sellBasePrice: 5,
    sellPricePerPound: 7,
  },
  {
    id: 'atlantic_salmon',
    name: 'Atlantic Salmon',
    minWeight: 6,
    maxWeight: 60,
    staminaMax: 110,
    pullStrength: 0.84,
    pullPattern: 'surge',
    preferredDistance: 0.7,
    rarity: 0.3,
    biteChance: 0.18,
    rarityTier: 3,
    color: 0x9fb0b8,
    sellBasePrice: 12,
    sellPricePerPound: 7,
  },
  // -- rarityTier 5: legendary giants that need big-game gear -----------------
  {
    id: 'bull_shark',
    name: 'Bull Shark',
    minWeight: 100,
    maxWeight: 500,
    staminaMax: 240,
    pullStrength: 2.4,
    pullPattern: 'surge',
    preferredDistance: 0.85,
    rarity: 0.15,
    biteChance: 0.03,
    rarityTier: 5,
    color: 0x6f7c85,
    sellBasePrice: 1500,
    sellPricePerPound: 30,
  },
  {
    id: 'bluefin_tuna',
    name: 'Bluefin Tuna',
    minWeight: 150,
    maxWeight: 1400,
    staminaMax: 260,
    pullStrength: 2.6,
    pullPattern: 'diving',
    preferredDistance: 0.9,
    rarity: 0.15,
    biteChance: 0.03,
    rarityTier: 5,
    color: 0x1f3a66,
    sellBasePrice: 800,
    sellPricePerPound: 35,
  },
  {
    id: 'swordfish',
    name: 'Swordfish',
    minWeight: 100,
    maxWeight: 1100,
    staminaMax: 250,
    pullStrength: 2.4,
    pullPattern: 'surge',
    preferredDistance: 0.95,
    rarity: 0.15,
    biteChance: 0.03,
    rarityTier: 5,
    color: 0x3b4c63,
    sellBasePrice: 800,
    sellPricePerPound: 40,
  },
  // -- rarityTier 6: mythic monsters, the rarest and strongest fish -----------
  {
    id: 'beluga_sturgeon',
    name: 'Beluga Sturgeon',
    minWeight: 400,
    maxWeight: 2000,
    staminaMax: 340,
    pullStrength: 4.4,
    pullPattern: 'steady',
    preferredDistance: 0.92,
    rarity: 0.05,
    biteChance: 0.013,
    rarityTier: 6,
    color: 0x5e6a6e,
    sellBasePrice: 5000,
    sellPricePerPound: 90,
  },
  {
    id: 'blue_marlin',
    name: 'Blue Marlin',
    minWeight: 200,
    maxWeight: 1800,
    staminaMax: 320,
    pullStrength: 3.7,
    pullPattern: 'surge',
    preferredDistance: 0.97,
    rarity: 0.05,
    biteChance: 0.013,
    rarityTier: 6,
    color: 0x1b4f8f,
    sellBasePrice: 6000,
    sellPricePerPound: 110,
  },
  {
    id: 'great_white_shark',
    name: 'Great White Shark',
    minWeight: 600,
    maxWeight: 4000,
    staminaMax: 360,
    pullStrength: 4.4,
    pullPattern: 'erratic',
    preferredDistance: 1.0,
    rarity: 0.05,
    biteChance: 0.013,
    rarityTier: 6,
    color: 0x7f8b92,
    sellBasePrice: 8000,
    sellPricePerPound: 60,
  },
  // -- Added with the maps: pond, river, lake and ocean fish ------------------
  {
    id: 'pumpkinseed',
    name: 'Pumpkinseed',
    minWeight: 0.1,
    maxWeight: 1,
    staminaMax: 16,
    pullStrength: 0.26,
    pullPattern: 'erratic',
    preferredDistance: 0.2,
    rarity: 0.9,
    biteChance: 0.34,
    rarityTier: 1,
    color: 0xc98a3a,
    sellBasePrice: 5,
    sellPricePerPound: 2,
  },
  {
    id: 'black_crappie',
    name: 'Black Crappie',
    minWeight: 0.25,
    maxWeight: 3,
    staminaMax: 22,
    pullStrength: 0.36,
    pullPattern: 'erratic',
    preferredDistance: 0.45,
    rarity: 0.7,
    biteChance: 0.28,
    rarityTier: 1,
    color: 0x7d8a78,
    sellBasePrice: 6,
    sellPricePerPound: 2,
  },
  {
    id: 'brown_bullhead',
    name: 'Brown Bullhead',
    minWeight: 0.5,
    maxWeight: 4,
    staminaMax: 26,
    pullStrength: 0.4,
    pullPattern: 'diving',
    preferredDistance: 0.7,
    rarity: 0.6,
    biteChance: 0.24,
    rarityTier: 1,
    color: 0x5c4a32,
    sellBasePrice: 6,
    sellPricePerPound: 2,
  },
  {
    id: 'atlantic_mackerel',
    name: 'Atlantic Mackerel',
    minWeight: 0.5,
    maxWeight: 5,
    staminaMax: 24,
    pullStrength: 0.42,
    pullPattern: 'erratic',
    preferredDistance: 0.15,
    rarity: 0.9,
    biteChance: 0.3,
    rarityTier: 1,
    color: 0x3f7f8f,
    sellBasePrice: 7,
    sellPricePerPound: 2,
  },
  {
    id: 'brown_trout',
    name: 'Brown Trout',
    minWeight: 1,
    maxWeight: 20,
    staminaMax: 50,
    pullStrength: 0.68,
    pullPattern: 'surge',
    preferredDistance: 0.55,
    rarity: 0.42,
    biteChance: 0.18,
    rarityTier: 2,
    color: 0x8a6a3a,
    sellBasePrice: 5,
    sellPricePerPound: 6,
  },
  {
    id: 'barracuda',
    name: 'Barracuda',
    minWeight: 3,
    maxWeight: 40,
    staminaMax: 58,
    pullStrength: 0.76,
    pullPattern: 'surge',
    preferredDistance: 0.3,
    rarity: 0.42,
    biteChance: 0.2,
    rarityTier: 2,
    color: 0x8c9aa3,
    sellBasePrice: 6,
    sellPricePerPound: 6,
  },
  {
    id: 'red_snapper',
    name: 'Red Snapper',
    minWeight: 2,
    maxWeight: 35,
    staminaMax: 60,
    pullStrength: 0.7,
    pullPattern: 'diving',
    preferredDistance: 0.45,
    rarity: 0.42,
    biteChance: 0.2,
    rarityTier: 2,
    color: 0xc2453d,
    sellBasePrice: 6,
    sellPricePerPound: 6,
  },
  {
    id: 'lake_trout',
    name: 'Lake Trout',
    minWeight: 5,
    maxWeight: 60,
    staminaMax: 110,
    pullStrength: 0.82,
    pullPattern: 'diving',
    preferredDistance: 0.6,
    rarity: 0.3,
    biteChance: 0.2,
    rarityTier: 3,
    color: 0x5f6f62,
    sellBasePrice: 11,
    sellPricePerPound: 6,
  },
  {
    id: 'mahi_mahi',
    name: 'Mahi-Mahi',
    minWeight: 5,
    maxWeight: 60,
    staminaMax: 110,
    pullStrength: 0.86,
    pullPattern: 'erratic',
    preferredDistance: 0.55,
    rarity: 0.3,
    biteChance: 0.2,
    rarityTier: 3,
    color: 0x3fae6a,
    sellBasePrice: 12,
    sellPricePerPound: 7,
  },
  {
    id: 'yellowfin_tuna',
    name: 'Yellowfin Tuna',
    minWeight: 30,
    maxWeight: 300,
    staminaMax: 175,
    pullStrength: 0.92,
    pullPattern: 'diving',
    preferredDistance: 0.7,
    rarity: 0.16,
    biteChance: 0.18,
    rarityTier: 4,
    color: 0x26406f,
    sellBasePrice: 30,
    sellPricePerPound: 9,
  },
  {
    id: 'sailfish',
    name: 'Sailfish',
    minWeight: 40,
    maxWeight: 220,
    staminaMax: 165,
    pullStrength: 0.9,
    pullPattern: 'surge',
    preferredDistance: 0.8,
    rarity: 0.15,
    biteChance: 0.17,
    rarityTier: 4,
    color: 0x274f86,
    sellBasePrice: 35,
    sellPricePerPound: 12,
  },
  {
    id: 'tiger_shark',
    name: 'Tiger Shark',
    minWeight: 200,
    maxWeight: 1400,
    staminaMax: 255,
    pullStrength: 2.5,
    pullPattern: 'surge',
    preferredDistance: 0.88,
    rarity: 0.15,
    biteChance: 0.03,
    rarityTier: 5,
    color: 0x6c7560,
    sellBasePrice: 1200,
    sellPricePerPound: 30,
  },
];

export const RARITY_TIER_NAMES = {
  1: 'Common',
  2: 'Uncommon',
  3: 'Rare',
  4: 'Trophy',
  5: 'Legendary',
  6: 'Mythic',
};

// Returns the sale price (in dollars) for a catch of the given species and
// weight (lb). Linear base-plus-per-pound model so trophy fish of a rare
// species pay out dramatically more than a small catch of a common one.
export function getSellPrice(species, weight) {
  return species.sellBasePrice + species.sellPricePerPound * weight;
}

// ---------------------------------------------------------------------------
// Bite spawning
// ---------------------------------------------------------------------------

// Normalizes cast distance to a 0..1 proxy across the full span of rod
// upgrade tiers (casting3d.js's own MAX_CAST_DISTANCE_M is per-rod and can be
// overridden up to this ceiling by the best rod tier). This is intentionally
// the top of that range, not the base rod's range, so preferredDistance
// values stay meaningful as players upgrade to longer-casting rods.
const MAX_CAST_DISTANCE_M = 180;

// Bites are a constant-rate random event: nothing for MIN_BITE_WAIT_S, then
// BASE_BITE_RATE per second (times the lure's multiplier), typically landing
// 3-8 seconds into the wait and guaranteed by BITE_DEADLINE_S.
const MIN_BITE_WAIT_S = 1.5;
const BASE_BITE_RATE = 0.2;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// Derives a 0..1 "how far out / how deep" proxy from where the lure landed,
// from casting3d.js's 3D cast result (landingDistance is meters from shore).
// On a map, 1 means that map's farthest water, so small maps still have near and far fish.
function distanceProxy(cast, map) {
  const d = cast?.landingDistance ?? 0;
  return clamp01(d / (map?.maxCastM ?? MAX_CAST_DISTANCE_M));
}

// The fish on a map that will take this lure. With no map, every species counts.
export function eligibleSpeciesFor(lure, mapId) {
  const map = getMap(mapId);
  return FISH_SPECIES.filter(
    (species) => canLureHook(lure, species) && (!map || map.speciesIds.includes(species.id)),
  );
}

// How well a species' preferred distance matches the current cast distance.
// 1.0 at a perfect match, decaying but never hitting zero so any species can
// still occasionally bite anywhere.
function distanceMatch(preferredDistance, distance) {
  const diff = Math.abs(preferredDistance - distance);
  return Math.max(0.12, 1 - diff);
}

// Default lure: the basic/no-upgrade bait. Only attracts rarityTier-1 fish,
// at the baseline bite rate. A caller that hasn't wired up the lure/shop
// system yet (or explicitly passes null) gets this behavior for free.
const DEFAULT_LURE_STATS = { biteRateMultiplier: 1, maxRarityTier: 1, minFishLb: 0 };

// A lure only draws fish that suit its size: nothing rarer than its ceiling, and nothing that
// can't reach its minimum weight, so a big expensive lure stops catching little fish.
export function canLureHook(lure, species) {
  return species.rarityTier <= lure.maxRarityTier && species.maxWeight > (lure.minFishLb ?? 0);
}

export function trySpawnBite(cast, waitElapsed, dt, lureStats, mapId) {
  if (dt <= 0) return null;

  const lure = lureStats || DEFAULT_LURE_STATS;
  const biteRateMultiplier = lure.biteRateMultiplier ?? DEFAULT_LURE_STATS.biteRateMultiplier;

  const eligibleSpecies = eligibleSpeciesFor(lure, mapId);
  if (eligibleSpecies.length === 0) return null;

  if (waitElapsed < MIN_BITE_WAIT_S) return null;
  const deadlineReached = waitElapsed >= BITE_DEADLINE_S - dt;
  if (!deadlineReached && Math.random() >= clamp01(BASE_BITE_RATE * biteRateMultiplier * dt)) {
    return null;
  }

  const distance = distanceProxy(cast, getMap(mapId));
  const weights = eligibleSpecies.map((species) => {
    const match = distanceMatch(species.preferredDistance, distance);
    const weight = species.biteChance * species.rarity * match;
    return { species, weight };
  });
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);

  // A bite happened: pick which species, weighted by their contribution.
  let roll = Math.random() * totalWeight;
  for (const w of weights) {
    roll -= w.weight;
    if (roll <= 0) return w.species;
  }
  return weights[weights.length - 1].species;
}

// ---------------------------------------------------------------------------
// HookedFish: the fight simulation
// ---------------------------------------------------------------------------

// Stamina drain tuning. Drain is expressed in "stamina units per second" and
// then divided by the species' staminaMax, so a bigger staminaMax drains
// proportionally slower (tougher fight).
const DRAIN_BASE = 1.0; // minimum drain just from fighting the hook at all
const DRAIN_PRESSURE = 4.5; // extra drain scaled by how hard the player reels

// When tension/pressure drops below this, the fish is considered
// "unpressured" and starts to recover rather than tire.
const LOW_PRESSURE_THRESHOLD = 0.12;
const REGEN_RATE = 1.6; // stamina units/sec recovered while unpressured

// A fish works itself free after this many consecutive seconds with no reeling.
const REEL_IDLE_ESCAPE_S = 7;
const GIANT_REEL_IDLE_ESCAPE_S = 4; // giants need steady pressure, so they shake loose sooner

// Legendary and mythic fish make hard runs that load the line even with the reel stopped, so
// perfect timing can't save a line that's too weak. Each value sits just above the strongest
// line that fails: legendary needs the Kevlar line, mythic needs the Titanium line.
const GIANT_RUN_TENSION = { 5: 3.7, 6: 4.5 };
const RUN_DURATION_S = 2;

const RUN_END_CLEARANCE_S = 3;
const RUN_WARNING_S = 0.7;

export function runTensionFor(species) {
  return GIANT_RUN_TENSION[species.rarityTier] ?? 0;
}

// Below this stamina fraction the fish is considered "tiring out" for UI
// purposes.
const EXHAUSTED_THRESHOLD = 0.25;

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

export class HookedFish {
  // budgetS: seconds this fight may last; stamina is capped on that same clock.
  // minFishLb: the lure's size floor, so a big lure hooks the bigger fish of a species.
  constructor(species, budgetS = CATCH_TIME_LIMIT_S, minFishLb = 0) {
    this.species = species;
    this.budgetS = budgetS;
    this.fightElapsed = 0;
    this.weight = randomRange(Math.max(species.minWeight, minFishLb), species.maxWeight);
    this.running = false; // true during a giant's run, when the player must stop reeling
    this._runTimer = 1.5 + Math.random();
    this.stamina = 1; // 0..1, full to empty

    this._escapedReported = false;
    this._reelIdleTime = 0;

    // Internal pull-pattern state, shaped differently per pattern but kept
    // on one object so update() stays simple.
    this._pull = {
      angle: Math.random() * Math.PI * 2,
      timer: 0,
      changeTimer: 0.2 + Math.random() * 0.3,
      inBurst: false,
      burstTimer: 0.8 + Math.random() * 1.2,
      wobble: Math.random() * Math.PI * 2,
    };
  }

  _computePullVector(dt) {
    const species = this.species;
    const p = this._pull;
    // Fish pulls weaker as it tires, but never drops to nothing while it has
    // any stamina left at all.
    const strength = species.pullStrength * (0.25 + 0.75 * this.stamina);

    switch (species.pullPattern) {
      case 'steady': {
        // Consistent direction with only a slow drift, and a gentle rhythmic
        // breathing in magnitude.
        p.timer += dt;
        p.angle += (Math.random() - 0.5) * 0.4 * dt;
        const mag = strength * (0.75 + 0.25 * Math.sin(p.timer * 1.3));
        return { x: Math.cos(p.angle) * mag, y: Math.sin(p.angle) * mag };
      }

      case 'erratic': {
        // Frequent random direction changes, bursty magnitude.
        p.changeTimer -= dt;
        if (p.changeTimer <= 0) {
          p.angle = Math.random() * Math.PI * 2;
          p.changeTimer = 0.12 + Math.random() * 0.3;
        }
        const jitter = (Math.random() - 0.5) * 0.5;
        const mag = strength * (0.5 + Math.random() * 0.7);
        return {
          x: Math.cos(p.angle + jitter) * mag,
          y: Math.sin(p.angle + jitter) * mag,
        };
      }

      case 'surge': {
        // Long calm stretches punctuated by sudden hard directional bursts.
        p.burstTimer -= dt;
        if (p.burstTimer <= 0) {
          if (p.inBurst) {
            p.inBurst = false;
            p.burstTimer = 1.4 + Math.random() * 2.4;
          } else {
            p.inBurst = true;
            p.angle = Math.random() * Math.PI * 2;
            p.burstTimer = 0.3 + Math.random() * 0.4;
          }
        }
        const mag = p.inBurst ? strength * 1.6 : strength * 0.2;
        return { x: Math.cos(p.angle) * mag, y: Math.sin(p.angle) * mag };
      }

      case 'diving': {
        // Pulls mostly straight down/away from the rod, with only slight
        // side-to-side wobble.
        p.wobble += dt * 1.5;
        const mag = strength * 1.1;
        const sway = Math.sin(p.wobble) * mag * 0.25;
        return { x: sway, y: mag };
      }

      default:
        return { x: 0, y: 0 };
    }
  }

  update(dt, tensionState, reelInput = 0) {
    if (this._escapedReported) {
      // Already told the caller this fish got away; stay inert afterward.
      return { pullVector: { x: 0, y: 0 }, escaped: false, runTension: 0 };
    }

    const tension = clamp01(tensionState && typeof tensionState.tension === 'number'
      ? tensionState.tension
      : 0);

    if (tension < LOW_PRESSURE_THRESHOLD) {
      this.stamina = Math.min(1, this.stamina + (REGEN_RATE * dt) / this.species.staminaMax);
    } else {
      // Under pressure: drains faster the harder the player reels, slower
      // for tougher (higher staminaMax) species.
      const drain = (DRAIN_BASE + DRAIN_PRESSURE * tension) * dt / this.species.staminaMax;
      this.stamina = Math.max(0, this.stamina - drain);
    }

    this.fightElapsed += dt;
    this.stamina = Math.min(this.stamina, Math.max(0, 1 - this.fightElapsed / this.budgetS));

    this._reelIdleTime = reelInput ? 0 : this._reelIdleTime + dt;
    const idleLimit = runTensionFor(this.species) ? GIANT_REEL_IDLE_ESCAPE_S : REEL_IDLE_ESCAPE_S;
    if (this._reelIdleTime >= idleLimit) {
      this._escapedReported = true;
      this.running = false;
      return { pullVector: { x: 0, y: 0 }, escaped: true, runTension: 0 };
    }

    this._updateRun(dt);
    const pullVector = this._computePullVector(dt);
    return { pullVector, escaped: false, runTension: this.running ? runTensionFor(this.species) : 0 };
  }

  _updateRun(dt) {
    if (!runTensionFor(this.species)) return;
    this._runTimer -= dt;
    if (this._runTimer > 0) return;
    // No run may start this late, so the reel is free to land the fish inside the catch clock.
    if (!this.running && this.fightElapsed + RUN_DURATION_S + RUN_END_CLEARANCE_S >= this.budgetS) return;
    this.running = !this.running;
    this._runTimer = this.running ? RUN_DURATION_S : 2.5 + Math.random() * 2;
  }

  // True during a run and just before one, so the warning gives the player time to let go.
  runIsNear() {
    if (this.running) return true;
    if (!runTensionFor(this.species)) return false;
    const lateInFight = this.fightElapsed + RUN_DURATION_S + RUN_END_CLEARANCE_S >= this.budgetS;
    return !lateInFight && this._runTimer <= RUN_WARNING_S;
  }

  isExhausted() {
    return this.stamina < EXHAUSTED_THRESHOLD;
  }
}
