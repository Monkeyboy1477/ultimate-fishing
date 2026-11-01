// tension.js
// Models the fight between angler and fish as a damped spring/rope connecting the rod to the
// hooked fish. distanceRemaining is how much "line" is still out between rod and fish (1 = fish
// far out, 0 = fish at the net); tension is how taut/strained the line is right now. The core
// skill mechanic: reeling while the fish is pulling hard spikes tension fast (you're forcing a
// taut line against a surging fish), reeling while the fish is calm makes safe progress, and
// backing off (reelInput = 0) always bleeds tension back down. Getting the feel right under
// playtesting will mean tweaking the constants below, not the formulas.

import { CATCH_TIME_LIMIT_S } from './constants.js';

// ---- Tuning constants (safe to rebalance later) ----
const REEL_PACE = 1.4;           // full-fight lengths of line reclaimed over targetS at full reel with no fish resistance
const FISH_STRIP_PACE = 0.7;     // full-fight lengths the fish strips back over targetS, per unit of pull magnitude
const PASSIVE_LOAD_GAIN = 0.35;  // baseline tension contributed by the fish's pull alone, even while not reeling (line stays somewhat taut)
const CONFLICT_GAIN = 1.6;       // extra tension contributed specifically by reeling INTO a pulling fish — the core risk/reward spike
const SPRING_STIFFNESS = 7;     // how fast tension chases its target value (rope/rod "spring constant")
const SPRING_DAMPING = 5.3;        // damps tension's rate of change so it eases toward target instead of oscillating wildly
const IDLE_TENSION_BLEED = 0.6;  // extra tension lost per second whenever the player isn't reeling (easing off relieves the line)

// ---- Catch clock ----
const CLOCK_SAFETY_MARGIN_S = 1;
const MIN_FIGHT_S = 6;
const TOUGHNESS_FIGHT_S = 12;    // added for the toughest fish (staminaMax 200)
const DISTANCE_FIGHT_S = 6;      // added for a fish hooked at the longest cast (130m)

// budgetS is the hard limit that keeps the whole catch within CATCH_TIME_LIMIT_S of the cast's
// release. targetS is how long this fight should take when played well: longer for tougher fish
// hooked farther out, so a fish hooked close in is still a real fight.
export function fightTiming(species, lureDistanceM, elapsedSinceReleaseS) {
  const budgetS = Math.max(1, CATCH_TIME_LIMIT_S - elapsedSinceReleaseS - CLOCK_SAFETY_MARGIN_S);
  const targetS =
    MIN_FIGHT_S +
    TOUGHNESS_FIGHT_S * Math.min(1, species.staminaMax / 200) +
    DISTANCE_FIGHT_S * Math.min(1, lureDistanceM / 130);
  return { budgetS, targetS: Math.min(budgetS, targetS) };
}

// One frame of a fight. outcome: null while it continues, else 'line_snapped', 'fish_escaped' or
// 'landed'.
export function stepFight(fish, tensionSystem, tensionState, dt, reelInput) {
  const fishUpdate = fish.update(dt, tensionState, reelInput);
  const next = tensionSystem.update(dt, fishUpdate.pullVector, reelInput);
  let outcome = null;
  if (next.broken) outcome = 'line_snapped';
  else if (fishUpdate.escaped) outcome = 'fish_escaped';
  else if (next.landed) outcome = 'landed';
  return { tensionState: next, outcome };
}

export class LineTensionSystem {
  constructor(breakThreshold, timing = { budgetS: CATCH_TIME_LIMIT_S, targetS: 12 }) {
    this.breakThreshold = breakThreshold;
    this.budgetS = timing.budgetS;
    this.targetS = timing.targetS;
    this.reset();
  }

  reset() {
    this.distanceRemaining = 1; // fish starts at the point it was hooked
    this.fightElapsed = 0;
    this.tension = 0;
    this._tensionVelocity = 0;
    this.broken = false;
    this.landed = false;
  }

  update(dt, fishPullVector, reelInput) {
    // Once the fight is resolved (line snapped or fish landed), freeze state.
    if (this.broken || this.landed) {
      return this._state();
    }

    const pull = fishPullVector || { x: 0, y: 0 };
    const pullMag = Math.sqrt(pull.x * pull.x + pull.y * pull.y);
    const reel = reelInput ? 1 : 0;

    // --- Distance: reeling pulls the fish in; the fish's own pull strips line back out. ---
    const reelProgress = (reel * REEL_PACE) / this.targetS;
    const fishResistance = (pullMag * FISH_STRIP_PACE) / this.targetS;
    this.distanceRemaining += (fishResistance - reelProgress) * dt;

    // The ceiling shrinks to 0 at budgetS, so no fish can stay out past the catch clock.
    this.fightElapsed += dt;
    const ceiling = Math.max(0, 1 - this.fightElapsed / this.budgetS);
    this.distanceRemaining = Math.min(ceiling, Math.max(0, this.distanceRemaining));

    // --- Tension: damped spring chasing a target load. ---
    // Baseline load comes just from the fish pulling against a hooked line; the conflict term
    // only matters when BOTH reeling and a strong fish pull happen at once — that's the spike
    // the player has to learn to avoid by easing off when the fish surges.
    const targetTension = pullMag * PASSIVE_LOAD_GAIN + reel * pullMag * CONFLICT_GAIN;

    const springForce = (targetTension - this.tension) * SPRING_STIFFNESS;
    const dampingForce = -this._tensionVelocity * SPRING_DAMPING;
    this._tensionVelocity += (springForce + dampingForce) * dt;
    this.tension += this._tensionVelocity * dt;

    // Letting off the reel bleeds extra tension out of the line (slack relieves strain).
    if (reel === 0) {
      this.tension -= IDLE_TENSION_BLEED * dt;
    }
    this.tension = Math.max(0, this.tension);

    if (this.tension > this.breakThreshold) {
      this.broken = true;
    } else if (this.distanceRemaining <= 0 && reel) {
      this.landed = true;
    }

    return this._state();
  }

  _state() {
    return {
      tension: this.tension,
      breakThreshold: this.breakThreshold,
      distanceRemaining: this.distanceRemaining,
      broken: this.broken,
      landed: this.landed,
    };
  }
}
