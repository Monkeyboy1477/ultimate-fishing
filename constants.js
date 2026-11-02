// World layout and timing shared by gameplay and rendering. Meters; +X right, +Y up, -Z out over the water.

export const DECK_Y = 0.35;
export const DOCK_END_Z = -3.5;
export const DOCK_HALF_WIDTH = 1.3;

export const EYE_POS = { x: 0, y: 2.0, z: 0 };
export const CAMERA_PITCH_DEG = -10;
export const ROD_TIP = { x: 0.55, y: 1.75, z: -2.9 };

// Where a retrieved lure or landed fish ends up, just off the end of the dock.
export const HOME_POINT = { x: 0.55, y: 0.05, z: -4.0 };
export const HOME_RADIUS_M = 1.0;

// Lateral gap between the two players' spots in 2P mode.
export const PLAYER_SEPARATION_M = 1.2;

// Eye/rod/home points for a player standing offsetX meters to the side of the single-player spot.
export function pointsForOffset(offsetX) {
  return {
    eyePos: { x: EYE_POS.x + offsetX, y: EYE_POS.y, z: EYE_POS.z },
    rodTip: { x: ROD_TIP.x + offsetX, y: ROD_TIP.y, z: ROD_TIP.z },
    homePoint: { x: HOME_POINT.x + offsetX, y: HOME_POINT.y, z: HOME_POINT.z },
  };
}

// Seconds from releasing the cast to the fish being landed, for a player who keeps reeling.
export const CATCH_TIME_LIMIT_S = 30;
// Longest a lure can sit in the water without a bite.
export const BITE_DEADLINE_S = 10;
// Longest a full free retrieve can take, whatever the cast distance.
export const MAX_RETRIEVE_S = 6;
export const MIN_RETRIEVE_SPEED_MPS = 8;
