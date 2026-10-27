// ui.js — start screen, catch-result overlay, and shop for Umtimatefishing.
// Owns #menu-overlay only. Does NOT touch #hud-overlay (render.js owns that).

let storedCallbacks = null;
let storedEconomy = null;
let startScreenEl = null;
let resultPanelEl = null;

function buildStartScreen(menuOverlayElement, callbacks) {
  const panel = document.createElement('div');
  panel.className = 'menu-panel';

  const title = document.createElement('h2');
  title.className = 'menu-panel-title';
  title.textContent = 'Umtimatefishing';

  const instructions = document.createElement('p');
  instructions.className = 'menu-panel-text';
  instructions.textContent =
    'Hold the mouse button to cast, move left/right to aim, release to let it fly. Hold Space to reel — but ease off when the fish fights back or the line will snap.';

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

  buttonRow.appendChild(startButton);
  buttonRow.appendChild(shopButton);

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

const CATEGORY_LABELS = { rod: 'Rod', line: 'Line', lure: 'Lure' };

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

  const price = document.createElement('div');
  price.className = 'gear-card-price';
  price.textContent = tier.price > 0 ? `$${tier.price}` : 'Free';
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
  currency.textContent = `You have $${economy.getCurrency().toFixed(0)}`;
  panel.appendChild(currency);

  const rerender = () => {
    const fresh = buildShopPanel(economy, onClose);
    panel.replaceWith(fresh);
  };

  ['rod', 'line', 'lure'].forEach((category) => {
    const section = document.createElement('div');
    section.className = 'gear-section';

    const heading = document.createElement('h3');
    heading.className = 'gear-section-title';
    heading.textContent = CATEGORY_LABELS[category];
    section.appendChild(heading);

    const row = document.createElement('div');
    row.className = 'gear-card-row';
    economy.getGearTiers(category).forEach((tier) => {
      row.appendChild(buildGearCard(category, tier, economy, rerender));
    });
    section.appendChild(row);
    panel.appendChild(section);
  });

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

function describeResult(result) {
  if (result.caught) {
    const weightText = `${result.weight.toFixed(1)} lb`;
    const speciesName = result.species && result.species.name ? result.species.name : 'fish';
    const notes = [];
    if (result.isRecord) notes.push('New personal best!');
    if (typeof result.soldFor === 'number') notes.push(`Sold for $${result.soldFor.toFixed(0)}`);
    return {
      heading: 'Caught!',
      detail: `${weightText} ${speciesName}`,
      note: notes.length ? notes.join(' ') : null,
      variant: 'success',
    };
  }

  if (result.reason === 'line_snapped') {
    return { heading: 'The line snapped!', detail: '', note: null, variant: 'fail' };
  }
  if (result.reason === 'fish_escaped') {
    return { heading: 'It got away!', detail: '', note: null, variant: 'fail' };
  }
  return { heading: 'No catch.', detail: '', note: null, variant: 'fail' };
}

export function showCatchResult(menuOverlayElement, result) {
  const info = describeResult(result);

  const panel = document.createElement('div');
  panel.className = `menu-panel menu-panel-result menu-panel-${info.variant}`;

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
