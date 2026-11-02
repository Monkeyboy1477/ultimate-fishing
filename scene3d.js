// scene3d.js
// First-person camera, rod and reel, line, lure, hooked fish and water effects.
// The environment (sky, lights, water, terrain, props) lives in world3d.js.
// World convention: meters. +X right, +Y up, -Z out over the water.
// aimAngleDeg: 0 = straight out along -Z, positive = right (+X).

import * as THREE from 'three';
import { buildWorld, setWorldMap, updateWorld } from './world3d.js';
import { EYE_POS, CAMERA_PITCH_DEG, ROD_TIP, HOME_POINT } from './constants.js';
import { createFishModel, createLureModel } from './fishModels.js';

const { clamp, damp, degToRad, lerp, radToDeg } = THREE.MathUtils;

const MAX_ROD_YAW_RAD = degToRad(40);
const MAX_CAMERA_YAW_RAD = degToRad(12);
const CAMERA_PITCH_RAD = degToRad(CAMERA_PITCH_DEG);

// The hand position has to sit inside the lower view frustum or the reel is off screen.
const GRIP_POS = new THREE.Vector3(0.34, 1.46, -0.85);
const ROD_VECTOR = new THREE.Vector3(ROD_TIP.x, ROD_TIP.y, ROD_TIP.z).sub(GRIP_POS);
const ROD_LENGTH = ROD_VECTOR.length();
const BASE_ROD_YAW = Math.atan2(-ROD_VECTOR.x, -ROD_VECTOR.z);
const BASE_ROD_PITCH = Math.asin(ROD_VECTOR.y / ROD_LENGTH);

const BLANK_START = 0.22;
const BLANK_SEGMENTS = 16;
const BLANK_RADIAL = 6;
const BLANK_BASE_RADIUS = 0.011;
const BLANK_TIP_RADIUS = 0.0022;
const GUIDE_RINGS = [3, 6, 9, 12, 14, 16];
const SPOOL_LOCAL = new THREE.Vector3(0, -0.09, -0.05);

const LINE_POINTS = 28;
const RING_POOL_SIZE = 28;
const DROPLET_POOL_SIZE = 260;

const LINE_COLOR = new THREE.Color(0xe8edf0);
const TENSION_GREEN = new THREE.Color(0x3ecf6b);
const TENSION_AMBER = new THREE.Color(0xe8a93b);
const TENSION_RED = new THREE.Color(0xe43a3a);

const TROPHY_DISTANCE = 3.2;
const TROPHY_LIFT = 0.72;
const TROPHY_MIN_LENGTH = 1.25;
const TROPHY_MAX_LENGTH = 3.7;

let renderer = null;
let camera = null;
let scene = null;
let clock = null;
let started = false;
let worldMapId = null;

let cameraYaw = 0;
let previousState = null;

// Rod
let rodPivot = null;
let blankGeometry = null;
let guideMeshes = [];
let guideLine = null;
let crankPivot = null;
let rotorGroup = null;
const rod = {
  yaw: BASE_ROD_YAW,
  pitch: 0,
  pitchVelocity: 0,
  bend: 0.05,
  bendVelocity: 0,
  crankRate: 0,
};
const tipLocal = new THREE.Vector3(0, 0, -ROD_LENGTH);
const tipWorld = new THREE.Vector3();

// Line
let lineGeometry = null;
let lineMaterial = null;
let lineSlack = 0.3;
const linePoints = Array.from({ length: LINE_POINTS + 1 }, () => new THREE.Vector3());

// Lure and wake
let lurePivot = null;
let activeLure = null;
let activeLureKind = null;
let wakeMesh = null;
let wakeOpacity = 0;
let wakeRingTimer = 0;
let hasLastLure = false;
const lastLurePos = new THREE.Vector3();

// Fish
let fishGroup = null;
let fishShadow = null;
let activeFish = null;
let activeFishId = null;
let fishLength = 1;
let fishSwimPhase = 0;
let fishYaw = 0;
let fishSide = 1;
let fishSideTimer = 0;
let fishSplashTimer = 0;
let fishLeapTimer = 0;
let fishLeapAge = -1;
let fishLeapHeight = 0;

// Gear visuals
let graphiteMaterial = null;
let corkMaterial = null;
let metalMaterial = null;
let guideLineMaterial = null;
let gearKey = null;
const baseLineColor = LINE_COLOR.clone();

// Effects
const rings = [];
let nextRing = 0;
let dropletPoints = null;
let nextDroplet = 0;
const dropletVelocity = new Float32Array(DROPLET_POOL_SIZE * 3);
const dropletAge = new Float32Array(DROPLET_POOL_SIZE).fill(1);
const dropletLife = new Float32Array(DROPLET_POOL_SIZE).fill(1);

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();
const lureTarget = new THREE.Vector3();
const fishPos = new THREE.Vector3();
const fishNose = new THREE.Vector3();
const color1 = new THREE.Color();
const zAxis = new THREE.Vector3(0, 0, 1);
const localUp = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function makeCorkTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#b98f5e';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i += 1) {
    ctx.fillStyle = Math.random() < 0.6 ? 'rgba(90,60,30,0.55)' : 'rgba(225,190,145,0.5)';
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 1 + Math.random() * 1.5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

// Cylinder whose axis runs along the rod (local Z).
function rodCylinder(radiusFront, radiusBack, length, material, z) {
  const geometry = new THREE.CylinderGeometry(radiusFront, radiusBack, length, 12);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  return mesh;
}

