// scene3d.js
// Realistic first-person 3D scene for Umtimatefishing, built with Three.js via
// the browser-native import map in index.html (no bundler). Owns the
// WebGLRenderer, camera, water/sky, shoreline, first-person rod+line rig,
// hooked-fish visualization, and splash/ripple particle effects.
//
// World convention: meters. +X right, +Y up, -Z out over the water (default
// Three.js camera-forward, so no extra camera rotation needed). Camera/eye at
// (0, 1.6, 0) looking toward -Z, fixed in place (first-person, no mouselook).
// Rod tip at (0.35, 1.05, -0.6). Water plane at y=0, x: -60..60, z: 0..-220.
// aimAngleDeg: 0 = straight out along -Z, positive = right (+X), negative =
// left (-X).

import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';

// ---------------------------------------------------------------------------
// Module-level state, populated once by initScene().
// ---------------------------------------------------------------------------

const EYE_POS = new THREE.Vector3(0, 1.6, 0);
const ROD_TIP = new THREE.Vector3(0.35, 1.05, -0.6);
const MAX_AIM_ANGLE_DEG = 40;

let renderer = null;
let camera = null;
let scene = null;

let water = null;
let sky = null;
let sun = null; // directional light standing in for the sun
let sunSphere = null; // small emissive mesh so the sun is visible in sky

let rodGroup = null;
let rodTipWorld = null; // THREE.Object3D marking current rod tip (moves with aim)
let lineGeometry = null;
let lineMesh = null;
let lineMaterial = null;
let lurePivot = null;
let lureMesh = null;

let fishGroup = null;
let fishBodyMesh = null;
let fishTailMesh = null;
let fishTailPivot = null;
let fishBodyMaterial = null;
let fishFinMaterial = null;

const splashEffects = []; // { group, age, lifetime, ripple, particles }

let started = false;
let clock = null;

// ---------------------------------------------------------------------------
// initScene
// ---------------------------------------------------------------------------

