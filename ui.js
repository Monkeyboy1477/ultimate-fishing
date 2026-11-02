// ui.js — start screen, catch-result overlay, and shop for Ultimate Fishing.
// Owns #menu-overlay only. Does NOT touch #hud-overlay (render.js owns that).

import { FISH_SPECIES, RARITY_TIER_NAMES, canLureHook } from './fish.js';
import { mapsForSpecies } from './maps.js';
import { fishThumbnail } from './scene3d.js';
import { isTouchDevice } from './touchControls.js';

// Per-overlay state (callbacks/economy/current panel), keyed by menuOverlayElement so a 2P
// session can call initMenus/showCatchResult twice (once per player's own overlay) without
// one player's callbacks/economy clobbering the other's -- mirrors render.js's hudRegistry.
const menuState = new WeakMap();
function getMenuState(menuOverlayElement) {
  let state = menuState.get(menuOverlayElement);
  if (!state) {
    state = { callbacks: null, economy: null, startScreenEl: null, resultPanelEl: null };
    menuState.set(menuOverlayElement, state);
  }
  return state;
}

const MENU_SCREENS = [['Shop', showShop], ['Fish Book', showBook], ['Maps', showMaps]];

// Adds Shop / Fish Book / Maps buttons. onClose runs when any of those screens closes.
function appendMenuButtons(container, menuOverlayElement, getEconomy, onClose, beforeOpen) {
  MENU_SCREENS.forEach(([label, open]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-button menu-button-secondary';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (beforeOpen) beforeOpen(button);
      open(menuOverlayElement, getEconomy(), onClose);
    });
    container.appendChild(button);
  });
}

function buildStartScreen(menuOverlayElement, callbacks, options = {}) {
  const { showShopLinks = true } = options;
  const panel = document.createElement('div');
  panel.className = 'menu-panel';

  const title = document.createElement('h2');
  title.className = 'menu-panel-title';
  title.textContent = 'Ultimate Fishing';

  const instructions = document.createElement('p');
  instructions.className = 'menu-panel-text';
  instructions.textContent = isTouchDevice()
    ? 'Hold CAST, use the arrows to aim, and let go to let it fly. Hold REEL to reel in anytime — but ease off when a fish fights back or the line will snap.'
    : 'Hold the mouse button to cast, move left/right to aim, release to let it fly. Hold Space to reel in anytime — but ease off when a fish fights back or the line will snap.';

  const earn = document.createElement('p');
  earn.className = 'menu-panel-text';
  earn.textContent = 'Earn money from your catches to unlock new maps.';

  const buttonRow = document.createElement('div');
  buttonRow.className = 'menu-button-row';

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'menu-button';
  startButton.textContent = 'Start Fishing';
  startButton.addEventListener('click', () => {
    hideStartScreen(menuOverlayElement);
    callbacks.onStartCast();
  });

  const location = document.createElement('p');
  location.className = 'menu-panel-location';
  const refreshLocation = () => {
    const current = getMenuState(menuOverlayElement).economy?.getCurrentMap();
    location.textContent = current ? `Fishing at: ${current.name}` : '';
  };
  refreshLocation();

  buttonRow.appendChild(startButton);
  if (showShopLinks) {
    appendMenuButtons(buttonRow, menuOverlayElement, () => getMenuState(menuOverlayElement).economy, () => {
      menuOverlayElement.innerHTML = '';
      menuOverlayElement.appendChild(getMenuState(menuOverlayElement).startScreenEl);
      menuOverlayElement.classList.add('active');
      refreshLocation();
    });
  }

  panel.appendChild(title);
  panel.appendChild(location);
  panel.appendChild(instructions);
  panel.appendChild(earn);
  panel.appendChild(buttonRow);
  return panel;
}

function hideStartScreen(menuOverlayElement) {
  const startScreenEl = getMenuState(menuOverlayElement).startScreenEl;
  if (startScreenEl && startScreenEl.parentNode === menuOverlayElement) {
    menuOverlayElement.removeChild(startScreenEl);
  }
  menuOverlayElement.classList.remove('active');
}

