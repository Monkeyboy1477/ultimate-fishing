// ui.js — start screen, catch-result overlay, and shop for Ultimate Fishing.
// Owns #menu-overlay only. Does NOT touch #hud-overlay (render.js owns that).

import { FISH_SPECIES, RARITY_TIER_NAMES, canLureHook } from './fish.js';
import { fishThumbnail } from './scene3d.js';
import { isTouchDevice } from './touchControls.js';

let storedCallbacks = null;
let storedEconomy = null;
let startScreenEl = null;
let resultPanelEl = null;

function buildStartScreen(menuOverlayElement, callbacks) {
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

  const shopButton = document.createElement('button');
  shopButton.type = 'button';
  shopButton.className = 'menu-button menu-button-secondary';
  shopButton.textContent = 'Shop';
  shopButton.addEventListener('click', () => {
    showShop(menuOverlayElement, storedEconomy, () => {
      menuOverlayElement.innerHTML = '';
      menuOverlayElement.appendChild(startScreenEl);
      menuOverlayElement.classList.add('active');
    });
  });

  const bookButton = document.createElement('button');
  bookButton.type = 'button';
  bookButton.className = 'menu-button menu-button-secondary';
  bookButton.textContent = 'Fish Book';
  bookButton.addEventListener('click', () => {
    showBook(menuOverlayElement, storedEconomy, () => {
      menuOverlayElement.innerHTML = '';
      menuOverlayElement.appendChild(startScreenEl);
      menuOverlayElement.classList.add('active');
    });
  });

  buttonRow.appendChild(startButton);
  buttonRow.appendChild(shopButton);
  buttonRow.appendChild(bookButton);

  panel.appendChild(title);
  panel.appendChild(instructions);
  panel.appendChild(buttonRow);
  return panel;
}

function hideStartScreen(menuOverlayElement) {
  if (startScreenEl && startScreenEl.parentNode === menuOverlayElement) {
    menuOverlayElement.removeChild(startScreenEl);
  }
  menuOverlayElement.classList.remove('active');
}

export function initMenus(menuOverlayElement, callbacks, economy) {
  storedCallbacks = callbacks;
  storedEconomy = economy;

  startScreenEl = buildStartScreen(menuOverlayElement, callbacks);
  menuOverlayElement.innerHTML = '';
  menuOverlayElement.appendChild(startScreenEl);
  menuOverlayElement.classList.add('active');
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
    const section = document.createElement('section');
    section.className = 'gear-section';

    const heading = document.createElement('h3');
    heading.className = 'gear-section-title';
    heading.textContent = RARITY_TIER_NAMES[rarityTier];
    section.appendChild(heading);

    const row = document.createElement('div');
    row.className = 'gear-card-row';
    FISH_SPECIES
      .filter((species) => species.rarityTier === rarityTier)
      .sort((a, b) => a.maxWeight - b.maxWeight)
      .forEach((species) => row.appendChild(buildBookCard(species, economy, pendingPictures)));
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

// Shown while idle, since a free retrieve ends with no overlay to reach these from.
export function createIdleMenuButtons(stageElement, menuOverlayElement, economy) {
  const closeToGame = () => {
    menuOverlayElement.innerHTML = '';
    menuOverlayElement.classList.remove('active');
  };

  const group = document.createElement('div');
  group.className = 'idle-menu-buttons';
  group.hidden = true;

  [['Fish Book', showBook], ['Shop', showShop]].forEach(([label, open]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-button menu-button-secondary';
    button.textContent = label;
    button.addEventListener('click', () => {
      button.blur();
      open(menuOverlayElement, economy, closeToGame);
    });
    group.appendChild(button);
  });

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

  const lostDetail = result.species ? `It was a ${result.species.name}.` : '';
  if (result.reason === 'line_snapped') {
    const note = result.lineTooWeak ? 'This fish is too strong for your line. Buy a stronger one in the Shop.' : null;
    return { heading: 'The line snapped!', detail: lostDetail, note, variant: 'fail' };
  }
  if (result.reason === 'fish_escaped') {
    return { heading: 'It got away!', detail: lostDetail, note: null, variant: 'fail' };
  }
  return { heading: 'No catch.', detail: '', note: null, variant: 'fail' };
}

export function showCatchResult(menuOverlayElement, result) {
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
    resultPanelEl = null;
    if (storedCallbacks && storedCallbacks.onRestart) {
      storedCallbacks.onRestart();
    }
  });
  buttonRow.appendChild(restartButton);

  const shopButton = document.createElement('button');
  shopButton.type = 'button';
  shopButton.className = 'menu-button menu-button-secondary';
  shopButton.textContent = 'Shop';
  shopButton.addEventListener('click', () => {
    showShop(menuOverlayElement, storedEconomy, () => {
      menuOverlayElement.innerHTML = '';
      menuOverlayElement.appendChild(panel);
      menuOverlayElement.classList.add('active');
    });
  });
  buttonRow.appendChild(shopButton);

  const bookButton = document.createElement('button');
  bookButton.type = 'button';
  bookButton.className = 'menu-button menu-button-secondary';
  bookButton.textContent = 'Fish Book';
  bookButton.addEventListener('click', () => {
    showBook(menuOverlayElement, storedEconomy, () => {
      menuOverlayElement.innerHTML = '';
      menuOverlayElement.appendChild(panel);
      menuOverlayElement.classList.add('active');
    });
  });
  buttonRow.appendChild(bookButton);

  panel.appendChild(buttonRow);

  resultPanelEl = panel;
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