function buildReel(metal, dark, silver) {
  const reel = new THREE.Group();

  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.05, 0.03), dark);
  foot.position.set(0, -0.035, 0);
  reel.add(foot);

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.031, 14, 10), metal);
  body.scale.set(0.85, 1, 1.25);
  body.position.set(0, -0.09, 0.015);
  reel.add(body);

  rotorGroup = new THREE.Group();
  rotorGroup.position.copy(SPOOL_LOCAL);
  const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.036, 16), silver);
  spool.geometry.rotateX(Math.PI / 2);
  rotorGroup.add(spool);
  const lineWrap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0275, 0.0275, 0.024, 16),
    new THREE.MeshStandardMaterial({ color: 0xdde6ea, roughness: 0.6 })
  );
  lineWrap.geometry.rotateX(Math.PI / 2);
  rotorGroup.add(lineWrap);
  const rotorCup = rodCylinder(0.024, 0.03, 0.03, metal, 0.03);
  rotorGroup.add(rotorCup);
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0018, 6, 18, Math.PI), silver);
  bail.position.z = -0.012;
  rotorGroup.add(bail);
  reel.add(rotorGroup);

  crankPivot = new THREE.Group();
  crankPivot.position.set(-0.03, -0.09, 0.02);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.022, 8), silver);
  axle.rotation.z = Math.PI / 2;
  axle.position.x = -0.009;
  crankPivot.add(axle);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.062, 0.008), silver);
  arm.position.set(-0.02, 0.03, 0);
  crankPivot.add(arm);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.024, 10), dark);
  knob.rotation.z = Math.PI / 2;
  knob.position.set(-0.033, 0.06, 0);
  crankPivot.add(knob);
  reel.add(crankPivot);

  return reel;
}

function buildBlankGeometry() {
  const ringVerts = BLANK_RADIAL + 1;
  const vertexCount = (BLANK_SEGMENTS + 1) * ringVerts;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);

  const indices = [];
  for (let i = 0; i < BLANK_SEGMENTS; i += 1) {
    for (let j = 0; j < BLANK_RADIAL; j += 1) {
      const a = i * ringVerts + j;
      const b = a + 1;
      const c = a + ringVerts;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  geometry.setIndex(indices);
  return geometry;
}

function buildRod() {
  rodPivot = new THREE.Group();
  rodPivot.position.copy(GRIP_POS);
  rodPivot.rotation.order = 'YXZ';
  scene.add(rodPivot);

  const cork = new THREE.MeshStandardMaterial({ map: makeCorkTexture(), roughness: 0.92 });
  corkMaterial = cork;
  const dark = new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.55, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.38, metalness: 0.75 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xb9c2c9, roughness: 0.3, metalness: 0.9 });
  const graphite = new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.34, metalness: 0.25 });
  graphiteMaterial = graphite;
  metalMaterial = metal;

  rodPivot.add(rodCylinder(0.017, 0.019, 0.022, dark, 0.255));
  rodPivot.add(rodCylinder(0.016, 0.018, 0.2, cork, 0.15));
  rodPivot.add(rodCylinder(0.014, 0.014, 0.1, metal, 0));
  rodPivot.add(rodCylinder(0.012, 0.0165, 0.15, cork, -0.125));
  rodPivot.add(rodCylinder(BLANK_BASE_RADIUS, 0.013, 0.02, metal, -0.21));
  rodPivot.add(buildReel(metal, dark, silver));

  blankGeometry = buildBlankGeometry();
  const blank = new THREE.Mesh(blankGeometry, graphite);
  blank.frustumCulled = false;
  rodPivot.add(blank);

  const guideGeometry = new THREE.TorusGeometry(0.009, 0.0012, 6, 14);
  guideMeshes = GUIDE_RINGS.map(() => {
    const guide = new THREE.Mesh(guideGeometry, silver);
    rodPivot.add(guide);
    return guide;
  });

  const guideLinePositions = new Float32Array((GUIDE_RINGS.length + 2) * 3);
  const guideLineGeometry = new THREE.BufferGeometry();
  guideLineGeometry.setAttribute('position', new THREE.BufferAttribute(guideLinePositions, 3));
  guideLineMaterial = new THREE.LineBasicMaterial({ color: LINE_COLOR, transparent: true, opacity: 0.7 });
  guideLine = new THREE.Line(guideLineGeometry, guideLineMaterial);
  guideLine.frustumCulled = false;
  rodPivot.add(guideLine);

  rodPivot.traverse((object) => {
    if (object.isMesh) object.castShadow = true;
  });
}

function buildLine() {
  const vertexCount = (LINE_POINTS + 1) * 2;
  lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  lineGeometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const indices = [];
  for (let i = 0; i < LINE_POINTS; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  lineGeometry.setIndex(indices);

  lineMaterial = new THREE.MeshBasicMaterial({
    color: LINE_COLOR,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const line = new THREE.Mesh(lineGeometry, lineMaterial);
  line.frustumCulled = false;
  scene.add(line);
}

function setLureKind(kind, size = 1) {
  if (kind === activeLureKind) return;
  if (activeLure) lurePivot.remove(activeLure.group);
  activeLure = createLureModel(kind);
  activeLure.group.scale.setScalar(size);
  activeLureKind = kind;
  lurePivot.add(activeLure.group);
}

function buildLure() {
  lurePivot = new THREE.Group();
  setLureKind('bobber');
  scene.add(lurePivot);

  // A V of two fading quads, apex at the lure, arms trailing along local -Z.
  const wakeGeometry = new THREE.BufferGeometry();
  const armLength = 1;
  const armSpread = 0.42;
  const armWidth = 0.09;
  wakeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,
    -armSpread, 0, -armLength,
    -armSpread + armWidth, 0, -armLength,
    0, 0, 0,
    armSpread, 0, -armLength,
    armSpread - armWidth, 0, -armLength,
  ]), 3));
  wakeGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array([
    1, 1, 1, 0.9,
    1, 1, 1, 0,
    1, 1, 1, 0,
    1, 1, 1, 0.9,
    1, 1, 1, 0,
    1, 1, 1, 0,
  ]), 4));
  wakeMesh = new THREE.Mesh(wakeGeometry, new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
  wakeMesh.visible = false;
  scene.add(wakeMesh);
}