export function initMenus(menuOverlayElement, callbacks, economy, options = {}) {
  const state = getMenuState(menuOverlayElement);
  state.callbacks = callbacks;
  state.economy = economy;

  state.startScreenEl = buildStartScreen(menuOverlayElement, callbacks, options);
  menuOverlayElement.innerHTML = '';
  menuOverlayElement.appendChild(state.startScreenEl);
  menuOverlayElement.classList.add('active');
}

// ---------------------------------------------------------------------------
// Mode select
// ---------------------------------------------------------------------------

export function showModeSelect(menuOverlayElement, onChoose) {
  function renderModeChoice() {
    menuOverlayElement.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';

    const title = document.createElement('h2');
    title.className = 'menu-panel-title';
    title.textContent = 'Ultimate Fishing';
    panel.appendChild(title);

    const instructions = document.createElement('p');
    instructions.className = 'menu-panel-text';
    instructions.textContent = 'Choose how you want to play.';
    panel.appendChild(instructions);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'menu-button-row';

    const onePlayerButton = document.createElement('button');
    onePlayerButton.type = 'button';
    onePlayerButton.className = 'menu-button';
    onePlayerButton.textContent = '1 Player';
    onePlayerButton.addEventListener('click', () => onChoose({ mode: '1p' }));
    buttonRow.appendChild(onePlayerButton);

    const twoPlayerButton = document.createElement('button');
    twoPlayerButton.type = 'button';
    twoPlayerButton.className = 'menu-button';
    twoPlayerButton.textContent = '2 Player';
    twoPlayerButton.addEventListener('click', renderEconomyModeChoice);
    buttonRow.appendChild(twoPlayerButton);

    panel.appendChild(buttonRow);
    menuOverlayElement.appendChild(panel);
    menuOverlayElement.classList.add('active');
  }

  function renderEconomyModeChoice() {
    menuOverlayElement.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';

    const title = document.createElement('h2');
    title.className = 'menu-panel-title';
    title.textContent = '2 Player';
    panel.appendChild(title);

    const instructions = document.createElement('p');
    instructions.className = 'menu-panel-text';
    instructions.textContent = 'Share a wallet as a team, or compete for the biggest catch.';
    panel.appendChild(instructions);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'menu-button-row';

    const teamButton = document.createElement('button');
    teamButton.type = 'button';
    teamButton.className = 'menu-button';
    teamButton.textContent = 'Team';
    teamButton.addEventListener('click', () => onChoose({ mode: '2p', economyMode: 'team' }));
    buttonRow.appendChild(teamButton);

    const competitiveButton = document.createElement('button');
    competitiveButton.type = 'button';
    competitiveButton.className = 'menu-button';
    competitiveButton.textContent = 'Competitive';
    competitiveButton.addEventListener('click', () => onChoose({ mode: '2p', economyMode: 'competitive' }));
    buttonRow.appendChild(competitiveButton);

    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.className = 'menu-button menu-button-secondary';
    backButton.textContent = 'Back';
    backButton.addEventListener('click', renderModeChoice);
    buttonRow.appendChild(backButton);

    panel.appendChild(buttonRow);
    menuOverlayElement.appendChild(panel);
    menuOverlayElement.classList.add('active');
  }

  renderModeChoice();
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

const CATEGORY_LABELS = { rod: 'Rods', line: 'Lines', lure: 'Lures' };
let activeShopCategory = 'rod';

function gearStatText(category, tier) {
  if (category === 'rod') return `Cast reach: ${tier.maxDistance} m`;
  if (category === 'line') return `Line strength: ${tier.breakThreshold.toFixed(1)}`;
  const size = tier.minFishLb > 0 ? `Fish over ${tier.minFishLb} lb` : 'Any size of fish';
  return `${size}, up to ${RARITY_TIER_NAMES[tier.maxRarityTier]} · Bite speed ×${tier.biteRateMultiplier.toFixed(1)}`;
}

function buildGearCard(category, tier, economy, onChange) {
  const card = document.createElement('div');
  card.className = 'gear-card';

  const name = document.createElement('div');
  name.className = 'gear-card-name';
  name.textContent = tier.name;
  card.appendChild(name);

  const desc = document.createElement('div');
  desc.className = 'gear-card-desc';
  desc.textContent = tier.description;
  card.appendChild(desc);

  const stat = document.createElement('div');
  stat.className = 'gear-card-stat';
  stat.textContent = gearStatText(category, tier);
  card.appendChild(stat);

  const price = document.createElement('div');
  price.className = 'gear-card-price';
  price.textContent = tier.price > 0 ? `$${tier.price.toLocaleString('en-US')}` : 'Free';
  card.appendChild(price);

  const owned = economy.isOwned(category, tier.id);
  const equipped = economy.getEquippedId(category) === tier.id;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-button gear-card-button';

  if (equipped) {
    button.textContent = 'Equipped';
    button.disabled = true;
    card.classList.add('gear-card-equipped');
  } else if (owned) {
    button.textContent = 'Equip';
    button.addEventListener('click', () => {
      economy.equipGear(category, tier.id);
      onChange();
    });
  } else {
    const affordable = economy.canAfford(tier.price);
    button.textContent = affordable ? 'Buy' : 'Need more $';
    button.disabled = !affordable;
    button.addEventListener('click', () => {
      economy.buyGear(category, tier.id);
      onChange();
    });
  }

  card.appendChild(button);
  return card;
}

function buildShopPanel(economy, onClose) {
  const panel = document.createElement('div');
  panel.className = 'menu-panel menu-panel-shop';

  const title = document.createElement('h2');
  title.className = 'menu-panel-title';
  title.textContent = 'Tackle Shop';
  panel.appendChild(title);

  const currency = document.createElement('p');
  currency.className = 'menu-panel-note';
  currency.textContent = `You have $${Math.floor(economy.getCurrency()).toLocaleString('en-US')}`;
  panel.appendChild(currency);

  const rerender = () => {
    const fresh = buildShopPanel(economy, onClose);
    panel.replaceWith(fresh);
  };

  const tabs = document.createElement('div');
  tabs.className = 'gear-tabs';
  tabs.setAttribute('role', 'tablist');
  ['rod', 'line', 'lure'].forEach((category) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(category === activeShopCategory));
    tab.className = 'gear-tab';
    tab.textContent = CATEGORY_LABELS[category];
    tab.addEventListener('click', () => {
      activeShopCategory = category;
      rerender();
    });
    tabs.appendChild(tab);
  });
  panel.appendChild(tabs);

  const row = document.createElement('div');
  row.className = 'gear-card-row';
  economy.getGearTiers(activeShopCategory).forEach((tier) => {
    row.appendChild(buildGearCard(activeShopCategory, tier, economy, rerender));
  });
  panel.appendChild(row);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'menu-button';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', onClose);
  panel.appendChild(closeButton);

  return panel;
}

