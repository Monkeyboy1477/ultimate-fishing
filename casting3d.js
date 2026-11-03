// casting3d.js
// Produces 3D world-space casting trajectories for the first-person rebuild.
// World convention: meters; +X = right, +Y = up, -Z = straight out over the water.
// Casts originate at ROD_TIP (constants.js). Water surface: y = 0.

import { ROD_TIP, HOME_POINT, HOME_RADIUS_M, MAX_RETRIEVE_S, MIN_RETRIEVE_SPEED_MPS } from './constants.js';

// --- Power-meter tuning -----------------------------------------------------
const POWER_CYCLE_PERIOD_SEC = 1.4; // seconds for one full 0 -> 1 -> 0 oscillation while charging
const POWER_CYCLE_ANGULAR_SPEED = (2 * Math.PI) / POWER_CYCLE_PERIOD_SEC; // derived angular speed

// --- Distance tuning ---------------------------------------------------------
const MIN_CAST_DISTANCE_M = 7; // weakest realistic release (comfortably above 0)
const MAX_CAST_DISTANCE_M = 55; // must stay in sync with fish.js's MAX_CAST_DISTANCE_M
const DISTANCE_POWER_EXPONENT = 1.5; // power^1.5 reads more like a real cast than linear
const MAX_LATERAL_M = 45; // clamp so extreme aim angles don't fling the lure absurdly sideways

// --- Flight-arc tuning -------------------------------------------------------
const GRAVITY = 11; // m/s^2 - a touch lighter than real gravity, reads well for a lure arc
const LAUNCH_ANGLE_MAX_DEG = 50; // low-power release: lobbed, high arcing toss
const LAUNCH_ANGLE_MIN_DEG = 20; // full-power release: flatter, harder, faster cast

export class CastController {
  // rodStats: optional { maxDistance, powerExponent } from the equipped rod's shop tier.
  // Defaults match the original single-tier behavior exactly when omitted.
  // map: optional, keeps the cast inside that map's water however strong the rod is.
  // originPoint: optional, lets a second player cast from their own world-space rod tip
  // instead of the single-player ROD_TIP. Defaults to ROD_TIP, matching today's behavior.
  constructor(rodStats, map, originPoint = ROD_TIP) {
    this.charging = false; // true while mouse is held down, aiming
    this.chargeTime = 0; // seconds elapsed since startCharging()
    this.currentPower = 0; // 0..1, read directly by the HUD every frame
    this.maxDistance = Math.min(rodStats?.maxDistance ?? MAX_CAST_DISTANCE_M, map?.maxCastM ?? Infinity);
    this.maxLateral = map?.maxLateralM ?? MAX_LATERAL_M;
    this.distancePowerExponent = rodStats?.powerExponent ?? DISTANCE_POWER_EXPONENT;
    this.origin = originPoint;
  }

  startCharging() {
    this.charging = true;
    this.chargeTime = 0;
    this.currentPower = 0;
  }

  updateCharge(dt) {
    if (!this.charging) return;
    this.chargeTime += dt;
    // Oscillating (not linear-ramp) power meter: rises 0 -> 1 then falls 1 -> 0 and repeats,
    // so timing the release matters as much as how long the button was held.
    this.currentPower =
      0.5 - 0.5 * Math.cos(this.chargeTime * POWER_CYCLE_ANGULAR_SPEED);
  }

