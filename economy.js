// economy.js
// Currency, gear tiers (rod/line/lure), and persistence for The Reel Deal's shop system.
// Every catch is auto-sold for cash (see getSellPrice in fish.js); cash buys better gear,
// which feeds real stat overrides into casting3d.js (rod), tension.js (line), and fish.js
// (lure) — this file only owns the data and the save-game state, not the physics/bite logic.

import { FISH_SPECIES } from './fish.js';
import { MAPS, STARTING_MAP_ID, getMap } from './maps.js';

const SAVE_KEY = 'reel-realism-save-v1';

// --- Gear tiers --------------------------------------------------------------
// id 'rod_starter' / 'line_starter' / 'lure_basic' are free and owned from the start.
// A lure's minFishLb is the smallest fish it draws, so bigger lures catch bigger fish.

export const ROD_TIERS = [
  { id: 'rod_starter', name: 'Starter Rod', price: 0, maxDistance: 55, powerExponent: 1.5,
    visual: { blankColor: 0x2b2015, gripColor: 0x1a1a1a, accentColor: 0x8a6a3a },
    description: 'The rod you showed up with. Gets the job done up close.' },
  { id: 'rod_graphite', name: 'Graphite Rod', price: 150, maxDistance: 75, powerExponent: 1.35,
    visual: { blankColor: 0x30343a, gripColor: 0xb08d57, accentColor: 0xc0c6cc },
    description: 'Lighter, stiffer blank. Casts farther with more consistent power.' },
  { id: 'rod_carbon', name: 'Pro Carbon Rod', price: 500, maxDistance: 100, powerExponent: 1.2,
    visual: { blankColor: 0x14171b, gripColor: 0xc29a62, accentColor: 0xd94f2a },
    description: 'Tournament-grade carbon fiber. Serious distance, serious control.' },
  { id: 'rod_tournament', name: 'Tournament Rod', price: 1500, maxDistance: 130, powerExponent: 1.05,
    visual: { blankColor: 0x10263f, gripColor: 0xd0ab72, accentColor: 0xe0b23c },
    description: "A pro's rod. Near-linear power control and a very long reach." },
  { id: 'rod_surf', name: 'Surf Caster', price: 3000, maxDistance: 145, powerExponent: 1.03,
    visual: { blankColor: 0x1f4a44, gripColor: 0x2a2a2a, accentColor: 0x7fd8c0 },
    description: 'A long two-handed blank that throws far past the drop-off.' },
  { id: 'rod_offshore', name: 'Offshore Rod', price: 7500, maxDistance: 155, powerExponent: 1.02,
    visual: { blankColor: 0xe8e4d8, gripColor: 0x1d3557, accentColor: 0x2a7fc4 },
    description: 'Heavy saltwater backbone built to work deep, open water.' },
  { id: 'rod_biggame', name: 'Big Game Rod', price: 15000, maxDistance: 170, powerExponent: 1.01,
    visual: { blankColor: 0x3a1218, gripColor: 0x161616, accentColor: 0xd9b24c },
    description: 'Roller guides and a fighting butt, made for the fish that win arguments.' },
  { id: 'rod_poseidon', name: 'Poseidon Rod', price: 30000, maxDistance: 180, powerExponent: 1,
    visual: { blankColor: 0x0d3b66, gripColor: 0xd4af37, accentColor: 0x6fe3ff },
    description: 'The longest cast in the game. Reaches the water where the monsters live.' },
];

export const LINE_TIERS = [
  { id: 'line_starter', name: '6lb Mono Line', price: 0, breakThreshold: 1.0,
    visual: { color: 0xdddddd },
    description: 'Basic monofilament. Snaps under real pressure.' },
  { id: 'line_braided', name: '12lb Braided Line', price: 100, breakThreshold: 1.4,
    visual: { color: 0x7fb069 },
    description: 'Braided for extra strength. Holds up to a harder fight.' },
  { id: 'line_fluoro', name: '20lb Fluorocarbon', price: 350, breakThreshold: 1.9,
    visual: { color: 0xbfe3ee },
    description: 'Low-stretch fluorocarbon. Lets you lean on big fish with confidence.' },
  { id: 'line_deepsea', name: '50lb Deep Sea Line', price: 1200, breakThreshold: 2.6,
    visual: { color: 0x4f8fc0 },
    description: 'Strong enough for the biggest freshwater trophies.' },
  { id: 'line_highvis', name: '80lb Hi-Vis Braid', price: 2500, breakThreshold: 3.4,
    visual: { color: 0xf2d14b },
    description: 'Bright, tough braid for heavy fish you want to watch run.' },
  { id: 'line_kevlar', name: '130lb Kevlar Braid', price: 6000, breakThreshold: 4.2,
    visual: { color: 0xe08a2c },
    description: 'The minimum for legendary fish. Mythic ones will still shred it.' },
  { id: 'line_titanium', name: '250lb Titanium Wire', price: 14000, breakThreshold: 5.2,
    visual: { color: 0xa8b2bc },
    description: 'Bite-proof wire. Gives you a fighting chance against a mythic fish.' },
  { id: 'line_leviathan', name: '500lb Leviathan Cable', price: 28000, breakThreshold: 6.5,
    visual: { color: 0xc84bd6 },
    description: 'The strongest line there is, for sharks, marlin and giant sturgeon.' },
];

