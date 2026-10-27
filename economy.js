// economy.js
// Currency, gear tiers (rod/line/lure), and persistence for Umtimatefishing's shop system.
// Every catch is auto-sold for cash (see getSellPrice in fish.js); cash buys better gear,
// which feeds real stat overrides into casting3d.js (rod), tension.js (line), and fish.js
// (lure) — this file only owns the data and the save-game state, not the physics/bite logic.

const SAVE_KEY = 'reel-realism-save-v1';

// --- Gear tiers --------------------------------------------------------------
// id 'rod_starter' / 'line_starter' / 'lure_basic' are free and owned from the start.

export const ROD_TIERS = [
  {
    id: 'rod_starter',
    name: 'Starter Rod',
    price: 0,
    maxDistance: 55,
    powerExponent: 1.5,
    description: 'The rod you showed up with. Gets the job done up close.',
  },
  {
    id: 'rod_graphite',
    name: 'Graphite Rod',
    price: 150,
    maxDistance: 75,
    powerExponent: 1.35,
    description: 'Lighter, stiffer blank. Casts farther with more consistent power.',
  },
  {
    id: 'rod_carbon',
    name: 'Pro Carbon Rod',
    price: 500,
    maxDistance: 100,
    powerExponent: 1.2,
    description: 'Tournament-grade carbon fiber. Serious distance, serious control.',
  },
  {
    id: 'rod_tournament',
    name: 'Tournament Rod',
    price: 1500,
    maxDistance: 130,
    powerExponent: 1.05,
    description: "A pro's rod. Near-linear power control and the longest reach money buys.",
  },
];

export const LINE_TIERS = [
  {
    id: 'line_starter',
    name: '6lb Mono Line',
    price: 0,
    breakThreshold: 1.0,
    description: 'Basic monofilament. Snaps under real pressure.',
  },
  {
    id: 'line_braided',
    name: '12lb Braided Line',
    price: 100,
    breakThreshold: 1.4,
    description: 'Braided for extra strength. Holds up to a harder fight.',
  },
  {
    id: 'line_fluoro',
    name: '20lb Fluorocarbon',
    price: 350,
    breakThreshold: 1.9,
    description: 'Low-stretch fluorocarbon. Lets you lean on big fish with confidence.',
  },
  {
    id: 'line_deepsea',
    name: '50lb Deep Sea Line',
    price: 1200,
    breakThreshold: 2.6,
    description: "Built for monsters. You'll need it for the biggest trophies out there.",
  },
];

export const LURE_TIERS = [
  {
    id: 'lure_basic',
    name: 'Basic Bait',
    price: 0,
    biteRateMultiplier: 1.0,
    maxRarityTier: 1,
    description: 'Plain bait. Only the common stuff will bother with it.',
  },
  {
    id: 'lure_spinner',
    name: 'Spinner Lure',
    price: 80,
    biteRateMultiplier: 1.3,
    maxRarityTier: 2,
    description: 'Flash and vibration draw in faster bites from tougher fish.',
  },
  {
    id: 'lure_jig',
    name: 'Premium Jig',
    price: 300,
    biteRateMultiplier: 1.6,
    maxRarityTier: 3,
    description: 'Hand-tuned action. Gets noticed by serious, hard-fighting fish.',
  },
  {
    id: 'lure_legendary',
    name: 'Legendary Lure',
    price: 1000,
    biteRateMultiplier: 2.0,
    maxRarityTier: 4,
    description: 'Said to have landed fish nobody believed were real. Unlocks everything.',
  },
];

const GEAR_TABLES = { rod: ROD_TIERS, line: LINE_TIERS, lure: LURE_TIERS };
const STARTING_CURRENCY = 25;

function findTier(category, id) {
  return GEAR_TABLES[category].find((tier) => tier.id === id) || GEAR_TABLES[category][0];
}

function defaultState() {
  return {
    currency: STARTING_CURRENCY,
    equipped: { rod: 'rod_starter', line: 'line_starter', lure: 'lure_basic' },
    owned: {
      rod: ['rod_starter'],
      line: ['line_starter'],
      lure: ['lure_basic'],
    },
    stats: { catchCount: 0, bestWeight: 0, bestSpecies: null, totalEarnings: 0 },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // Shallow-merge over defaults so a save from an older version with missing fields
    // (e.g. a new gear category added later) doesn't crash the game.
    const base = defaultState();
    return {
      currency: typeof parsed.currency === 'number' ? parsed.currency : base.currency,
      equipped: { ...base.equipped, ...parsed.equipped },
      owned: {
        rod: Array.isArray(parsed.owned?.rod) ? parsed.owned.rod : base.owned.rod,
        line: Array.isArray(parsed.owned?.line) ? parsed.owned.line : base.owned.line,
        lure: Array.isArray(parsed.owned?.lure) ? parsed.owned.lure : base.owned.lure,
      },
      stats: { ...base.stats, ...parsed.stats },
    };
  } catch {
    return defaultState();
  }
}

export function createEconomy() {
  let state = loadState();

  function persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch {
      // Private browsing / storage disabled: play on without persistence.
    }
  }

  return {
    getCurrency() {
      return state.currency;
    },

    getStats() {
      return state.stats;
    },

    getGearTiers(category) {
      return GEAR_TABLES[category];
    },

    getEquippedId(category) {
      return state.equipped[category];
    },

    getEquippedStats(category) {
      return findTier(category, state.equipped[category]);
    },

    isOwned(category, id) {
      return state.owned[category].includes(id);
    },

    canAfford(price) {
      return state.currency >= price;
    },

    // Buys and immediately equips the gear if affordable and not already owned.
    // Returns { ok: true } or { ok: false, reason: 'already_owned' | 'cannot_afford' }.
    buyGear(category, id) {
      const tier = findTier(category, id);
      if (state.owned[category].includes(id)) {
        state.equipped[category] = id;
        persist();
        return { ok: false, reason: 'already_owned' };
      }
      if (state.currency < tier.price) {
        return { ok: false, reason: 'cannot_afford' };
      }
      state.currency -= tier.price;
      state.owned[category].push(id);
      state.equipped[category] = id;
      persist();
      return { ok: true };
    },

    equipGear(category, id) {
      if (!state.owned[category].includes(id)) return false;
      state.equipped[category] = id;
      persist();
      return true;
    },

    // Adds the sale proceeds to currency and updates best-catch stats. Returns the amount earned.
    recordCatch(species, weight, sellPrice) {
      state.currency += sellPrice;
      state.stats.catchCount += 1;
      state.stats.totalEarnings += sellPrice;
      const isRecord = weight > state.stats.bestWeight;
      if (isRecord) {
        state.stats.bestWeight = weight;
        state.stats.bestSpecies = species.name;
      }
      persist();
      return { earned: sellPrice, isRecord };
    },
  };
}
