// Procedural ambience using Web Audio: lapping water, wind, birdsong and a soft music pad.

const STORAGE_KEY = 'ultimateFishing.soundMode';
const MODES = ['all', 'nature', 'off'];
const MODE_LABELS = { all: 'Sound: Music + Nature', nature: 'Sound: Nature', off: 'Sound: Off' };
const FADE_S = 2.5;

const NATURE_LEVEL = 0.55;
const MUSIC_LEVEL = 0.32;

// A major pentatonic stays consonant whichever notes land together.
const CHORDS = [
  [146.83, 220.0, 293.66, 369.99],
  [123.47, 185.0, 246.94, 293.66],
  [98.0, 196.0, 246.94, 293.66],
  [110.0, 164.81, 220.0, 277.18],
];
const MELODY_NOTES = [587.33, 659.25, 739.99, 880.0, 987.77];

let ctx = null;
let natureBus = null;
let musicBus = null;
let echoInput = null;
let mode = loadMode();
let chordIndex = 0;

function loadMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(saved) ? saved : 'all';
  } catch {
    return 'all';
  }
}

function saveMode() {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private windows can block storage; the choice just won't persist.
  }
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function makeNoiseBuffer(seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  // Crossfade the ends so the loop point doesn't click.
  const blend = Math.floor(ctx.sampleRate * 0.25);
  for (let i = 0; i < blend; i += 1) {
    const mix = i / blend;
    data[i] = data[i] * mix + data[length - blend + i] * (1 - mix);
  }
  return buffer;
}

function startFilteredNoise(buffer, filterType, frequency, level, lfoRate, lfoDepth) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;

  const gain = ctx.createGain();
  gain.gain.value = level;

  const lfo = ctx.createOscillator();
  lfo.frequency.value = lfoRate;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = lfoDepth;
  lfo.connect(lfoGain).connect(gain.gain);

  source.connect(filter).connect(gain).connect(natureBus);
  source.start();
  lfo.start();
}

function chirp(startTime, baseFrequency, pan) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;

  const length = randomBetween(0.06, 0.16);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(baseFrequency, startTime);
  osc.frequency.exponentialRampToValueAtTime(baseFrequency * randomBetween(1.1, 1.5), startTime + length);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.05, startTime + length * 0.3);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + length);

  osc.connect(gain).connect(panner).connect(natureBus);
  panner.connect(echoInput);
  osc.start(startTime);
  osc.stop(startTime + length + 0.02);
}

function scheduleBird() {
  setTimeout(() => {
    if (ctx.state === 'running') {
      const base = randomBetween(2400, 4400);
      const pan = randomBetween(-0.8, 0.8);
      const count = 2 + Math.floor(Math.random() * 5);
      let time = ctx.currentTime + 0.05;
      for (let i = 0; i < count; i += 1) {
        chirp(time, base * randomBetween(0.95, 1.08), pan);
        time += randomBetween(0.12, 0.26);
      }
    }
    scheduleBird();
  }, randomBetween(4000, 13000));
}

function playPad() {
  const chord = CHORDS[chordIndex % CHORDS.length];
  chordIndex += 1;
  const now = ctx.currentTime;
  const duration = 11;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 750;
  filter.connect(musicBus);
  filter.connect(echoInput);

  chord.forEach((frequency) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    osc.detune.value = randomBetween(-5, 5);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 4);
    gain.gain.setValueAtTime(0.05, now + duration - 5);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(filter);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  });
}

function playMelodyNote() {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = MELODY_NOTES[Math.floor(Math.random() * MELODY_NOTES.length)];

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);

  osc.connect(gain);
  gain.connect(musicBus);
  gain.connect(echoInput);
  osc.start(now);
  osc.stop(now + 2.5);
}

function scheduleMusic() {
  // Generating while muted would pile up nothing audible, so skip until music is on.
  const tick = () => {
    if (ctx.state === 'running' && mode === 'all') playPad();
    setTimeout(tick, 9000);
  };
  tick();

  const melodyTick = () => {
    if (ctx.state === 'running' && mode === 'all' && Math.random() < 0.7) playMelodyNote();
    setTimeout(melodyTick, randomBetween(2500, 7000));
  };
  setTimeout(melodyTick, 5000);
}

function applyMode(fadeSeconds) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const natureTarget = mode === 'off' ? 0 : NATURE_LEVEL;
  const musicTarget = mode === 'all' ? MUSIC_LEVEL : 0;
  natureBus.gain.cancelScheduledValues(now);
  musicBus.gain.cancelScheduledValues(now);
  natureBus.gain.setTargetAtTime(natureTarget, now, fadeSeconds / 3);
  musicBus.gain.setTargetAtTime(musicTarget, now, fadeSeconds / 3);
}

function start() {
  if (ctx) {
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  ctx = new AudioContextClass();

  natureBus = ctx.createGain();
  natureBus.gain.value = 0;
  natureBus.connect(ctx.destination);

  musicBus = ctx.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(ctx.destination);

  const echoDelay = ctx.createDelay(2);
  echoDelay.delayTime.value = 0.42;
  const echoFeedback = ctx.createGain();
  echoFeedback.gain.value = 0.38;
  const echoOutput = ctx.createGain();
  echoOutput.gain.value = 0.3;
  echoInput = echoDelay;
  echoDelay.connect(echoFeedback).connect(echoDelay);
  echoDelay.connect(echoOutput).connect(musicBus);

  const noise = makeNoiseBuffer(6);
  startFilteredNoise(noise, 'lowpass', 520, 0.5, 0.11, 0.18);
  startFilteredNoise(noise, 'bandpass', 900, 0.1, 0.05, 0.06);

  scheduleBird();
  scheduleMusic();
  applyMode(FADE_S);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });
}

export function installAudio(stageElement) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-button menu-button-secondary';
  button.textContent = MODE_LABELS[mode];
  button.style.cssText =
    'position:absolute;top:12px;left:12px;z-index:5;padding:6px 10px;font-size:0.8rem;background:rgba(15,32,39,0.8);pointer-events:auto;';
  button.addEventListener('click', () => {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    button.textContent = MODE_LABELS[mode];
    saveMode();
    start();
    applyMode(0.6);
    // Space reels, so a focused button must not also catch it.
    button.blur();
  });
  stageElement.appendChild(button);

  // Browsers only allow audio to begin after a user gesture.
  window.addEventListener('pointerdown', start);
  window.addEventListener('keydown', start);
}