export function showShop(menuOverlayElement, economy, onClose) {
  const panel = buildShopPanel(economy, onClose);
  menuOverlayElement.innerHTML = '';
  menuOverlayElement.appendChild(panel);
  menuOverlayElement.classList.add('active');
}

// ---------------------------------------------------------------------------
// Fish Book
// ---------------------------------------------------------------------------

function lureHintText(species, economy) {
  const lures = economy.getGearTiers('lure').filter((lure) => canLureHook(lure, species));
  if (!lures.length) return 'Bites on: no lure yet';
  const first = lures[0].name;
  const last = lures[lures.length - 1].name;
  return first === last ? `Bites on: ${first}` : `Bites on: ${first} to ${last}`;
}

function buildBookCard(species, economy, pendingPictures) {
  const entry = economy.getCollectionEntry(species.id);

  const card = document.createElement('div');
  card.className = `book-card${entry ? '' : ' book-card-unknown'}`;

  const picture = document.createElement('img');
  picture.className = 'book-picture';
  picture.alt = entry ? species.name : 'Fish not caught yet';
  card.appendChild(picture);
  pendingPictures.push({ picture, species });

  const name = document.createElement('div');
  name.className = 'gear-card-name';
  name.textContent = entry ? species.name : '???';
  card.appendChild(name);

  const record = document.createElement('div');
  record.className = 'gear-card-stat';
  record.textContent = entry
    ? `Caught ${entry.count} · Best ${entry.bestWeight.toFixed(1)} lb`
    : 'Not caught yet';
  card.appendChild(record);

  const hint = document.createElement('div');
  hint.className = 'gear-card-desc';
  hint.textContent = lureHintText(species, economy);
  card.appendChild(hint);

  const where = document.createElement('div');
  where.className = 'gear-card-desc';
  where.textContent = `Found in: ${mapsForSpecies(species.id).map((map) => map.name).join(', ') || 'unknown'}`;
  card.appendChild(where);

  return card;
}

