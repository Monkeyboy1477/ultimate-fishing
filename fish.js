// fish.js
// Species data, bite spawning, and the HookedFish fight-simulation model for
// Umtimatefishing. Fish are meant to feel like distinct living creatures: each
// species has its own weight range, toughness, and "pullPattern" that drives
// how its pull vector is generated frame to frame during the fight.

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
    sellBasePrice: 1,
    sellPricePerPound: 1.5,
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
    sellBasePrice: 2.5,
    sellPricePerPound: 2.5,
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
    rarity: 0.12,
    biteChance: 0.05,
    rarityTier: 3,
    color: 0x5a6b45,
    sellBasePrice: 12,
    sellPricePerPound: 14,
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
    rarity: 0.14,
    biteChance: 0.06,
    rarityTier: 3,
    color: 0x8a95a0,
    sellBasePrice: 11,
    sellPricePerPound: 13,
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
    rarity: 0.10,
    biteChance: 0.045,
    rarityTier: 3,
    color: 0x7a6a3f,
    sellBasePrice: 14,
    sellPricePerPound: 16,
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
    rarity: 0.05,
    biteChance: 0.02,
    rarityTier: 4,
    color: 0x5b6b78,
    sellBasePrice: 30,
    sellPricePerPound: 45,
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
    rarity: 0.04,
    biteChance: 0.015,
    rarityTier: 4,
    color: 0x6e6a5e,
    sellBasePrice: 35,
    sellPricePerPound: 55,
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
    rarity: 0.035,
    biteChance: 0.012,
    rarityTier: 4,
    color: 0x4a5a3a,
    sellBasePrice: 40,
    sellPricePerPound: 65,
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
    rarity: 0.045,
    biteChance: 0.018,
    rarityTier: 4,
    color: 0x7d8a8f,
    sellBasePrice: 28,
    sellPricePerPound: 40,
  },
];

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
const MAX_CAST_DISTANCE_M = 130;

// Scales the combined per-species weight into a believable per-frame
// probability. Tuned so a well-placed cast into a species' preferred water
// produces a bite roughly every several seconds once wait time has built up.
const BITE_SCALE = 0.12;

// How quickly bite probability ramps up with wait time. Larger = slower ramp.
const WAIT_RAMP_SECONDS = 5;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// Derives a 0..1 "how far out / how deep" proxy from where the lure landed,
// from casting3d.js's 3D cast result (landingDistance is meters from shore).
function distanceProxy(cast) {
  const d = cast?.landingDistance ?? 0;
  return clamp01(d / MAX_CAST_DISTANCE_M);
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
const DEFAULT_LURE_STATS = { biteRateMultiplier: 1, maxRarityTier: 1 };

export function trySpawnBite(cast, waitElapsed, dt, lureStats) {
  if (dt <= 0) return null;

  const lure = lureStats || DEFAULT_LURE_STATS;
  const maxRarityTier = lure.maxRarityTier ?? DEFAULT_LURE_STATS.maxRarityTier;
  const biteRateMultiplier = lure.biteRateMultiplier ?? DEFAULT_LURE_STATS.biteRateMultiplier;

  // Better lures unlock the ability to hook rarer/bigger fish at all, not
  // just bite faster — species above the lure's rarity ceiling are excluded
  // entirely rather than just weighted down.
  const eligibleSpecies = FISH_SPECIES.filter((species) => species.rarityTier <= maxRarityTier);
  if (eligibleSpecies.length === 0) return null;

  const distance = distanceProxy(cast);
  // Smooth ramp from 0 toward 1 as wait time builds, so bites start rare and
  // become increasingly likely the longer the lure sits still (tension of
  // waiting), capping out rather than spiking instantly.
  const waitFactor = 1 - Math.exp(-Math.max(0, waitElapsed) / WAIT_RAMP_SECONDS);

  const weights = eligibleSpecies.map((species) => {
    const match = distanceMatch(species.preferredDistance, distance);
    const weight = species.biteChance * species.rarity * match * waitFactor;
    return { species, weight };
  });

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) return null;

  // Probability that *some* fish bites this frame.
  const biteProbability = clamp01(totalWeight * BITE_SCALE * dt * biteRateMultiplier);
  if (Math.random() >= biteProbability) return null;

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

// How long (seconds) a fish can sit substantially unpressured, with stamina
// still high, before it works itself free and escapes.
const ESCAPE_NEGLECT_SECONDS = 7;
const ESCAPE_STAMINA_FLOOR = 0.5;

// Below this stamina fraction the fish is considered "tiring out" for UI
// purposes.
const EXHAUSTED_THRESHOLD = 0.25;

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

export class HookedFish {
  constructor(species) {
    this.species = species;
    this.weight = randomRange(species.minWeight, species.maxWeight);
    this.stamina = 1; // 0..1, full to empty

    this._escapedReported = false;
    this._neglectTime = 0;

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
        const mag = p.inBurst ? strength * 2.0 : strength * 0.2;
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

  update(dt, tensionState) {
    if (this._escapedReported) {
      // Already told the caller this fish got away; stay inert afterward.
      return { pullVector: { x: 0, y: 0 }, escaped: false };
    }

    const tension = clamp01(tensionState && typeof tensionState.tension === 'number'
      ? tensionState.tension
      : 0);

    if (tension < LOW_PRESSURE_THRESHOLD) {
      // Neglected: the fish recovers stamina instead of tiring, and racks up
      // time toward wriggling free entirely.
      this.stamina = Math.min(1, this.stamina + (REGEN_RATE * dt) / this.species.staminaMax);
      this._neglectTime += dt;
    } else {
      // Under pressure: drains faster the harder the player reels, slower
      // for tougher (higher staminaMax) species.
      const drain = (DRAIN_BASE + DRAIN_PRESSURE * tension) * dt / this.species.staminaMax;
      this.stamina = Math.max(0, this.stamina - drain);
      // Being pressured works the neglect clock back down rather than an
      // instant reset, so a brief slack moment doesn't erase all risk.
      this._neglectTime = Math.max(0, this._neglectTime - dt * 2);
    }

    if (this._neglectTime >= ESCAPE_NEGLECT_SECONDS && this.stamina >= ESCAPE_STAMINA_FLOOR) {
      this._escapedReported = true;
      return { pullVector: { x: 0, y: 0 }, escaped: true };
    }

    const pullVector = this._computePullVector(dt);
    return { pullVector, escaped: false };
  }

  isExhausted() {
    return this.stamina < EXHAUSTED_THRESHOLD;
  }
}
