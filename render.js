// Umtimatefishing — render.js
// Canvas rendering (renderScene, spawnSplash) + DOM HUD overlay (renderHUD).
// Pure presentation: reads game state handed in by main.js, draws it.
// Visual priority: legible mechanics (cast arc, line tension, fish fight)
// over decoration. Everything is drawn with Canvas 2D primitives — no
// external art assets.

// ---------------------------------------------------------------------------
// Palette (mirrors the CSS custom properties in style.css so the canvas and
// the DOM overlay read as one consistent scene).
// ---------------------------------------------------------------------------
const COLOR = {
  skyTop: '#9fd3e8',
  skyBottom: '#cfe9ef',
  waterSurface: '#1e6e8c',
  waterDeep: '#0b3d59',
  sand: '#d8c58f',
  sandShadow: '#c2ad73',
  rod: '#3a2a1a',
  line: '#eef4f7',
  accent: '#ffb703',
  danger: '#e63946',
  calm: '#7fd8a8',
  text: '#eef4f7',
};

const SHORE_Y = 200; // horizon between shore/sky and water, per spec.

// ---------------------------------------------------------------------------
// Splash effects (spawned by main.js on lure landing, drawn + aged here).
// ---------------------------------------------------------------------------
let splashes = [];

export function spawnSplash(x, y) {
  splashes.push({ x, y, start: performance.now() });
}