// One picture per frame, so opening the book never freezes the game.
function drawPicturesInTurn(pendingPictures) {
  const next = pendingPictures.shift();
  if (!next) return;
  next.picture.src = fishThumbnail(next.species);
  requestAnimationFrame(() => drawPicturesInTurn(pendingPictures));
}

function buildBookPanel(economy, onClose) {
  const panel = document.createElement('div');
  panel.className = 'menu-panel menu-panel-shop';

  const title = document.createElement('h2');
  title.className = 'menu-panel-title';
  title.textContent = 'Fish Book';
  panel.appendChild(title);

  const caughtCount = FISH_SPECIES.filter((species) => economy.getCollectionEntry(species.id)).length;
  const progress = document.createElement('p');
  progress.className = 'menu-panel-note';
  progress.textContent = `${caughtCount} of ${FISH_SPECIES.length} species caught`;
  panel.appendChild(progress);

  const pendingPictures = [];
  Object.keys(RARITY_TIER_NAMES).map(Number).forEach((rarityTier) => {
    const speciesInTier = FISH_SPECIES
      .filter((species) => species.rarityTier === rarityTier)
      .sort((a, b) => a.maxWeight - b.maxWeight);
    if (!speciesInTier.length) return;

    const section = document.createElement('section');
    section.className = 'gear-section';

    const heading = document.createElement('h3');
    heading.className = 'gear-section-title';
    heading.textContent = RARITY_TIER_NAMES[rarityTier];
    section.appendChild(heading);

    const row = document.createElement('div');
    row.className = 'gear-card-row';
    speciesInTier.forEach((species) => row.appendChild(buildBookCard(species, economy, pendingPictures)));
    section.appendChild(row);
    panel.appendChild(section);
  });

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'menu-button';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', onClose);
  panel.appendChild(closeButton);

  requestAnimationFrame(() => drawPicturesInTurn(pendingPictures));
  return panel;
}