  release(aimAngleDeg) {
    const power = this.currentPower;
    this.charging = false;

    // Distance scales with power^1.5 for a believable, non-linear feel between a weak
    // flick (MIN_CAST_DISTANCE_M) and a full-power cast (MAX_CAST_DISTANCE_M).
    const landingDistance =
      MIN_CAST_DISTANCE_M +
      (this.maxDistance - MIN_CAST_DISTANCE_M) *
        Math.pow(power, this.distancePowerExponent);

    const aimAngleRad = (aimAngleDeg * Math.PI) / 180;
    const rawLateral = landingDistance * Math.tan(aimAngleRad);
    const landingLateral = Math.max(
      -this.maxLateral,
      Math.min(this.maxLateral, rawLateral)
    );

    // landingLateral/landingDistance are measured from the single-player center line
    // (ROD_TIP's own baseline); shift them by however far this.origin sits from ROD_TIP so a
    // second player casting from a different origin lands offset by that same amount.
    const originOffsetX = this.origin.x - ROD_TIP.x;
    const originOffsetZ = this.origin.z - ROD_TIP.z;
    const landingPoint = { x: landingLateral + originOffsetX, y: 0, z: -landingDistance + originOffsetZ };

    // --- Build a real parabolic projectile arc from the rod tip to landingPoint ---
    const dx = landingPoint.x - this.origin.x;
    const dz = landingPoint.z - this.origin.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const dirX = horizontalDist > 0 ? dx / horizontalDist : 0;
    const dirZ = horizontalDist > 0 ? dz / horizontalDist : -1;

    // A harder/more powerful release launches flatter (smaller angle), a weak release lobs
    // the lure higher. Interpolate the launch angle by power.
    const launchAngleDeg =
      LAUNCH_ANGLE_MAX_DEG - (LAUNCH_ANGLE_MAX_DEG - LAUNCH_ANGLE_MIN_DEG) * power;
    const theta = (launchAngleDeg * Math.PI) / 180;

    // Solve for the launch speed v0 that makes the projectile, launched at angle theta from
    // height ROD_TIP.y, land exactly at y = 0 after covering horizontalDist meters:
    //   y(t) = h0 + v0*sin(theta)*t - 0.5*g*t^2 = 0
    //   x(t) = v0*cos(theta)*t = horizontalDist
    // Substituting t = horizontalDist / (v0*cos(theta)) into the y equation and solving for v0^2:
    const h0 = this.origin.y;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const denom = h0 + horizontalDist * Math.tan(theta);
    const v0 =
      horizontalDist > 0
        ? Math.sqrt(
            (0.5 * GRAVITY * horizontalDist * horizontalDist) /
              (cosT * cosT * denom)
          )
        : Math.sqrt((2 * GRAVITY * h0) / (sinT * sinT || 1)); // degenerate straight-up fallback

    const vHoriz = v0 * cosT; // constant horizontal speed along the (dirX, dirZ) direction
    const flightDuration = horizontalDist > 0 ? horizontalDist / vHoriz : 2 * v0 * sinT / GRAVITY;

    const trajectoryFn = (t) => {
      const clampedT = Math.max(0, Math.min(t, flightDuration));
      const travelled = vHoriz * clampedT;
      return {
        x: this.origin.x + dirX * travelled,
        y: h0 + v0 * sinT * clampedT - 0.5 * GRAVITY * clampedT * clampedT,
        z: this.origin.z + dirZ * travelled,
      };
    };

    return {
      power,
      aimAngleDeg,
      flightDuration,
      landingDistance,
      landingLateral,
      landingPoint,
      trajectoryFn,
    };
  }
}

// --- Free retrieve -----------------------------------------------------------

function horizontalDistanceToHome(pos, homePoint = HOME_POINT) {
  return Math.hypot(pos.x - homePoint.x, pos.z - homePoint.z);
}

// A lure cut off right after release can still be over the dock, shoreward of homePoint.
export function isLureHome(pos, homePoint = HOME_POINT) {
  return pos.z >= homePoint.z || horizontalDistanceToHome(pos, homePoint) <= HOME_RADIUS_M;
}

export function retrieveSpeedFor(pos, homePoint = HOME_POINT) {
  return Math.max(MIN_RETRIEVE_SPEED_MPS, horizontalDistanceToHome(pos, homePoint) / MAX_RETRIEVE_S);
}

export function stepRetrieve(pos, speed, dt, homePoint = HOME_POINT) {
  const distance = horizontalDistanceToHome(pos, homePoint);
  const fraction = distance > 0 ? Math.min(1, (speed * dt) / distance) : 0;
  return {
    x: pos.x + (homePoint.x - pos.x) * fraction,
    y: 0,
    z: pos.z + (homePoint.z - pos.z) * fraction,
  };
}