function drawSplashes(ctx, now) {
  const DURATION = 900; // ms
  splashes = splashes.filter((s) => now - s.start < DURATION);
  for (const s of splashes) {
    const age = (now - s.start) / DURATION; // 0..1
    const alpha = 1 - age;
    // A couple of expanding rings plus a few radiating droplet flecks.
    for (let ring = 0; ring < 2; ring++) {
      const ringAge = Math.min(1, age + ring * 0.18);
      const radius = 4 + ringAge * 26;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, radius, radius * 0.4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, alpha - ring * 0.25) * 0.8})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (age < 0.5) {
      const flecks = 6;
      for (let i = 0; i < flecks; i++) {
        const ang = (i / flecks) * Math.PI * 2;
        const dist = age * 22;
        const fx = s.x + Math.cos(ang) * dist;
        const fy = s.y - Math.abs(Math.sin(ang)) * dist * 0.9 - age * 10;
        ctx.beginPath();
        ctx.arc(fx, fy, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.9})`;
        ctx.fill();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Background: water gradient, shoreline, gentle ambient wave lines.
// ---------------------------------------------------------------------------
function drawBackground(ctx, width, height, timeSec) {
  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, SHORE_Y);
  sky.addColorStop(0, COLOR.skyTop);
  sky.addColorStop(1, COLOR.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, SHORE_Y);

  // Water: a vertical gradient from surface (near shore) to deep (far edge
  // is "further out" per spec, but we render depth primarily top-to-bottom
  // since the lure travels away from the rod toward the lower-right water).
  const water = ctx.createLinearGradient(0, SHORE_Y, 0, height);
  water.addColorStop(0, COLOR.waterSurface);
  water.addColorStop(1, COLOR.waterDeep);
  ctx.fillStyle = water;
  ctx.fillRect(0, SHORE_Y, width, height - SHORE_Y);

  // Ambient wave lines — thin, slow-moving horizontal ripples.
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  for (let row = 0; row < 6; row++) {
    const y = SHORE_Y + 30 + row * 55;
    const phase = timeSec * 0.6 + row * 0.8;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 20) {
      const wobble = Math.sin(x * 0.03 + phase) * 3;
      if (x === 0) ctx.moveTo(x, y + wobble);
      else ctx.lineTo(x, y + wobble);
    }
    ctx.stroke();
  }
  ctx.restore();

  // Shoreline: a sandy wedge in the upper-left where the angler stands.
  ctx.save();
  ctx.fillStyle = COLOR.sand;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(220, 0);
  ctx.quadraticCurveTo(140, SHORE_Y - 20, 0, SHORE_Y + 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COLOR.sandShadow;
  ctx.beginPath();
  ctx.moveTo(0, SHORE_Y - 25);
  ctx.quadraticCurveTo(110, SHORE_Y - 5, 0, SHORE_Y + 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Angler + rod. The rod's physical pose stays put; a separate aim indicator
// (drawn by the caller for CHARGING) shows where the next cast will go.
// ---------------------------------------------------------------------------
function drawAngler(ctx, rodOrigin) {
  const baseX = rodOrigin.x - 18;
  const baseY = rodOrigin.y + 70;

  // Simple standing silhouette.
  ctx.save();
  ctx.fillStyle = '#1f2d35';
  ctx.beginPath();
  ctx.ellipse(baseX, baseY - 18, 9, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(baseX, baseY - 44, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Rod pole, resting at a fixed natural angle, tip at rodOrigin.
  const handX = baseX + 8;
  const handY = baseY - 30;
  ctx.save();
  ctx.strokeStyle = COLOR.rod;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(rodOrigin.x, rodOrigin.y);
  ctx.stroke();
  ctx.restore();
}

function drawAimIndicator(ctx, rodOrigin, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const len = 55;
  const tipX = rodOrigin.x + Math.cos(rad) * len;
  const tipY = rodOrigin.y + Math.sin(rad) * len;

  ctx.save();
  ctx.strokeStyle = COLOR.accent;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(rodOrigin.x, rodOrigin.y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead.
  const headLen = 8;
  const leftAng = rad + Math.PI * 0.8;
  const rightAng = rad - Math.PI * 0.8;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX + Math.cos(leftAng) * headLen, tipY + Math.sin(leftAng) * headLen);
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX + Math.cos(rightAng) * headLen, tipY + Math.sin(rightAng) * headLen);
  ctx.strokeStyle = COLOR.accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Fishing line — straight when taut, bowed/wavy when slack, tinted toward
// red as tension approaches the breaking point.
// ---------------------------------------------------------------------------
function lerpColor(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

function drawFishingLine(ctx, fromX, fromY, toX, toY, { slack = 0, tension = null, timeSec = 0 } = {}) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / dist;
  const ny = dx / dist;
  const bow = slack * 18 + Math.sin(timeSec * 2) * slack * 4;
  const midX = (fromX + toX) / 2 + nx * bow;
  const midY = (fromY + toY) / 2 + ny * bow;

  let color = COLOR.line;
  let width = 1.6;
  if (tension !== null) {
    if (tension < 0.5) {
      color = lerpColor(COLOR.calm, COLOR.accent, tension / 0.5);
    } else {
      color = lerpColor(COLOR.accent, COLOR.danger, (tension - 0.5) / 0.5);
    }
    width = 1.4 + tension * 2.2;
  }

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.quadraticCurveTo(midX, midY, toX, toY);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Lure + idle bob/ripple while waiting for a bite.
// ---------------------------------------------------------------------------
function drawLure(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = COLOR.accent;
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7a4e00';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawRestingBob(ctx, x, y, timeSec) {
  const bobY = y + Math.sin(timeSec * 2.2) * 2.5;
  drawLure(ctx, x, bobY);

  // Soft repeating ripple rings around the resting lure.
  ctx.save();
  for (let i = 0; i < 2; i++) {
    const phase = ((timeSec * 0.6 + i * 0.5) % 1);
    const radius = 4 + phase * 20;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * 0.35, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - phase)})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Fish — simple procedural shape, tinted/sized by species, with a thrashing
// wobble whose amplitude/speed is driven by remaining stamina.
// ---------------------------------------------------------------------------
function speciesColor(species) {
  if (species && species.color) return species.color;
  const name = (species && species.name) || 'fish';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff;
  const hue = hash % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function drawFish(ctx, x, y, hookedFish, timeSec) {
  const species = hookedFish && hookedFish.species;
  const stamina = Math.max(0, Math.min(1, (hookedFish && hookedFish.stamina) ?? 1));
  const exhausted = typeof hookedFish?.isExhausted === 'function' ? hookedFish.isExhausted() : stamina < 0.15;
  const size = Math.max(10, Math.min(34, (species && species.size) || 18));
  const color = speciesColor(species);
  const name = (species && species.name) || 'Fish';

  // Thrashing: more frantic (bigger, faster wobble) at high stamina, calm
  // and slow as the fish tires.
  const wobbleAmp = 2 + stamina * 10;
  const wobbleSpeed = 4 + stamina * 10;
  const bodyWobble = Math.sin(timeSec * wobbleSpeed) * wobbleAmp;
  const tailWobble = Math.sin(timeSec * wobbleSpeed * 1.4 + 1) * (wobbleAmp * 1.3);
  const tilt = exhausted ? Math.sin(timeSec * 1.5) * 0.15 + 0.3 : 0;

  ctx.save();
  ctx.translate(x, y + bodyWobble * 0.4);
  ctx.rotate(tilt);
  if (exhausted) ctx.globalAlpha = 0.75;

  // Tail.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-size * 0.9, 0);
  ctx.lineTo(-size * 1.4, -size * 0.45 + tailWobble * 0.3);
  ctx.lineTo(-size * 1.4, size * 0.45 + tailWobble * 0.3);
  ctx.closePath();
  ctx.fill();

  // Body.
  ctx.beginPath();
  ctx.ellipse(0, 0, size, size * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  // Belly highlight.
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.ellipse(size * 0.1, size * 0.18, size * 0.6, size * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eye.
  ctx.fillStyle = '#10151a';
  ctx.beginPath();
  ctx.arc(size * 0.55, -size * 0.08, size * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Species label floats above the fish.
  ctx.save();
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(238,244,247,0.9)';
  ctx.textAlign = 'center';
  ctx.fillText(name, x, y - size - 10);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// renderScene
// ---------------------------------------------------------------------------
export function renderScene(ctx, width, height, state) {
  const now = performance.now();
  const timeSec = now / 1000;

  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, width, height, timeSec);

  const rodOrigin = state.rodOrigin || { x: width * 0.15, y: height * 0.25 };

  switch (state.state) {
    case 'charging': {
      drawAngler(ctx, rodOrigin);
      drawAimIndicator(ctx, rodOrigin, state.chargeAngle ?? -45);
      break;
    }

    case 'cast_flight': {
      drawAngler(ctx, rodOrigin);
      let lx = rodOrigin.x, ly = rodOrigin.y;
      if (state.cast && typeof state.cast.trajectoryFn === 'function') {
        const p = state.cast.trajectoryFn(state.castElapsed || 0);
        if (p) { lx = p.x; ly = p.y; }
      }
      drawFishingLine(ctx, rodOrigin.x, rodOrigin.y, lx, ly, { slack: 0.05, timeSec });
      drawLure(ctx, lx, ly);
      break;
    }

    case 'waiting_bite': {
      drawAngler(ctx, rodOrigin);
      const lx = state.cast ? state.cast.landingX : rodOrigin.x + 400;
      const ly = state.cast ? state.cast.landingY : rodOrigin.y + 300;
      drawFishingLine(ctx, rodOrigin.x, rodOrigin.y, lx, ly, { slack: 0.25, timeSec });
      drawRestingBob(ctx, lx, ly, timeSec);
      break;
    }

    case 'fighting': {
      drawAngler(ctx, rodOrigin);
      const landX = state.cast ? state.cast.landingX : rodOrigin.x + 400;
      const landY = state.cast ? state.cast.landingY : rodOrigin.y + 300;
      const tension = state.tensionState || { tension: 0, distanceRemaining: 1 };
      const distRemaining = Math.max(0, Math.min(1, tension.distanceRemaining ?? 1));
      const fishX = landX + (rodOrigin.x - landX) * (1 - distRemaining);
      const fishY = landY + (rodOrigin.y - landY) * (1 - distRemaining);

      const slack = Math.max(0, 1 - (tension.tension ?? 0));
      drawFishingLine(ctx, rodOrigin.x, rodOrigin.y, fishX, fishY, {
        slack: slack * 0.6,
        tension: tension.tension ?? 0,
        timeSec,
      });

      if (state.hookedFish) {
        drawFish(ctx, fishX, fishY, state.hookedFish, timeSec);
      } else {
        drawLure(ctx, fishX, fishY);
      }
      break;
    }

    case 'menu':
    case 'result':
    default: {
      drawAngler(ctx, rodOrigin);
      break;
    }
  }

  drawSplashes(ctx, now);
}

// ---------------------------------------------------------------------------
// renderHUD — DOM overlay, built once then updated in place.
// ---------------------------------------------------------------------------
const hudRegistry = new WeakMap();

function buildHud(hudElement) {
  const powerPanel = document.createElement('div');
  powerPanel.className = 'hud-panel hud-power-panel';
  const powerLabel = document.createElement('div');
  powerLabel.className = 'hud-label';
  powerLabel.textContent = 'Cast Power';
  const powerTrack = document.createElement('div');
  powerTrack.className = 'hud-bar-track';
  const powerFill = document.createElement('div');
  powerFill.className = 'hud-bar-fill hud-power-fill';
  powerTrack.appendChild(powerFill);
  powerPanel.appendChild(powerLabel);
  powerPanel.appendChild(powerTrack);

  const fightPanel = document.createElement('div');
  fightPanel.className = 'hud-panel hud-fight-panel';

  const speciesName = document.createElement('div');
  speciesName.className = 'hud-species-name';
  speciesName.textContent = 'Fish';

  const tensionLabel = document.createElement('div');
  tensionLabel.className = 'hud-label';
  tensionLabel.textContent = 'Line Tension';
  const tensionTrack = document.createElement('div');
  tensionTrack.className = 'hud-bar-track';
  const tensionFill = document.createElement('div');
  tensionFill.className = 'hud-bar-fill hud-tension-fill';
  tensionTrack.appendChild(tensionFill);

  const staminaLabel = document.createElement('div');
  staminaLabel.className = 'hud-label';
  staminaLabel.textContent = 'Fish Stamina';
  const staminaTrack = document.createElement('div');
  staminaTrack.className = 'hud-bar-track';
  const staminaFill = document.createElement('div');
  staminaFill.className = 'hud-bar-fill hud-stamina-fill';
  staminaTrack.appendChild(staminaFill);

  const distanceRow = document.createElement('div');
  distanceRow.className = 'hud-distance-row';
  distanceRow.textContent = 'Distance: —';

  fightPanel.appendChild(speciesName);
  fightPanel.appendChild(tensionLabel);
  fightPanel.appendChild(tensionTrack);
  fightPanel.appendChild(staminaLabel);
  fightPanel.appendChild(staminaTrack);
  fightPanel.appendChild(distanceRow);

  hudElement.appendChild(powerPanel);
  hudElement.appendChild(fightPanel);

  const refs = { powerPanel, powerFill, fightPanel, speciesName, tensionFill, staminaFill, distanceRow };
  hudRegistry.set(hudElement, refs);
  return refs;
}

export function renderHUD(hudElement, state) {
  if (!hudElement) return;
  const refs = hudRegistry.get(hudElement) || buildHud(hudElement);

  const isCharging = state.state === 'charging';
  const isFighting = state.state === 'fighting';

  refs.powerPanel.classList.toggle('visible', isCharging);
  refs.fightPanel.classList.toggle('visible', isFighting);

  if (isCharging) {
    const power = Math.max(0, Math.min(1, state.chargePower ?? 0));
    refs.powerFill.style.width = `${power * 100}%`;
  }

  if (isFighting) {
    const tensionState = state.tensionState || {};
    const tension = Math.max(0, Math.min(1, tensionState.tension ?? 0));
    refs.tensionFill.style.width = `${tension * 100}%`;
    const tensionColor = tension < 0.5
      ? lerpColor('#7fd8a8', '#ffb703', tension / 0.5)
      : lerpColor('#ffb703', '#e63946', (tension - 0.5) / 0.5);
    refs.tensionFill.style.backgroundColor = tensionColor;

    const distanceRemaining = tensionState.distanceRemaining;
    refs.distanceRow.textContent = `Distance: ${
      typeof distanceRemaining === 'number' ? `${Math.round(distanceRemaining * 100)}%` : '—'
    }`;

    const fish = state.hookedFish;
    refs.speciesName.textContent = fish?.species?.name || 'Fish';
    const stamina = Math.max(0, Math.min(1, fish?.stamina ?? 1));
    refs.staminaFill.style.width = `${stamina * 100}%`;
  }
}