export function initScene(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = false;

  camera = new THREE.PerspectiveCamera(58, canvas.width / canvas.height, 0.1, 500);
  camera.position.copy(EYE_POS);
  camera.lookAt(0, 1.4, -10);

  scene = new THREE.Scene();

  // ---- Sun + lights --------------------------------------------------------
  sun = new THREE.Vector3();
  // NOTE: with the theta formula below, elevation must be > 0.5 to sit above the horizon
  // (elevation=0.5 -> theta=0 -> sun.y=0 -> exactly on the horizon). The original 0.28 here
  // put the sun's y component negative, i.e. BELOW the horizon, which is what made the whole
  // scene render as a murky, dark, backlit dusk instead of a bright clear day.
  const sunAngleElevation = 0.72; // ~40 degrees above horizon, bright midday-ish light
  const sunAngleAzimuth = 0.22; // slightly off straight-out, towards +X
  const theta = Math.PI * (sunAngleElevation - 0.5);
  const phi = 2 * Math.PI * (sunAngleAzimuth - 0.5);
  sun.x = Math.cos(phi) * Math.cos(theta) * 1;
  sun.y = Math.sin(theta);
  sun.z = Math.sin(phi) * Math.cos(theta) * -1;
  sun.normalize();

  const sunLight = new THREE.DirectionalLight(0xfff2d9, 2.2);
  sunLight.position.copy(sun).multiplyScalar(200);
  sunLight.target.position.set(0, 0, -60);
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a3226, 0.55);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(ambient);

  // Small bright sphere standing in for the visible solar disc.
  sunSphere = new THREE.Mesh(
    new THREE.SphereGeometry(3, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff6e0 })
  );
  sunSphere.position.copy(sun).multiplyScalar(300);
  scene.add(sunSphere);

  // ---- Sky -------------------------------------------------------------
  sky = new Sky();
  sky.scale.setScalar(450);
  scene.add(sky);
  const skyUniforms = sky.material.uniforms;
  skyUniforms['turbidity'].value = 3;
  skyUniforms['rayleigh'].value = 1.5;
  skyUniforms['mieCoefficient'].value = 0.004;
  skyUniforms['mieDirectionalG'].value = 0.8;
  skyUniforms['sunPosition'].value.copy(sun);

  // ---- Water -------------------------------------------------------------
  const waterGeometry = new THREE.PlaneGeometry(120, 220);
  water = new Water(waterGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: new THREE.TextureLoader().load(
      // The `three` npm package only publishes examples/jsm and examples/fonts, not
      // examples/textures, so this texture must come from jsdelivr's GitHub mirror instead
      // of the npm one (which 404s for anything under examples/textures).
      'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/waternormals.jpg',
      (texture) => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      }
    ),
    sunDirection: sun.clone(),
    sunColor: 0xffffff,
    waterColor: 0x0d4a5c,
    distortionScale: 3.0,
    fog: false,
  });
  water.rotation.x = -Math.PI / 2;
  // Plane spans z: -110..110 centered at 0; shift so it covers z: -220..0,
  // i.e. shoreline at z=0, water stretching out to -220.
  water.position.set(0, 0, -110);
  scene.add(water);

  // ---- Shoreline / bank -------------------------------------------------
  const shoreGeometry = new THREE.CircleGeometry(40, 32, 0, Math.PI);
  const shoreMaterial = new THREE.MeshStandardMaterial({
    color: 0x9c8257,
    roughness: 0.95,
    metalness: 0.0,
  });
  const shore = new THREE.Mesh(shoreGeometry, shoreMaterial);
  shore.rotation.x = -Math.PI / 2;
  // CircleGeometry's half-disc opens along +X by default when rotated this
  // way; rotate around Y so the flat edge sits at z=0 and the bulge is
  // behind the camera (+Z, where the player stands).
  shore.rotation.z = Math.PI;
  shore.position.set(0, 0.02, 0);
  scene.add(shore);

  // A little texture variation: a few rocks near the water's edge.
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x6e6a63, roughness: 1 });
  for (let i = 0; i < 6; i += 1) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15 + Math.random() * 0.25, 0), rockMaterial);
    const rx = (Math.random() - 0.5) * 6;
    const rz = 0.3 + Math.random() * 2.5;
    rock.position.set(rx, 0.1, rz);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    scene.add(rock);
  }

  // ---- First-person rod + line -------------------------------------------
  rodGroup = new THREE.Group();
  scene.add(rodGroup);

  const rodMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2015, roughness: 0.5 });
  const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });

  // Grip, held near the camera, at chest height.
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.35, 8), handleMaterial);
  grip.position.set(0.3, 1.0, -0.15);
  grip.rotation.z = Math.PI / 2 - 0.15;
  grip.rotation.y = -0.08;
  rodGroup.add(grip);

  // Tapered rod blank from grip to rod tip.
  const rodLength = EYE_POS.distanceTo(ROD_TIP) + 0.4;
  const rodBlank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.02, rodLength, 8),
    rodMaterial
  );
  // Position/orient along the line from grip to tip.
  const gripPos = grip.position.clone();
  const dir = ROD_TIP.clone().sub(gripPos);
  const mid = gripPos.clone().add(dir.clone().multiplyScalar(0.55));
  rodBlank.position.copy(mid);
  rodBlank.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  rodGroup.add(rodBlank);

  // Reel, small cylinder near the grip.
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 10), handleMaterial);
  reel.position.set(gripPos.x - 0.03, gripPos.y - 0.02, gripPos.z + 0.02);
  reel.rotation.x = Math.PI / 2;
  rodGroup.add(reel);

  // Rod tip marker (world-space anchor used every frame for the line).
  rodTipWorld = new THREE.Object3D();
  rodTipWorld.position.copy(ROD_TIP);
  rodGroup.add(rodTipWorld);

  // Line: a thin tube/line geometry, rebuilt each frame as needed.
  lineMaterial = new THREE.LineBasicMaterial({ color: 0xdddddd, linewidth: 1 });
  lineGeometry = new THREE.BufferGeometry();
  const initialLinePts = [ROD_TIP.clone(), ROD_TIP.clone().add(new THREE.Vector3(0, -0.3, -1))];
  lineGeometry.setFromPoints(initialLinePts);
  lineMesh = new THREE.Line(lineGeometry, lineMaterial);
  scene.add(lineMesh);

  // Lure: small weighted sphere at the end of the line.
  lurePivot = new THREE.Group();
  lureMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xcc3322, roughness: 0.4, metalness: 0.3 })
  );
  lurePivot.add(lureMesh);
  lurePivot.position.copy(ROD_TIP).add(new THREE.Vector3(0, -0.3, -1));
  scene.add(lurePivot);

  // ---- Reusable fish mesh/group -------------------------------------------
  // Procedural low-poly fish: a tapered lathe-revolved body (nose at local
  // +X, tail at local -X), a forked tail fin on a pivot at the tail joint
  // (so it swings like a real caudal fin instead of spinning around its own
  // centroid), a small dorsal fin, two small pectoral fins, and a pair of
  // eye dots. Built once here; per-hookup color/scale is applied in
  // renderScene3D's 'fighting' branch.
  fishGroup = new THREE.Group();
  fishGroup.visible = false;
  scene.add(fishGroup);

  fishBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x4d7a8c, roughness: 0.45, metalness: 0.08 });
  fishFinMaterial = new THREE.MeshStandardMaterial({
    color: 0x33586a,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  // Body: a lathe-revolved taper. The lathe revolves around its local Y
  // axis; rotating the resulting mesh +90deg about Z maps lathe-space
  // -Y -> local +X, so the profile's y=-H end (nose, radius 0) ends up at
  // local +X and the y=+H end (tail, radius 0) ends up at local -X.
  const BODY_HALF_LEN = 0.2;
  const bodyProfile = [
    new THREE.Vector2(0.0, -BODY_HALF_LEN),
    new THREE.Vector2(0.055, -BODY_HALF_LEN * 0.55),
    new THREE.Vector2(0.075, 0.0),
    new THREE.Vector2(0.05, BODY_HALF_LEN * 0.5),
    new THREE.Vector2(0.0, BODY_HALF_LEN),
  ];
  const bodyGeometry = new THREE.LatheGeometry(bodyProfile, 8);
  fishBodyMesh = new THREE.Mesh(bodyGeometry, fishBodyMaterial);
  fishBodyMesh.rotation.z = Math.PI / 2;
  fishGroup.add(fishBodyMesh);

  // Dorsal fin: small triangle on top, roughly mid-back.
  const dorsalShape = new THREE.Shape();
  dorsalShape.moveTo(0.04, 0);
  dorsalShape.lineTo(-0.03, 0.09);
  dorsalShape.lineTo(-0.07, 0);
  dorsalShape.lineTo(0.04, 0);
  const dorsalMesh = new THREE.Mesh(new THREE.ShapeGeometry(dorsalShape), fishFinMaterial);
  dorsalMesh.position.set(-0.02, 0.06, 0);
  fishGroup.add(dorsalMesh);

  // Pectoral fins: small flat fins on either side, just behind the head.
  const pectoralShape = new THREE.Shape();
  pectoralShape.moveTo(0, 0);
  pectoralShape.lineTo(-0.07, -0.03);
  pectoralShape.lineTo(-0.02, -0.05);
  pectoralShape.lineTo(0, 0);
  const pectoralGeometry = new THREE.ShapeGeometry(pectoralShape);
  const pectoralRight = new THREE.Mesh(pectoralGeometry, fishFinMaterial);
  pectoralRight.rotation.x = -Math.PI / 2;
  pectoralRight.position.set(0.07, -0.01, 0.045);
  fishGroup.add(pectoralRight);
  const pectoralLeft = new THREE.Mesh(pectoralGeometry, fishFinMaterial);
  pectoralLeft.rotation.x = -Math.PI / 2;
  pectoralLeft.scale.set(1, 1, -1);
  pectoralLeft.position.set(0.07, -0.01, -0.045);
  fishGroup.add(pectoralLeft);

  // Eyes: tiny dark dots just forward of the widest point.
  const eyeGeometry = new THREE.CircleGeometry(0.014, 6);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const eyeRight = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeRight.position.set(0.1, 0.02, 0.055);
  fishGroup.add(eyeRight);
  const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeLeft.position.set(0.1, 0.02, -0.055);
  eyeLeft.rotation.y = Math.PI;
  fishGroup.add(eyeLeft);

  // Tail fin: a forked caudal fin on a pivot placed at the tail joint, so
  // rotating the pivot about Y swings the whole fin side-to-side like a
  // swimming fish instead of spinning around the fin's own centroid.
  fishTailPivot = new THREE.Group();
  fishTailPivot.position.set(-BODY_HALF_LEN, 0, 0);
  fishGroup.add(fishTailPivot);

  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0);
  tailShape.lineTo(-0.13, 0.09);
  tailShape.lineTo(-0.07, 0);
  tailShape.lineTo(-0.13, -0.09);
  tailShape.lineTo(0, 0);
  fishTailMesh = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), fishFinMaterial);
  fishTailPivot.add(fishTailMesh);

  clock = new THREE.Clock();
  started = true;

  return { renderer, scene, camera };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tensionColor(tension) {
  // Green (0) -> amber (0.5) -> red (1.0)
  const t = Math.max(0, Math.min(1, tension));
  const green = new THREE.Color(0x3ecf6b);
  const amber = new THREE.Color(0xe8a93b);
  const red = new THREE.Color(0xe43a3a);
  if (t < 0.5) return green.clone().lerp(amber, t / 0.5);
  return amber.clone().lerp(red, (t - 0.5) / 0.5);
}