function buildFish() {
  fishGroup = new THREE.Group();
  fishGroup.visible = false;
  // Yaw, then pitch nose up or down, then roll around the body's long axis.
  fishGroup.rotation.order = 'YZX';
  scene.add(fishGroup);

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(6,14,18,0.85)');
  gradient.addColorStop(0.6, 'rgba(6,14,18,0.55)');
  gradient.addColorStop(1, 'rgba(6,14,18,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const shadowGeometry = new THREE.PlaneGeometry(1, 1);
  shadowGeometry.rotateX(-Math.PI / 2);
  fishShadow = new THREE.Mesh(shadowGeometry, new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    depthWrite: false,
  }));
  fishShadow.visible = false;
  scene.add(fishShadow);
}

function buildEffects() {
  const ringGeometry = new THREE.RingGeometry(0.84, 1, 40);
  ringGeometry.rotateX(-Math.PI / 2);
  for (let i = 0; i < RING_POOL_SIZE; i += 1) {
    const mesh = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
      color: 0xf2f7f8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, age: 0, delay: 0, life: 0, radius: 1, opacity: 0, active: false });
  }

  const spriteCanvas = document.createElement('canvas');
  spriteCanvas.width = 32;
  spriteCanvas.height = 32;
  const ctx = spriteCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.65)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);

  const positions = new Float32Array(DROPLET_POOL_SIZE * 3).fill(-100);
  const colors = new Float32Array(DROPLET_POOL_SIZE * 4).fill(1);
  for (let i = 0; i < DROPLET_POOL_SIZE; i += 1) colors[i * 4 + 3] = 0;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  geometry.attributes.color.setUsage(THREE.DynamicDrawUsage);
  dropletPoints = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 0.11,
    map: new THREE.CanvasTexture(spriteCanvas),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
  }));
  dropletPoints.frustumCulled = false;
  scene.add(dropletPoints);
}

const BASE_FOV_DEG = 58;
const BASE_ASPECT = 3 / 2;

export function initScene(canvas) {
  // setSize below rewrites canvas.width and canvas.height when the pixel ratio isn't 1.
  const width = canvas.width;
  const height = canvas.height;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  camera = new THREE.PerspectiveCamera(BASE_FOV_DEG, width / height, 0.1, 1500);
  camera.rotation.order = 'YXZ';
  camera.position.set(EYE_POS.x, EYE_POS.y, EYE_POS.z);
  camera.rotation.x = CAMERA_PITCH_RAD;

  scene = new THREE.Scene();
  buildWorld(scene, renderer);
  buildRod();
  buildLine();
  buildLure();
  buildFish();
  buildEffects();

  clock = new THREE.Clock();
  started = true;
  return { renderer, scene, camera };
}

// Matches the view for screens narrower than the desktop's 3:2, so the rod stays in frame.
export function resizeScene(width, height) {
  if (!renderer) return;
  const aspect = width / height;
  // A full-screen game on a big monitor has a lot of pixels; cap them so it stays smooth.
  const maxPixels = 2_400_000;
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(maxPixels / (width * height)));
  renderer.setPixelRatio(Math.max(ratio, 0.5));
  renderer.setSize(width, height, false);
  camera.aspect = aspect;
  camera.fov = aspect >= BASE_ASPECT
    ? BASE_FOV_DEG
    : radToDeg(2 * Math.atan(Math.tan(degToRad(BASE_FOV_DEG / 2)) * (BASE_ASPECT / aspect)));
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// Fish Book pictures
// ---------------------------------------------------------------------------

const THUMBNAIL_WIDTH = 240;
const THUMBNAIL_HEIGHT = 120;
const THUMBNAIL_MARGIN = 1.08;
const thumbnailCache = new Map();
let thumbnailRig = null;

function getThumbnailRig() {
  if (thumbnailRig) return thumbnailRig;
  const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  thumbRenderer.setSize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, false);
  thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;

  const thumbScene = new THREE.Scene();
  thumbScene.add(new THREE.HemisphereLight(0xffffff, 0x6f7f88, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(1, 2, 3);
  thumbScene.add(sun);

  const thumbCamera = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.01, 100);
  thumbnailRig = { renderer: thumbRenderer, scene: thumbScene, camera: thumbCamera, box: new THREE.Box3() };
  return thumbnailRig;
}

// A side-on picture of a species as an image URL, drawn once and then cached.
export function fishThumbnail(species) {
  if (thumbnailCache.has(species.id)) return thumbnailCache.get(species.id);

  const rig = getThumbnailRig();
  const model = createFishModel(species.id, speciesColorHex(species));
  const previousParent = model.group.parent;
  rig.scene.add(model.group);
  model.setSwim(0, 0);

  rig.box.setFromObject(model.group);
  const center = rig.box.getCenter(v1);
  const size = rig.box.getSize(v2);
  const halfWidth = Math.max(size.x, size.y * (THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT)) * 0.5 * THUMBNAIL_MARGIN;
  rig.camera.left = -halfWidth;
  rig.camera.right = halfWidth;
  rig.camera.top = halfWidth * (THUMBNAIL_HEIGHT / THUMBNAIL_WIDTH);
  rig.camera.bottom = -rig.camera.top;
  rig.camera.position.set(center.x, center.y, center.z + size.z + 10);
  rig.camera.lookAt(center);
  rig.camera.updateProjectionMatrix();

  rig.renderer.render(rig.scene, rig.camera);
  const url = rig.renderer.domElement.toDataURL('image/png');

  rig.scene.remove(model.group);
  if (previousParent) previousParent.add(model.group);
  thumbnailCache.set(species.id, url);
  return url;
}

// ---------------------------------------------------------------------------
// Rod
// ---------------------------------------------------------------------------

function yawToward(x, z) {
  const yaw = Math.atan2(-(x - GRIP_POS.x), -(z - GRIP_POS.z));
  return clamp(yaw, BASE_ROD_YAW - MAX_ROD_YAW_RAD, BASE_ROD_YAW + MAX_ROD_YAW_RAD);
}

