// tension.js
// Models the fight between angler and fish as a damped spring/rope connecting the rod to the
// hooked fish. distanceRemaining is how much "line" is still out between rod and fish (1 = fish
// far out, 0 = fish at the net); tension is how taut/strained the line is right now. The core
// skill mechanic: reeling while the fish is pulling hard spikes tension fast (you're forcing a
// taut line against a surging fish), reeling while the fish is calm makes safe progress, and
// backing off (reelInput = 0) always bleeds tension back down. Getting the feel right under
// playtesting will mean tweaking the constants below, not the formulas.

// ---- Tuning constants (safe to rebalance later) ----
const REEL_SPEED = 0.35;         // fraction of distanceRemaining reclaimed per second at full reel with no fish resistance
const FISH_STRIP_RATE = 0.5;     // fraction of distanceRemaining the fish strips back out per second, per unit of pull magnitude
const PASSIVE_LOAD_GAIN = 0.35;  // baseline tension contributed by the fish's pull alone, even while not reeling (line stays somewhat taut)
const CONFLICT_GAIN = 1.6;       // extra tension contributed specifically by reeling INTO a pulling fish — the core risk/reward spike
const SPRING_STIFFNESS = 18;     // how fast tension chases its target value (rope/rod "spring constant")
const SPRING_DAMPING = 7;        // damps tension's rate of change so it eases toward target instead of oscillating wildly
const IDLE_TENSION_BLEED = 0.6;  // extra tension lost per second whenever the player isn't reeling (easing off relieves the line)

export class LineTensionSystem {
  constructor(breakThreshold) {
    this.breakThreshold = breakThreshold;
    this.reset();
  }

  reset() {
    this.distanceRemaining = 1; // fish starts far out
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
    const reelProgress = reel * REEL_SPEED;
    const fishResistance = pullMag * FISH_STRIP_RATE;
    this.distanceRemaining += (fishResistance - reelProgress) * dt;
    this.distanceRemaining = Math.min(1, Math.max(0, this.distanceRemaining));

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
    } else if (this.distanceRemaining <= 0) {
      this.distanceRemaining = 0;
      this.landed = true;
    }

    return this._state();
  }

  _state() {
    return {
      tension: this.tension,
      distanceRemaining: this.distanceRemaining,
      broken: this.broken,
      landed: this.landed,
    };
  }
}