function updateLine(fromWorld, toWorld) {
  const positions = [fromWorld.clone(), toWorld.clone()];
  lineGeometry.setFromPoints(positions);
  lineGeometry.attributes.position.needsUpdate = true;
}

function getRodTipWorld() {
  const v = new THREE.Vector3();
  rodTipWorld.getWorldPosition(v);
  return v;
}

function applyAim(aimAngleDeg) {
  const clamped = Math.max(-MAX_AIM_ANGLE_DEG, Math.min(MAX_AIM_ANGLE_DEG, aimAngleDeg || 0));
  rodGroup.rotation.y = -THREE.MathUtils.degToRad(clamped);
}

function applyChargeFlex(chargePower) {
  const p = Math.max(0, Math.min(1, chargePower || 0));
  // Subtle pull-back: tilt the rod group backward (around X, toward camera)
  // proportional to charge power.
  rodGroup.rotation.x = p * 0.25;
}

// ---------------------------------------------------------------------------
// Splash / ripple effects
// ---------------------------------------------------------------------------

export function spawnSplash3D(landingPoint) {
  if (!scene) return;
  const group = new THREE.Group();
  const pos = landingPoint || { x: 0, y: 0, z: -10 };
  group.position.set(pos.x, 0.01, pos.z);

  // Expanding ripple ring.
  const rippleGeo = new THREE.RingGeometry(0.05, 0.15, 24);
  const rippleMat = new THREE.MeshBasicMaterial({
    color: 0xeeeeee,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  });
  const ripple = new THREE.Mesh(rippleGeo, rippleMat);
  ripple.rotation.x = -Math.PI / 2;
  group.add(ripple);

  // Small burst of droplet particles.
  const particleCount = 10;
  const particleGeo = new THREE.SphereGeometry(0.02, 6, 6);
  const particleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const particles = [];
  for (let i = 0; i < particleCount; i += 1) {
    const p = new THREE.Mesh(particleGeo, particleMat);
    const angle = (i / particleCount) * Math.PI * 2;
    const speed = 0.6 + Math.random() * 0.6;
    p.userData.velocity = new THREE.Vector3(
      Math.cos(angle) * speed * 0.4,
      1.2 + Math.random() * 0.8,
      Math.sin(angle) * speed * 0.4
    );
    p.position.set(0, 0, 0);
    group.add(p);
    particles.push(p);
  }

  scene.add(group);
  splashEffects.push({ group, ripple, particles, age: 0, lifetime: 1.1 });
}