function rebuildBlank(bendDown, bendSide) {
  const positions = blankGeometry.attributes.position.array;
  const normals = blankGeometry.attributes.normal.array;
  const stepLength = (ROD_LENGTH - BLANK_START) / BLANK_SEGMENTS;
  const center = v1.set(0, 0, -BLANK_START);
  const tangent = v2;
  const right = v3;
  const up = v4;
  let write = 0;
  let guideIndex = 0;
  const guidePositions = guideLine.geometry.attributes.position.array;
  guidePositions[0] = SPOOL_LOCAL.x;
  guidePositions[1] = SPOOL_LOCAL.y;
  guidePositions[2] = SPOOL_LOCAL.z;

  for (let i = 0; i <= BLANK_SEGMENTS; i += 1) {
    const s = i / BLANK_SEGMENTS;
    const curve = Math.pow(s, 1.5);
    const down = bendDown * curve;
    const side = bendSide * curve;
    tangent.set(Math.sin(side), -Math.sin(down), -Math.cos(down) * Math.cos(side)).normalize();
    if (i > 0) center.addScaledVector(tangent, stepLength);

    right.crossVectors(tangent, localUp).normalize();
    up.crossVectors(right, tangent).normalize();
    const radius = lerp(BLANK_BASE_RADIUS, BLANK_TIP_RADIUS, s);

    for (let j = 0; j <= BLANK_RADIAL; j += 1) {
      const angle = (j / BLANK_RADIAL) * Math.PI * 2;
      const c = Math.cos(angle);
      const n = Math.sin(angle);
      const nx = right.x * c + up.x * n;
      const ny = right.y * c + up.y * n;
      const nz = right.z * c + up.z * n;
      positions[write] = center.x + nx * radius;
      positions[write + 1] = center.y + ny * radius;
      positions[write + 2] = center.z + nz * radius;
      normals[write] = nx;
      normals[write + 1] = ny;
      normals[write + 2] = nz;
      write += 3;
    }

    if (guideIndex < GUIDE_RINGS.length && GUIDE_RINGS[guideIndex] === i) {
      const guide = guideMeshes[guideIndex];
      const guideScale = lerp(1.25, 0.45, s);
      const drop = radius + 0.0095 * guideScale;
      guide.position.copy(center).addScaledVector(up, -drop);
      guide.quaternion.setFromUnitVectors(zAxis, tangent);
      guide.scale.setScalar(guideScale);
      const slot = (guideIndex + 1) * 3;
      guidePositions[slot] = guide.position.x;
      guidePositions[slot + 1] = guide.position.y;
      guidePositions[slot + 2] = guide.position.z;
      guideIndex += 1;
    }
  }

  tipLocal.copy(center);
  const lastSlot = (GUIDE_RINGS.length + 1) * 3;
  guidePositions[lastSlot] = center.x;
  guidePositions[lastSlot + 1] = center.y;
  guidePositions[lastSlot + 2] = center.z;
  guideLine.geometry.attributes.position.needsUpdate = true;
  blankGeometry.attributes.position.needsUpdate = true;
  blankGeometry.attributes.normal.needsUpdate = true;
}

function updateRod(dt, time, targetYaw, targetPitch, targetBend, shake, crankTarget) {
  rod.yaw = damp(rod.yaw, targetYaw, 7, dt);

  rod.pitchVelocity += (90 * (targetPitch - rod.pitch) - 13 * rod.pitchVelocity) * dt;
  rod.pitch += rod.pitchVelocity * dt;
  rod.bendVelocity += (90 * (targetBend - rod.bend) - 5 * rod.bendVelocity) * dt;
  rod.bend = clamp(rod.bend + rod.bendVelocity * dt, -1.2, 1.35);

  const shakePitch = Math.sin(time * 27) * shake * 0.016;
  const shakeYaw = Math.sin(time * 33 + 1.3) * shake * 0.018;
  rodPivot.rotation.set(BASE_ROD_PITCH + rod.pitch + shakePitch, rod.yaw + shakeYaw, 0);

  rebuildBlank(rod.bend + Math.sin(time * 19) * shake * 0.05, Math.sin(time * 23) * shake * 0.09);

  rod.crankRate = damp(rod.crankRate, crankTarget, 10, dt);
  crankPivot.rotation.x -= rod.crankRate * dt;
  rotorGroup.rotation.z += rod.crankRate * 2.5 * dt;

  rodPivot.updateWorldMatrix(true, false);
  tipWorld.copy(tipLocal);
  rodPivot.localToWorld(tipWorld);
}

// ---------------------------------------------------------------------------
// Line
// ---------------------------------------------------------------------------

function setLineColor(tension) {
  const t = clamp(tension, 0, 1);
  if (t < 0.5) color1.copy(TENSION_GREEN).lerp(TENSION_AMBER, t / 0.5);
  else color1.copy(TENSION_AMBER).lerp(TENSION_RED, (t - 0.5) / 0.5);
  lineMaterial.color.copy(baseLineColor).lerp(color1, 0.2 + t * 0.35);
}