export function showBook(menuOverlayElement, economy, onClose) {
  menuOverlayElement.innerHTML = '';
  menuOverlayElement.appendChild(buildBookPanel(economy, onClose));
  menuOverlayElement.classList.add('active');
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

function buildMapCard(map, economy, onChange) {
  const card = document.createElement('div');
  card.className = 'gear-card';

  const name = document.createElement('div');
  name.className = 'gear-card-name';
  name.textContent = map.name;
  card.appendChild(name);

  const desc = document.createElement('div');
  desc.className = 'gear-card-desc';
  desc.textContent = map.description;
  card.appendChild(desc);

  const caught = map.speciesIds.filter((id) => economy.getCollectionEntry(id)).length;
  const stat = document.createElement('div');
  stat.className = 'gear-card-stat';
  stat.textContent = `${caught} of ${map.speciesIds.length} fish caught`;
  card.appendChild(stat);

  const price = document.createElement('div');
  price.className = 'gear-card-price';
  price.textContent = map.price > 0 ? `$${map.price.toLocaleString('en-US')}` : 'Free';
  card.appendChild(price);

  const current = economy.getCurrentMap();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-button gear-card-button';

  if (current && current.id === map.id) {
    button.textContent = 'Here now';
    button.disabled = true;
    card.classList.add('gear-card-equipped');
  } else if (economy.isMapOwned(map.id)) {
    button.textContent = 'Travel';
    button.addEventListener('click', () => {
      economy.travelTo(map.id);
      onChange();
    });
  } else {
    const affordable = economy.canAfford(map.price);
    button.textContent = affordable ? 'Buy' : 'Need more $';
    button.disabled = !affordable;
    button.addEventListener('click', () => {
      economy.buyMap(map.id);
      onChange();
    });
  }

  card.appendChild(button);
  return card;
}

function buildMapsPanel(economy, onClose) {
  const panel = document.createElement('div');
  panel.className = 'menu-panel menu-panel-shop';

  const title = document.createElement('h2');
  title.className = 'menu-panel-title';
  title.textContent = 'Maps';
  panel.appendChild(title);

  const currency = document.createElement('p');
  currency.className = 'menu-panel-note';
  currency.textContent = `You have $${Math.floor(economy.getCurrency()).toLocaleString('en-US')}`;
  panel.appendChild(currency);

  const rerender = () => {
    panel.replaceWith(buildMapsPanel(economy, onClose));
  };

  const row = document.createElement('div');
  row.className = 'gear-card-row';
  economy.getMaps().forEach((map) => row.appendChild(buildMapCard(map, economy, rerender)));
  panel.appendChild(row);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'menu-button';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', onClose);
  panel.appendChild(closeButton);

  return panel;
}

export function showMaps(menuOverlayElement, economy, onClose) {
  menuOverlayElement.innerHTML = '';
  menuOverlayElement.appendChild(buildMapsPanel(economy, onClose));
  menuOverlayElement.classList.add('active');
}

// ---------------------------------------------------------------------------
// Shared 2P menu (Player tabs + Shop/Fish Book/Maps for the selected player)
// ---------------------------------------------------------------------------

const SHARED_MENU_SCREENS = [['shop', 'Shop', buildShopPanel], ['book', 'Fish Book', buildBookPanel], ['maps', 'Maps', buildMapsPanel]];

export function showSharedMenu(menuOverlayElement, players, onClose) {
  let activeIndex = 0;
  let activeScreen = 'shop';

  function render() {
    menuOverlayElement.innerHTML = '';
    const wrapper = document.createElement('div');

    if (players.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'menu-player-tabs';
      players.forEach((player, i) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `menu-button menu-button-secondary${i === activeIndex ? ' active' : ''}`;
        tab.textContent = player.label;
        tab.addEventListener('click', () => { activeIndex = i; render(); });
        tabs.appendChild(tab);
      });
      wrapper.appendChild(tabs);
    }

    const screenTabs = document.createElement('div');
    screenTabs.className = 'menu-button-row';
    SHARED_MENU_SCREENS.forEach(([key, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `menu-button menu-button-secondary${key === activeScreen ? ' active' : ''}`;
      button.textContent = label;
      button.addEventListener('click', () => { activeScreen = key; render(); });
      screenTabs.appendChild(button);
    });
    wrapper.appendChild(screenTabs);

    const [, , buildPanel] = SHARED_MENU_SCREENS.find(([key]) => key === activeScreen);
    wrapper.appendChild(buildPanel(players[activeIndex].economy, onClose));

    menuOverlayElement.appendChild(wrapper);
    menuOverlayElement.classList.add('active');
  }

  render();
}

// Shown while idle, since a free retrieve ends with no overlay to reach these from.
export function createIdleMenuButtons(stageElement, menuOverlayElement, economy) {
  const closeToGame = () => {
    menuOverlayElement.innerHTML = '';
    menuOverlayElement.classList.remove('active');
  };

  const group = document.createElement('div');
  group.className = 'idle-menu-buttons';
  group.hidden = true;

  appendMenuButtons(group, menuOverlayElement, () => economy, closeToGame, (button) => button.blur());

  stageElement.appendChild(group);
  return group;
}

function describeResult(result) {
  if (result.caught) {
    const weightText = `${result.weight.toFixed(1)} lb`;
    const speciesName = result.species && result.species.name ? result.species.name : 'fish';
    const notes = [];
    if (result.isNewSpecies) notes.push('New in your Fish Book!');
    if (result.isRecord) notes.push('New personal best!');
    if (typeof result.soldFor === 'number') notes.push(`Sold for $${Math.round(result.soldFor).toLocaleString('en-US')}`);
    return {
      heading: 'Caught!',
      detail: `${weightText} ${speciesName}`,
      note: notes.length ? notes.join(' ') : null,
      variant: 'success',
    };
  }

  const lostDetail = result.species ? `It was ${/^[AEIOU]/i.test(result.species.name) ? 'an' : 'a'} ${result.species.name}.` : '';
  if (result.reason === 'line_snapped') {
    const note = result.lineTooWeak ? 'This fish is too strong for your line. Buy a stronger one in the Shop.' : null;
    return { heading: 'The line snapped!', detail: lostDetail, note, variant: 'fail' };
  }
  if (result.reason === 'fish_escaped') {
    return { heading: 'It got away!', detail: lostDetail, note: null, variant: 'fail' };
  }
  return { heading: 'No catch.', detail: '', note: null, variant: 'fail' };
}

export function showCatchResult(menuOverlayElement, result, options = {}) {
  const { showShopLinks = true } = options;
  const info = describeResult(result);

  const panel = document.createElement('div');
  panel.className = `menu-panel menu-panel-result menu-panel-${info.variant}`;

  const rarityTier = result.species?.rarityTier;
  if (rarityTier) {
    if (rarityTier >= 5) panel.classList.add(`menu-panel-tier-${rarityTier}`);
    const badge = document.createElement('div');
    badge.className = `rarity-badge rarity-badge-${rarityTier}`;
    badge.textContent = RARITY_TIER_NAMES[rarityTier];
    panel.appendChild(badge);
  }

  const heading = document.createElement('h2');
  heading.className = 'menu-panel-title';
  heading.textContent = info.heading;
  panel.appendChild(heading);

  if (info.detail) {
    const detail = document.createElement('p');
    detail.className = 'menu-panel-text';
    detail.textContent = info.detail;
    panel.appendChild(detail);
  }

  if (info.note) {
    const note = document.createElement('p');
    note.className = 'menu-panel-note';
    note.textContent = info.note;
    panel.appendChild(note);
  }

  const buttonRow = document.createElement('div');
  buttonRow.className = 'menu-button-row';

  const restartButton = document.createElement('button');
  restartButton.type = 'button';
  restartButton.className = 'menu-button';
  restartButton.textContent = 'Cast Again';
  restartButton.addEventListener('click', () => {
    menuOverlayElement.classList.remove('active');
    menuOverlayElement.innerHTML = '';
    const state = getMenuState(menuOverlayElement);
    state.resultPanelEl = null;
    if (state.callbacks && state.callbacks.onRestart) {
      state.callbacks.onRestart();
    }
  });
  buttonRow.appendChild(restartButton);

  if (showShopLinks) {
    appendMenuButtons(buttonRow, menuOverlayElement, () => getMenuState(menuOverlayElement).economy, () => {
      menuOverlayElement.innerHTML = '';
      menuOverlayElement.appendChild(panel);
      menuOverlayElement.classList.add('active');
    });
  }

  panel.appendChild(buttonRow);

  getMenuState(menuOverlayElement).resultPanelEl = panel;
  menuOverlayElement.innerHTML = '';
  menuOverlayElement.appendChild(panel);
  menuOverlayElement.classList.add('active');
}

let lastCatchCountText = null;
let lastBestCatchText = null;

export function updateHUDSummary(topBarElements, stats) {
  const catchText = `Catches: ${stats.catchCount}`;
  const bestText = stats.bestSpecies
    ? `Best: ${stats.bestWeight.toFixed(1)} lb ${stats.bestSpecies}`
    : 'Best: —';

  if (catchText !== lastCatchCountText) {
    topBarElements.catchCount.textContent = catchText;
    lastCatchCountText = catchText;
  }

  if (bestText !== lastBestCatchText) {
    topBarElements.bestCatch.textContent = bestText;
    lastBestCatchText = bestText;
  }
}

let lastCurrencyText = null;

export function updateCurrencyDisplay(currencyElement, currency) {
  const text = `$${currency.toFixed(0)}`;
  if (text !== lastCurrencyText) {
    currencyElement.textContent = text;
    lastCurrencyText = text;
  }
}
