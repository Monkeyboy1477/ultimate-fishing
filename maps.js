// maps.js
// The places you can fish, in the order you unlock them. Each map has its own fish, so a Great
// White only ever shows up in the ocean. maxCastM and maxLateralM keep a cast inside that map's
// water, however strong the rod is.

export const MAPS = [
  {
    id: 'pond',
    name: 'Mill Pond',
    price: 0,
    maxCastM: 55,
    maxLateralM: 30,
    description: 'A quiet little pond by the old mill. Everyone starts here.',
    speciesIds: [
      'pumpkinseed', 'bluegill', 'yellow_perch', 'black_crappie',
      'brown_bullhead', 'largemouth_bass', 'common_carp',
    ],
  },
  {
    id: 'river',
    name: 'Rocky River',
    price: 1500,
    maxCastM: 100,
    maxLateralM: 24,
    description: 'Fast, cold water running through the pines. Home to trout, salmon and big catfish.',
    speciesIds: [
      'rainbow_trout', 'smallmouth_bass', 'walleye', 'brown_trout',
      'northern_pike', 'channel_catfish', 'atlantic_salmon', 'flathead_catfish',
    ],
  },
  {
    id: 'lake',
    name: 'Big Lake',
    price: 10000,
    maxCastM: 150,
    maxLateralM: 45,
    description: 'Deep, misty mountain water where the freshwater giants live.',
    speciesIds: [
      'walleye', 'northern_pike', 'muskellunge', 'lake_trout', 'blue_catfish',
      'paddlefish', 'lake_sturgeon', 'alligator_gar', 'beluga_sturgeon',
    ],
  },
  {
    id: 'ocean',
    name: 'Open Ocean',
    price: 60000,
    maxCastM: 180,
    maxLateralM: 45,
    description: 'Nothing but blue water. Sharks, tuna and marlin, and the biggest fish in the game.',
    speciesIds: [
      'atlantic_mackerel', 'barracuda', 'red_snapper', 'striped_bass', 'mahi_mahi', 'yellowfin_tuna',
      'sailfish', 'bull_shark', 'bluefin_tuna', 'swordfish', 'tiger_shark',
      'blue_marlin', 'great_white_shark',
    ],
  },
];

export const STARTING_MAP_ID = 'pond';

export function getMap(mapId) {
  return MAPS.find((map) => map.id === mapId) ?? null;
}

export function mapsForSpecies(speciesId) {
  return MAPS.filter((map) => map.speciesIds.includes(speciesId));
}