function updateLine(end, targetSlack, dt) {
  lineSlack = damp(lineSlack, targetSlack, 6, dt);
  const span = tipWorld.distanceTo(end);
  const sag = lineSlack * Math.min(span * 0.12, 3);

  for (let i = 0; i <= LINE_POINTS; i += 1) {
    const u = i / LINE_POINTS;
    const point = linePoints[i].lerpVectors(tipWorld, end, u);
    point.y -= sag * 4 * u * (1 - u);
    // Slack line rests on the surface instead of passing through it.
    point.y = Math.max(point.y, Math.min(end.y, 0.015));
  }

  // Camera-facing ribbon, because WebGL line width is fixed at 1px and vanishes at range.
  const positions = lineGeometry.attributes.position.array;
  for (let i = 0; i <= LINE_POINTS; i += 1) {
    const point = linePoints[i];
    v1.subVectors(linePoints[Math.min(i + 1, LINE_POINTS)], linePoints[Math.max(i - 1, 0)]);
    v2.subVectors(camera.position, point);
    const distance = v2.length();
    v3.crossVectors(v1, v2);
    if (v3.lengthSq() < 1e-10) v3.set(1, 0, 0);
    v3.normalize().multiplyScalar(Math.max(0.0012, distance * 0.0011));
    const write = i * 6;
    positions[write] = point.x - v3.x;
    positions[write + 1] = point.y - v3.y;
    positions[write + 2] = point.z - v3.z;
    positions[write + 3] = point.x + v3.x;
    positions[write + 4] = point.y + v3.y;
    positions[write + 5] = point.z + v3.z;
  }
  lineGeometry.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function spawnRing(x, z, delay, life, radius, opacity) {
  const ring = rings[nextRing];
  nextRing = (nextRing + 1) % RING_POOL_SIZE;
  ring.age = -delay;
  ring.life = life;
  ring.radius = radius;
  ring.opacity = opacity;
  ring.active = true;
  ring.mesh.position.set(x, 0.025, z);
  ring.mesh.scale.setScalar(0.001);
  ring.mesh.material.opacity = 0;
  ring.mesh.visible = false;
}

function spawnDroplets(x, y, z, count, speed) {
  const positions = dropletPoints.geometry.attributes.position.array;
  for (let i = 0; i < count; i += 1) {
    const index = nextDroplet;
    nextDroplet = (nextDroplet + 1) % DROPLET_POOL_SIZE;
    const angle = Math.random() * Math.PI * 2;
    const outward = (0.25 + Math.random() * 0.75) * speed * 0.55;
    positions[index * 3] = x;
    positions[index * 3 + 1] = y + 0.02;
    positions[index * 3 + 2] = z;
    dropletVelocity[index * 3] = Math.cos(angle) * outward;
    dropletVelocity[index * 3 + 1] = (0.55 + Math.random() * 0.75) * speed;
    dropletVelocity[index * 3 + 2] = Math.sin(angle) * outward;
    dropletAge[index] = 0;
    dropletLife[index] = 0.55 + Math.random() * 0.45;
  }
}

function splashAt(x, y, z, strength) {
  spawnDroplets(x, y, z, Math.round(10 + 22 * strength), 1.6 + 1.5 * strength);
  spawnRing(x, z, 0, 1.2, 0.9 + 1.2 * strength, 0.75);
  spawnRing(x, z, 0.14, 1.3, 0.7 + 1.1 * strength, 0.5);
  if (strength > 0.5) spawnRing(x, z, 0.3, 1.4, 0.6 + 1.0 * strength, 0.32);
}

export function spawnSplash3D(landingPoint) {
  if (!started) return;
  const point = landingPoint || { x: 0, z: -10 };
  splashAt(point.x, 0, point.z, 1);
}

function updateEffects(dt) {
  for (const ring of rings) {
    if (!ring.active) continue;
    ring.age += dt;
    if (ring.age < 0) continue;
    const t = ring.age / ring.life;
    if (t >= 1) {
      ring.active = false;
      ring.mesh.visible = false;
      continue;
    }
    ring.mesh.visible = true;
    ring.mesh.scale.setScalar(0.05 + ring.radius * (1 - (1 - t) * (1 - t)));
    ring.mesh.material.opacity = ring.opacity * (1 - t);
  }

  const positions = dropletPoints.geometry.attributes.position.array;
  const colors = dropletPoints.geometry.attributes.color.array;
  for (let i = 0; i < DROPLET_POOL_SIZE; i += 1) {
    if (colors[i * 4 + 3] === 0 && dropletAge[i] >= dropletLife[i]) continue;
    dropletAge[i] += dt;
    dropletVelocity[i * 3 + 1] -= 9.8 * dt;
    positions[i * 3] += dropletVelocity[i * 3] * dt;
    positions[i * 3 + 1] += dropletVelocity[i * 3 + 1] * dt;
    positions[i * 3 + 2] += dropletVelocity[i * 3 + 2] * dt;
    const alive = dropletAge[i] < dropletLife[i] && positions[i * 3 + 1] > 0;
    if (alive) {
      colors[i * 4 + 3] = 1 - dropletAge[i] / dropletLife[i];
    } else {
      colors[i * 4 + 3] = 0;
      dropletAge[i] = dropletLife[i];
      positions[i * 3 + 1] = -100;
    }
  }
  dropletPoints.geometry.attributes.position.needsUpdate = true;
  dropletPoints.geometry.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Lure
// ---------------------------------------------------------------------------

function placeLure(position, leanX, leanZ, inWater = false) {
  const distance = camera.position.distanceTo(position);
  lurePivot.visible = true;
  lurePivot.position.copy(position);
  // Everything but the bobber lies on its side once it's in the water.
  const flatten = inWater && activeLure.flat ? Math.PI / 2 : 0;
  lurePivot.rotation.set(leanX + flatten, 0, leanZ);
  // Exaggerated with range so the bobber stays readable far from the dock.
  lurePivot.scale.setScalar(1 + distance * 0.06);
}

function updateWake(dt, position) {
  let speed = 0;
  let dirX = 0;
  let dirZ = 1;
  if (hasLastLure && dt > 0) {
    const dx = position.x - lastLurePos.x;
    const dz = position.z - lastLurePos.z;
    const moved = Math.sqrt(dx * dx + dz * dz);
    speed = moved / dt;
    if (moved > 1e-5) {
      dirX = dx / moved;
      dirZ = dz / moved;
    }
  }
  lastLurePos.copy(position);
  hasLastLure = true;

  const moving = speed > 0.25;
  wakeOpacity = damp(wakeOpacity, moving ? clamp(speed / 8, 0.25, 0.8) : 0, 8, dt);
  wakeMesh.visible = wakeOpacity > 0.01;
  if (wakeMesh.visible) {
    wakeMesh.material.opacity = wakeOpacity;
    wakeMesh.position.set(position.x, 0.03, position.z);
    if (moving) wakeMesh.rotation.y = Math.atan2(dirX, dirZ);
    const size = clamp(0.8 + speed * 0.28, 0.8, 4);
    wakeMesh.scale.set(size * 0.8, 1, size);
  }

  if (moving) {
    wakeRingTimer -= dt;
    if (wakeRingTimer <= 0) {
      spawnRing(position.x, position.z, 0, 0.9, 0.55, 0.32);
      wakeRingTimer = 0.2;
    }
  } else {
    wakeRingTimer = 0;
  }
  return { speed, dirX, dirZ };
}

function clearWake() {
  hasLastLure = false;
  wakeOpacity = 0;
  wakeMesh.visible = false;
}

// ---------------------------------------------------------------------------
// Fish
// ---------------------------------------------------------------------------

function speciesColorHex(species) {
  if (typeof species.color === 'number') return species.color;
  const id = species.id || species.name || '';
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return new THREE.Color().setHSL(0.5 + ((hash % 360) / 360) * 0.1, 0.4, 0.35 + (hash % 20) / 100).getHex();
}

function selectFish(species) {
  const id = species ? species.id || species.name || 'generic' : 'generic';
  const hex = species ? speciesColorHex(species) : 0x4d7a8c;
  const key = `${id}:${hex}`;
  if (key === activeFishId) return;
  if (activeFish) fishGroup.remove(activeFish.group);
  activeFish = createFishModel(id, hex);
  activeFishId = key;
  fishGroup.add(activeFish.group);
}

// Real length, exaggerated with range so a far-off fish still reads on screen.
function displayLength(realLength, distance) {
  return Math.max(realLength * (1 + distance * 0.02), distance * 0.03);
}

// Returns the fish's stamina and sets fishPos; used for the rod target before the rod updates.
function computeFishPosition(cast, frameState, tensionState, hookedFish, time) {
  const origin = frameState.fightOrigin || (cast && cast.landingPoint) || { x: 0, z: -10 };
  const remaining = clamp(tensionState ? tensionState.distanceRemaining : 1, 0, 1);
  const stamina = hookedFish && typeof hookedFish.stamina === 'number' ? hookedFish.stamina : 1;
  selectFish(hookedFish && hookedFish.species);
  const realLength = activeFish.lengthFor(hookedFish ? hookedFish.weight : 0);
  const wander = Math.sin(time * 1.1) * 1.5 * remaining * stamina;
  // Long fish hold further off the dock so they don't swim through it.
  fishPos.set(
    lerp(HOME_POINT.x, origin.x, remaining) + wander,
    0,
    lerp(HOME_POINT.z - realLength * 0.32, origin.z, remaining)
  );
  fishLength = displayLength(realLength, camera.position.distanceTo(fishPos));
  return stamina;
}

function updateFishWake(dirX, dirZ, opacity) {
  wakeMesh.visible = opacity > 0.01;
  if (!wakeMesh.visible) return;
  wakeMesh.material.opacity = opacity;
  wakeMesh.position.set(
    fishPos.x + dirX * fishLength * 0.42,
    0.03,
    fishPos.z + dirZ * fishLength * 0.42
  );
  wakeMesh.rotation.y = Math.atan2(dirX, dirZ);
  const size = Math.max(1, fishLength * 1.3);
  wakeMesh.scale.set(size * 0.7, 1, size);
}

function updateFish(dt, time, stamina, tension, remaining) {
  fishGroup.visible = true;
  const model = activeFish;
  const topHeight = model.top * fishLength;
  const bottomHeight = model.bottom * fishLength;

  // Sharks show just a fin; other fish roll their backs through the surface.
  const cruiseY = model.surfaceMode === 'fin' ? -topHeight * 1.03 : -topHeight * 0.42;
  const nearDock = 1 - THREE.MathUtils.smoothstep(remaining, 0.03, 0.26);
  let y = lerp(cruiseY, bottomHeight * 0.3, nearDock);

  fishLeapTimer -= dt;
  if (model.leaps && fishLeapAge < 0 && fishLeapTimer <= 0 && stamina > 0.12 && nearDock < 0.8) {
    fishLeapAge = 0;
    fishLeapHeight = Math.max(0.7, fishLength * 0.72) * (0.65 + stamina * 0.35);
    splashAt(fishPos.x, 0, fishPos.z, clamp(fishLength * 0.4, 0.5, 1.6));
  }
  let pitch = 0;
  let roll = 0;
  let leaping = false;
  if (fishLeapAge >= 0) {
    fishLeapAge += dt;
    const t = fishLeapAge / (0.8 + fishLength * 0.08);
    if (t >= 1) {
      fishLeapAge = -1;
      fishLeapTimer = 3.5 + Math.random() * 3.5;
      splashAt(fishPos.x, 0, fishPos.z, clamp(fishLength * 0.5, 0.7, 1.9));
    } else {
      leaping = true;
      y += Math.sin(t * Math.PI) * (fishLeapHeight + topHeight);
      pitch = lerp(0.95, -0.95, t);
      roll = Math.sin(t * Math.PI * 2) * 0.35;
    }
  }

  // Swim side-on to the angler so the silhouette reads, not end-on.
  fishSideTimer -= dt;
  if (fishSideTimer <= 0) {
    fishSide = -fishSide;
    fishSideTimer = 2.5 + Math.random() * 2.5;
  }
  const toAngler = Math.atan2(-(GRIP_POS.z - fishPos.z), GRIP_POS.x - fishPos.x);
  fishYaw = damp(fishYaw, toAngler + fishSide * 1.15, 2.2, dt);

  const thrashFreq = (4 + stamina * 9) / (1 + fishLength * 0.22);
  const thrashAmp = 0.05 + stamina * 0.16;
  const yaw = fishYaw + Math.sin(time * thrashFreq) * thrashAmp * 0.5;
  fishSwimPhase += dt * thrashFreq * 2.2;
  model.setSwim(leaping ? 0.09 : 0.025 + stamina * 0.055, fishSwimPhase);

  // Near the dock, turn the flank up toward the raised camera.
  const zSide = Math.sign(Math.sin(yaw) * (camera.position.x - fishPos.x) + Math.cos(yaw) * (camera.position.z - fishPos.z)) || 1;
  roll += zSide * nearDock * 0.42;

  fishGroup.position.set(fishPos.x, y, fishPos.z);
  fishGroup.rotation.set(roll, yaw, pitch);
  fishGroup.scale.setScalar(fishLength);

  const dirX = Math.cos(yaw);
  const dirZ = -Math.sin(yaw);
  const underwater = !leaping && y < bottomHeight * 0.2;
  fishShadow.visible = underwater;
  if (underwater) {
    fishShadow.position.set(fishPos.x, 0.022, fishPos.z);
    fishShadow.rotation.y = yaw;
    fishShadow.scale.set(fishLength * 1.1, 1, Math.max(0.35, fishLength * (model.top + model.bottom) * 1.6));
    fishShadow.material.opacity = lerp(0.85, 0.4, nearDock);
  }
  updateFishWake(dirX, dirZ, leaping ? 0 : 0.62 * (1 - nearDock * 0.6));

  fishSplashTimer -= dt;
  if (fishSplashTimer <= 0 && !leaping) {
    const violence = clamp(stamina * 0.6 + tension * 0.5, 0.15, 1);
    const reach = Math.max(1, fishLength);
    spawnDroplets(fishPos.x - dirX * fishLength * 0.35, 0, fishPos.z - dirZ * fishLength * 0.35, Math.round(3 + 9 * violence), (1 + 1.4 * violence) * Math.sqrt(reach));
    spawnRing(fishPos.x, fishPos.z, 0, 0.9, (0.45 + violence * 0.8) * reach, 0.25 + violence * 0.35);
    fishSplashTimer = lerp(0.65, 0.14, violence);
  }

  fishGroup.updateMatrixWorld(true);
  fishNose.copy(model.mouth);
  fishGroup.localToWorld(fishNose);
}

function updateTrophy(dt, time, hookedFish) {
  selectFish(hookedFish.species);
  const model = activeFish;
  const realLength = model.lengthFor(hookedFish.weight);
  const span = Math.log(clamp(realLength, 0.2, 5) / 0.2) / Math.log(25);
  fishLength = lerp(TROPHY_MIN_LENGTH, TROPHY_MAX_LENGTH, span);

  fishShadow.visible = false;
  wakeMesh.visible = false;
  fishGroup.visible = true;

  // Held up in the top of the frame, above the compact result panel.
  v1.set(0, TROPHY_LIFT, -TROPHY_DISTANCE);
  camera.localToWorld(v1);
  v1.x += Math.sin(time * 0.8) * 0.05;
  v1.y += Math.sin(time * 1.1) * 0.035;
  fishGroup.position.copy(v1);
  fishGroup.rotation.set(0.05, camera.rotation.y + Math.sin(time * 0.75) * 0.22, 0.13 + Math.sin(time * 1.1) * 0.035);
  fishGroup.scale.setScalar(fishLength);

  fishSwimPhase += dt * 5;
  model.setSwim(0.018 + Math.max(0, Math.sin(time * 0.9)) * 0.03, fishSwimPhase);

  fishGroup.updateMatrixWorld(true);
  fishNose.copy(model.mouth);
  fishGroup.localToWorld(fishNose);
}

function applyGear(gear) {
  setLureKind(gear && gear.lure && gear.lure.kind ? gear.lure.kind : 'bobber', gear?.lure?.size);
  const rodGear = gear && gear.rod;
  const lineHex = gear && gear.line ? gear.line.color : undefined;
  const key = `${rodGear ? rodGear.blankColor : ''}|${rodGear ? rodGear.gripColor : ''}|${rodGear ? rodGear.accentColor : ''}|${lineHex}`;
  if (key === gearKey) return;
  gearKey = key;
  graphiteMaterial.color.set(rodGear && rodGear.blankColor !== undefined ? rodGear.blankColor : 0x20262e);
  metalMaterial.color.set(rodGear && rodGear.accentColor !== undefined ? rodGear.accentColor : 0x3a4148);
  // The cork texture darkens whatever it multiplies, so brighten the tint to compensate.
  if (rodGear && rodGear.gripColor !== undefined) corkMaterial.color.set(rodGear.gripColor).multiplyScalar(1.7);
  else corkMaterial.color.set(0xffffff);
  baseLineColor.set(lineHex !== undefined ? lineHex : LINE_COLOR);
  guideLineMaterial.color.copy(baseLineColor);
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

function updateCamera(dt, time, targetYaw, shake) {
  cameraYaw = damp(cameraYaw, clamp(targetYaw, -MAX_CAMERA_YAW_RAD, MAX_CAMERA_YAW_RAD), 3.5, dt);
  const bobY = Math.sin(time * 1.3) * 0.015;
  const bobX = Math.sin(time * 0.7) * 0.01;
  camera.position.set(EYE_POS.x + bobX, EYE_POS.y + bobY, EYE_POS.z);
  camera.rotation.x = CAMERA_PITCH_RAD + Math.sin(time * 1.3 + 0.4) * 0.0025 + Math.sin(time * 29) * shake * 0.0018;
  camera.rotation.y = cameraYaw + Math.sin(time * 31) * shake * 0.002;
  camera.updateMatrixWorld();
}

// Dev preview: #fish=<id> shows a species in the catch view, #fish=<id>&mode=fight in the water.
function previewFrame(frame) {
  const match = /^#fish=([a-z_]+)(?:&w=([\d.]+))?(?:&mode=(fight))?/.exec(location.hash);
  if (!match) return frame;
  const hookedFish = { species: { id: match[1] }, weight: match[2] ? parseFloat(match[2]) : 0, stamina: 0.7 };
  if (match[3]) {
    return {
      ...frame,
      state: 'fighting',
      hookedFish,
      tensionState: { tension: 0.4, distanceRemaining: 0.5 + Math.sin((frame.time || 0) * 0.2) * 0.5 },
      fightOrigin: { x: 4, z: -22 },
    };
  }
  return { ...frame, state: 'result', hookedFish, lastResult: { caught: true } };
}

export function renderScene3D(frameState) {
  if (!started) return;
  const frame = previewFrame(frameState || {});
  const {
    state,
    aimAngleDeg = 0,
    chargePower = 0,
    cast = null,
    castElapsed = 0,
    hookedFish = null,
    tensionState = null,
    reeling = false,
    time = 0,
  } = frame;

  const mapId = frame.mapId || 'pond';
  if (mapId !== worldMapId) {
    worldMapId = mapId;
    setWorldMap(mapId);
  }
  const dt = Math.min(clock ? clock.getDelta() : 0.016, 0.05);
  updateWorld(dt, time);
  applyGear(frame.gear);
  const trophy = state === 'result' && frame.lastResult && frame.lastResult.caught && hookedFish;

  const entering = state !== previousState;
  if (entering && state === 'cast_flight' && previousState === 'charging') {
    const power = cast ? cast.power || 0 : 0;
    rod.bendVelocity -= 3 + 5 * power;
    rod.pitchVelocity -= 2.5 + 3 * power;
  }

  const tension = tensionState ? clamp(tensionState.tension / (tensionState.breakThreshold ?? 1), 0, 1) : 0;
  const landing = cast && cast.landingPoint ? cast.landingPoint : { x: 0, y: 0, z: -10 };

  let rodYaw = BASE_ROD_YAW;
  let rodPitch = 0;
  let rodBend = 0.05;
  let shake = 0;
  let crank = 0;
  let cameraTarget = 0;
  let fishStamina = 1;

  switch (state) {
    case 'charging': {
      const aimRad = degToRad(clamp(aimAngleDeg, -40, 40));
      rodYaw = BASE_ROD_YAW - aimRad;
      rodPitch = 0.55 * clamp(chargePower, 0, 1);
      rodBend = -0.16 * clamp(chargePower, 0, 1);
      cameraTarget = -aimRad * 0.35;
      break;
    }
    case 'cast_flight': {
      rodYaw = yawToward(landing.x, landing.z);
      rodPitch = -0.12;
      cameraTarget = rodYaw * 0.5;
      break;
    }
    case 'waiting_bite': {
      const lure = frame.lurePos || landing;
      rodYaw = yawToward(lure.x, lure.z);
      rodPitch = reeling ? -0.04 : 0;
      rodBend = reeling ? 0.1 : 0.05;
      crank = reeling ? 16 : 0;
      shake = reeling ? 0.06 : 0;
      cameraTarget = rodYaw * 0.5;
      break;
    }
    case 'fighting': {
      fishStamina = computeFishPosition(cast, frame, tensionState, hookedFish, time);
      rodYaw = yawToward(fishPos.x, fishPos.z);
      rodPitch = 0.22 - 0.2 * tension;
      rodBend = 0.1 + 0.5 * tension;
      shake = 0.2 + tension * 0.8;
      crank = reeling ? lerp(11, 4, tension) : 0;
      cameraTarget = rodYaw * 0.5;
      break;
    }
    case 'result': {
      if (trophy) {
        rodPitch = 0.34;
        rodBend = 0.32;
      }
      break;
    }
    default:
      break;
  }

  updateCamera(dt, time, cameraTarget, state === 'fighting' ? tension : 0);
  updateRod(dt, time, rodYaw, rodPitch, rodBend, shake, crank);
  if (activeLure.spin && reeling) activeLure.spin.rotation.y += dt * 40;

  switch (state) {
    case 'cast_flight': {
      fishGroup.visible = false;
      fishShadow.visible = false;
      clearWake();
      const point = cast && typeof cast.trajectoryFn === 'function'
        ? cast.trajectoryFn(Math.max(0, castElapsed))
        : landing;
      lureTarget.set(point.x, point.y, point.z);
      placeLure(lureTarget, 0, castElapsed * 9);
      setLineColor(0);
      updateLine(lureTarget, 0.22, dt);
      break;
    }

    case 'waiting_bite': {
      fishGroup.visible = false;
      fishShadow.visible = false;
      const lure = frame.lurePos || landing;
      const bob = reeling ? 0.025 : 0.02 + Math.sin(time * 2.2) * 0.018;
      lureTarget.set(lure.x, bob, lure.z);
      const wake = updateWake(dt, lureTarget);
      const lean = clamp(wake.speed * 0.09, 0, 0.55);
      placeLure(lureTarget, wake.dirZ * lean, -wake.dirX * lean, true);
      setLineColor(0);
      updateLine(lureTarget, reeling ? 0.18 : 0.75, dt);
      break;
    }

    case 'fighting': {
      lurePivot.visible = false;
      hasLastLure = false;
      if (entering) {
        fishLeapAge = -1;
        fishLeapTimer = 0.8 + Math.random() * 1.5;
        fishSplashTimer = 0;
        fishSideTimer = 0;
        fishYaw = Math.atan2(-(GRIP_POS.z - fishPos.z), GRIP_POS.x - fishPos.x) + fishSide * 1.15;
        splashAt(fishPos.x, 0, fishPos.z, 0.9);
      }
      updateFish(dt, time, fishStamina, tension, clamp(tensionState ? tensionState.distanceRemaining : 1, 0, 1));
      setLineColor(tension);
      updateLine(fishNose, Math.pow(1 - tension, 2) * 0.22, dt);
      break;
    }

    case 'charging':
    case 'menu':
    case 'result':
    default: {
      if (trophy) {
        hasLastLure = false;
        lurePivot.visible = false;
        if (entering) splashAt(HOME_POINT.x, 0, HOME_POINT.z - 0.5, 1.2);
        updateTrophy(dt, time, hookedFish);
        setLineColor(0.1);
        updateLine(fishNose, 0, dt);
        break;
      }
      fishGroup.visible = false;
      fishShadow.visible = false;
      clearWake();
      lureTarget.set(
        tipWorld.x + Math.sin(time * 1.4) * 0.012,
        tipWorld.y - 0.42,
        tipWorld.z + Math.cos(time * 1.1) * 0.012
      );
      placeLure(lureTarget, 0, 0);
      setLineColor(0);
      updateLine(lureTarget, 0, dt);
      break;
    }
  }

  updateEffects(dt);
  previousState = state;
  renderer.render(scene, camera);
}