export const LURE_TIERS = [
  { id: 'lure_basic', name: 'Basic Bait', price: 0, biteRateMultiplier: 1.0, maxRarityTier: 1, minFishLb: 0,
    visual: { kind: 'bobber', size: 1 },
    description: 'Plain bait. Only the common stuff will bother with it.' },
  { id: 'lure_spinner', name: 'Spinner Lure', price: 80, biteRateMultiplier: 1.3, maxRarityTier: 2, minFishLb: 2,
    visual: { kind: 'spinner', size: 1.15 },
    description: 'Flash and vibration draw in faster bites from tougher fish. Too big for the tiniest ones.' },
  { id: 'lure_jig', name: 'Premium Jig', price: 300, biteRateMultiplier: 1.6, maxRarityTier: 3, minFishLb: 5,
    visual: { kind: 'jig', size: 1.3 },
    description: 'Hand-tuned action. Gets noticed by serious, hard-fighting fish.' },
  { id: 'lure_legendary', name: 'Legendary Lure', price: 1000, biteRateMultiplier: 2.0, maxRarityTier: 4, minFishLb: 15,
    visual: { kind: 'spoon', size: 1.5 },
    description: 'A polished spoon that tempts trophy fish. The true giants still ignore it.' },
  { id: 'lure_crankbait', name: 'Deep Crankbait', price: 2500, biteRateMultiplier: 2.2, maxRarityTier: 4, minFishLb: 30,
    visual: { kind: 'crankbait', size: 1.7 },
    description: 'Dives fast and rattles hard, so trophy fish strike sooner.' },
  { id: 'lure_popper', name: 'Bluewater Popper', price: 6000, biteRateMultiplier: 2.4, maxRarityTier: 5, minFishLb: 60,
    visual: { kind: 'popper', size: 1.9 },
    description: 'Throws spray across the surface. First lure that draws legendary fish.' },
  { id: 'lure_squid', name: 'Giant Squid Rig', price: 15000, biteRateMultiplier: 2.6, maxRarityTier: 5, minFishLb: 100,
    visual: { kind: 'squid', size: 2.2 },
    description: 'A big, trailing squid skirt that only big fish will try to swallow.' },
  { id: 'lure_livebait', name: 'Monster Live Bait', price: 40000, biteRateMultiplier: 3.0, maxRarityTier: 6, minFishLb: 100,
    visual: { kind: 'livebait', size: 2.5 },
    description: 'The only lure a mythic fish will take, and even then they rarely bite.' },
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
    collection: {}, // speciesId -> { count, bestWeight }, shown in the Fish Book
    ownedMaps: [STARTING_MAP_ID],
    currentMap: STARTING_MAP_ID,
  };
}

// Saves from before the Fish Book only recorded the single best catch, so that's all it can show.
function seedCollection(stats) {
  const best = FISH_SPECIES.find((species) => species.name === stats.bestSpecies);
  return best ? { [best.id]: { count: 1, bestWeight: stats.bestWeight } } : {};
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
      collection: parsed.collection ?? seedCollection({ ...base.stats, ...parsed.stats }),
      ownedMaps: Array.isArray(parsed.ownedMaps) ? parsed.ownedMaps : base.ownedMaps,
      currentMap: getMap(parsed.currentMap) ? parsed.currentMap : base.currentMap,
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

    getCollectionEntry(speciesId) {
      return state.collection[speciesId] ?? null;
    },

    getMaps() {
      return MAPS;
    },

    getCurrentMap() {
      return getMap(state.currentMap);
    },

    isMapOwned(mapId) {
      return state.ownedMaps.includes(mapId);
    },

    // Buys the map and travels there. Returns { ok: true } or { ok: false, reason }.
    buyMap(mapId) {
      const map = getMap(mapId);
      if (!map) return { ok: false, reason: 'unknown_map' };
      if (state.ownedMaps.includes(mapId)) return { ok: false, reason: 'already_owned' };
      if (state.currency < map.price) return { ok: false, reason: 'cannot_afford' };
      state.currency -= map.price;
      state.ownedMaps.push(mapId);
      state.currentMap = mapId;
      persist();
      return { ok: true };
    },

    travelTo(mapId) {
      if (!state.ownedMaps.includes(mapId)) return false;
      state.currentMap = mapId;
      persist();
      return true;
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
      const entry = state.collection[species.id];
      const isNewSpecies = !entry;
      state.collection[species.id] = {
        count: (entry?.count ?? 0) + 1,
        bestWeight: Math.max(entry?.bestWeight ?? 0, weight),
      };
      persist();
      return { earned: sellPrice, isRecord, isNewSpecies };
    },
  };
}