function updateSplashes(dt) {
  for (let i = splashEffects.length - 1; i >= 0; i -= 1) {
    const fx = splashEffects[i];
    fx.age += dt;
    const t = fx.age / fx.lifetime;
    if (t >= 1) {
      scene.remove(fx.group);
      splashEffects.splice(i, 1);
      continue;
    }
    const scale = 0.3 + t * 3.5;
    fx.ripple.scale.set(scale, scale, scale);
    fx.ripple.material.opacity = Math.max(0, 0.8 * (1 - t));

    for (const p of fx.particles) {
      p.userData.velocity.y -= 9.8 * dt; // gravity
      p.position.addScaledVector(p.userData.velocity, dt);
      if (p.position.y < 0) p.position.y = 0;
      p.material.opacity = Math.max(0, 1 - t);
      p.material.transparent = true;
    }
  }
}

// ---------------------------------------------------------------------------
// renderScene3D
// ---------------------------------------------------------------------------

export function renderScene3D(frameState) {
  if (!started) return;
  const {
    state,
    aimAngleDeg = 0,
    chargePower = 0,
    cast = null,
    castElapsed = 0,
    hookedFish = null,
    tensionState = null,
    time = 0,
  } = frameState || {};

  const dt = clock ? clock.getDelta() : 0.016;

  // Ambient continuous animation: water waves and a subtle idle camera bob.
  if (water) {
    water.material.uniforms['time'].value += dt * 0.8;
  }
  const bobY = Math.sin(time * 1.3) * 0.015;
  const bobX = Math.sin(time * 0.7) * 0.01;
  camera.position.set(EYE_POS.x + bobX, EYE_POS.y + bobY, EYE_POS.z);
  camera.lookAt(bobX, 1.4 + bobY, -10);

  updateSplashes(dt);

  switch (state) {
    case 'charging': {
      fishGroup.visible = false;
      applyAim(aimAngleDeg);
      applyChargeFlex(chargePower);
      const tipWorld = getRodTipWorld();
      const restPoint = tipWorld.clone().add(new THREE.Vector3(0, -0.3, -1));
      updateLine(tipWorld, restPoint);
      lurePivot.position.copy(restPoint);
      lineMaterial.color.set(0xdddddd);
      break;
    }

    case 'cast_flight': {
      fishGroup.visible = false;
      applyAim(0);
      applyChargeFlex(0);
      const tipWorld = getRodTipWorld();
      let luredPos;
      if (cast && typeof cast.trajectoryFn === 'function') {
        luredPos = cast.trajectoryFn(Math.max(0, castElapsed));
      } else {
        luredPos = { x: 0, y: 0, z: -10 };
      }
      const lureVec = new THREE.Vector3(luredPos.x, luredPos.y, luredPos.z);
      updateLine(tipWorld, lureVec);
      lurePivot.position.copy(lureVec);
      lineMaterial.color.set(0xdddddd);
      break;
    }

    case 'waiting_bite': {
      fishGroup.visible = false;
      applyAim(0);
      applyChargeFlex(0);
      const tipWorld = getRodTipWorld();
      const landing = cast && cast.landingPoint ? cast.landingPoint : { x: 0, y: 0, z: -10 };
      const bob = Math.sin(time * 2.2) * 0.02;
      const lurePos = new THREE.Vector3(landing.x, bob, landing.z);
      updateLine(tipWorld, lurePos);
      lurePivot.position.copy(lurePos);
      lineMaterial.color.set(0xdddddd);
      break;
    }

    case 'fighting': {
      applyAim(0);
      applyChargeFlex(0);
      const tipWorld = getRodTipWorld();
      const landing = cast && cast.landingPoint ? cast.landingPoint : { x: 0, y: 0, z: -10 };
      const distanceRemaining = tensionState ? tensionState.distanceRemaining : 1;
      const dr = Math.max(0, Math.min(1, distanceRemaining));

      const fishPos = new THREE.Vector3(
        THREE.MathUtils.lerp(tipWorld.x, landing.x, dr),
        THREE.MathUtils.lerp(0.05, 0.02, dr),
        THREE.MathUtils.lerp(tipWorld.z, landing.z, dr)
      );

      fishGroup.visible = true;
      fishGroup.position.copy(fishPos);

      const stamina = hookedFish && typeof hookedFish.stamina === 'number' ? hookedFish.stamina : 1;
      const thrashFreq = 4 + stamina * 10; // frantic at high stamina, calms as it tires
      const thrashAmp = 0.1 + stamina * 0.35;
      // Overall heading sway: a modest yaw of the whole fish.
      const headingWag = Math.sin(time * thrashFreq) * thrashAmp * 0.4;
      fishGroup.rotation.y = headingWag;
      // Body S-curve: a small counter-phase wiggle of the body itself so it
      // reads as flexing rather than rotating as one rigid block.
      fishBodyMesh.rotation.y = Math.sin(time * thrashFreq + 0.6) * thrashAmp * 0.25;
      // Tail fin sway: the dominant motion, carrying most of the "thrash".
      // Pivoted at the tail joint (not the fin's own centroid) and swinging
      // at a higher frequency/amplitude than the body with a phase lag, so
      // the tail appears to drive a wave down the body like real swimming.
      fishTailPivot.rotation.y = Math.sin(time * thrashFreq * 1.6) * (thrashAmp * 1.4 + 0.25);
      fishGroup.position.y += Math.abs(Math.sin(time * thrashFreq * 0.5)) * 0.03;

      // Scale by species + weight: bigger fish within a species, and bigger
      // species overall (since weight ranges vary a lot across species),
      // read as visibly bigger.
      const weight = hookedFish ? hookedFish.weight || 1 : 1;
      const scale = THREE.MathUtils.clamp(0.6 + Math.log(1 + weight) * 0.35, 0.5, 2.2);
      fishGroup.scale.setScalar(scale);

      // Color from species.color (hex number) if present, falling back to a
      // hash-derived color when it's missing (e.g. roster data mid-update).
      if (hookedFish && hookedFish.species) {
        const species = hookedFish.species;
        let bodyColor;
        if (typeof species.color === 'number') {
          bodyColor = species.color;
        } else {
          const speciesId = species.id || species.name || '';
          let hash = 0;
          for (let i = 0; i < speciesId.length; i += 1) hash = (hash * 31 + speciesId.charCodeAt(i)) >>> 0;
          const hue = (hash % 360) / 360;
          bodyColor = new THREE.Color().setHSL(0.5 + hue * 0.1, 0.4, 0.35 + (hash % 20) / 100).getHex();
        }
        fishBodyMaterial.color.setHex(bodyColor);
        fishFinMaterial.color.copy(fishBodyMaterial.color).multiplyScalar(0.72);
      }

      updateLine(tipWorld, fishPos);
      const tensionVal = tensionState ? tensionState.tension : 0;
      lineMaterial.color.copy(tensionColor(tensionVal));
      lurePivot.position.copy(fishPos);
      break;
    }

    case 'menu':
    case 'result':
    default: {
      fishGroup.visible = false;
      applyAim(0);
      applyChargeFlex(0);
      const tipWorld = getRodTipWorld();
      const restPoint = tipWorld.clone().add(new THREE.Vector3(0, -0.3, -1));
      updateLine(tipWorld, restPoint);
      lurePivot.position.copy(restPoint);
      lineMaterial.color.set(0xdddddd);
      break;
    }
  }

  renderer.render(scene, camera);
}
