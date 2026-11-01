// world3d.js
// Procedural golden-hour lake: sky, water, terrain, trees, reeds, dock and gear props.
// World convention: meters; +X right, +Y up, -Z out over the water. Water surface at y = 0.

import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DECK_Y, DOCK_END_Z, DOCK_HALF_WIDTH } from './constants.js';

const SUN_ELEVATION_DEG = 11;
const SUN_AZIMUTH_DEG = 24;
const FOG_DENSITY = 0.0027;
const TONE_EXPOSURE = 0.6;
const TREE_COUNT = 1100;
const REED_COUNT = 1400;

const windTime = { value: 0 };
let water = null;

// ---- Seeded noise, so the lake layout is the same on every load ------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x, z, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x, z) * amp;
    norm += amp;
    amp *= 0.5;
    x = x * 2.03 + 11.7;
    z = z * 2.03 - 5.3;
  }
  return sum / norm;
}

function smooth(lo, hi, v) {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

// ---- Lake shape --------------------------------------------------------------
// The near banks follow a 0.88 slope, just outside casting3d.js's 40-degree aim cone
// (tan 40 = 0.84) and its 45m lateral clamp, so no legal cast can land on dry ground.
const SHORE_BEHIND_Z = 1.5;
const LAKE_FAR_D = 285;

function lakeHalfWidth(d, side) {
  if (d <= -SHORE_BEHIND_Z) return 0;
  const cone = 0.88 * (d + SHORE_BEHIND_Z);
  let body = 52 + 55 * smooth(90, 180, d);
  if (d > 215) {
    const k = Math.min(1, (d - 215) / (LAKE_FAR_D - 215));
    body = 107 * Math.sqrt(Math.max(0, 1 - k * k));
  }
  const wobble = valueNoise(d * 0.035, side * 7.3) * 7 * smooth(15, 60, d);
  return Math.min(cone, body + wobble);
}

function shoreDistance(x, z) {
  const d = -z;
  const side = x >= 0 ? 1 : -1;
  return Math.max(Math.abs(x) - lakeHalfWidth(d, side), z - SHORE_BEHIND_Z, d - LAKE_FAR_D);
}

function terrainHeight(x, z) {
  const s = shoreDistance(x, z);
  if (s <= 0) return Math.max(-5, s * 0.25);
  const shelf = 0.18 * Math.min(s, 6);
  const bumps = (fbm(x * 0.09, z * 0.09, 2) - 0.5) * 0.9 * smooth(1, 6, s);
  const ridge = Math.pow(fbm(x * 0.0055 + 5, z * 0.0055 + 2, 5), 1.4) * 165;
  const foothill = fbm(x * 0.028, z * 0.028, 3) * 13 * smooth(8, 60, s);
  return shelf + bumps + foothill + smooth(10, 240, s) * ridge;
}

// ---- Wind sway, injected into Lambert materials on instanced meshes ---------
function addWind(material, amplitude, frequency) {
  const amp = { value: amplitude };
  const freq = { value: frequency };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.uniforms.uWindAmp = amp;
    shader.uniforms.uWindFreq = freq;
    shader.vertexShader = `uniform float uWindTime;\nuniform float uWindAmp;\nuniform float uWindFreq;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec2 windRoot = instanceMatrix[3].xz;
      float windH = transformed.y * transformed.y;
      float windPhase = uWindTime * uWindFreq + windRoot.x * 0.31 + windRoot.y * 0.23;
      transformed.x += sin(windPhase) * uWindAmp * windH;
      transformed.z += cos(windPhase * 0.73) * uWindAmp * 0.6 * windH;`
    );
  };
  return material;
}

// ---- Sky, sun, fog and environment light -------------------------------------
function buildAtmosphere(scene, renderer) {
  const elevation = THREE.MathUtils.degToRad(SUN_ELEVATION_DEG);
  const azimuth = THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG);
  const sunDirection = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    -Math.cos(azimuth) * Math.cos(elevation)
  ).normalize();

  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 2.2;
  u.mieCoefficient.value = 0.006;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDirection);

  renderer.toneMappingExposure = TONE_EXPOSURE;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyOnly = new THREE.Scene();
  skyOnly.add(sky);
  scene.environment = pmrem.fromScene(skyOnly, 0.03, 0.1, 5000).texture;
  pmrem.dispose();
  scene.add(sky);

  // Three blends fog after tone mapping and sRGB encoding, so these are stored raw:
  // going through a hex/sRGB conversion would make the haze render far too dark.
  const fogColor = new THREE.Color().setRGB(0.87, 0.71, 0.56);
  scene.fog = new THREE.FogExp2(fogColor, FOG_DENSITY);

  const sunLight = new THREE.DirectionalLight(0xffc98a, 3.4);
  sunLight.position.copy(sunDirection).multiplyScalar(300);
  scene.add(sunLight);
  scene.add(new THREE.HemisphereLight(0xbcd3ea, 0x4a3d2a, 1.1));

  return sunDirection;
}

function buildWater(scene, sunDirection) {
  water = new Water(new THREE.PlaneGeometry(2400, 2400), {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: new THREE.TextureLoader().load(
      // The npm package omits examples/textures, so this must use jsdelivr's GitHub mirror.
      'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/waternormals.jpg',
      (texture) => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      }
    ),
    sunDirection: sunDirection.clone(),
    sunColor: 0xffe2b0,
    waterColor: 0x0b3a48,
    distortionScale: 2.4,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, -130);
  scene.add(water);
}

// ---- Terrain -------------------------------------------------------------------
function buildTerrain(scene) {
  const SEGMENTS = 220;
  const EXTENT = 950;
  const CENTER_Z = -60;
  const WARP = 2.2; // packs vertices near the lake, sparse out at the fogged horizon
  const geometry = new THREE.PlaneGeometry(2, 2, SEGMENTS, SEGMENTS);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const sand = new THREE.Color(0x9c8460);
  const grass = new THREE.Color(0x5d6b32);
  const forest = new THREE.Color(0x2c3f25);
  const rock = new THREE.Color(0x6d6358);
  const color = new THREE.Color();
  const warp = (v) => Math.sign(v) * EXTENT * Math.pow(Math.abs(v), WARP);

  for (let i = 0; i < pos.count; i += 1) {
    const x = warp(pos.getX(i));
    const z = CENTER_Z - warp(pos.getY(i));
    const h = terrainHeight(x, z);
    pos.setXYZ(i, x, h, z);

    const tint = fbm(x * 0.05, z * 0.05, 2);
    color.copy(sand).lerp(grass, smooth(0.25, 0.8, h + (tint - 0.5) * 0.5));
    color.lerp(forest, smooth(2, 14, h + tint * 8));
    color.lerp(rock, smooth(48, 85, h + tint * 22));
    color.toArray(colors, i * 3);
  }

  geometry.deleteAttribute('uv');
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const terrain = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(terrain);
}

// ---- Trees and reeds -------------------------------------------------------------
function coloredGeometry(geometry, hex) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const count = g.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) c.toArray(arr, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function buildTrees(scene) {
  const rng = mulberry32(7741);
  // Unit height so the wind shader's y^2 term means the same thing for every instance.
  const parts = [
    coloredGeometry(new THREE.CylinderGeometry(0.02, 0.035, 0.2, 5).translate(0, 0.1, 0), 0x3a2a1c),
    coloredGeometry(new THREE.ConeGeometry(0.24, 0.5, 7, 1, true).translate(0, 0.33, 0), 0x25402a),
    coloredGeometry(new THREE.ConeGeometry(0.18, 0.42, 7, 1, true).translate(0, 0.58, 0), 0x2d4c30),
    coloredGeometry(new THREE.ConeGeometry(0.11, 0.36, 7, 1, true).translate(0, 0.82, 0), 0x355638),
  ];
  const geometry = mergeGeometries(parts);
  const material = addWind(
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    0.012,
    0.9
  );
  const trees = new THREE.InstancedMesh(geometry, material, TREE_COUNT);
  trees.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();

  let placed = 0;
  for (let attempt = 0; attempt < 200000 && placed < TREE_COUNT; attempt += 1) {
    const x = (rng() - 0.5) * 1040;
    const z = 50 - rng() * 590;
    const s = shoreDistance(x, z);
    if (s < 6 || rng() > Math.exp(-s / 170)) continue;
    if (fbm(x * 0.018 + 3, z * 0.018, 2) < 0.38) continue;
    const h = terrainHeight(x, z);
    if (h < 0.8 || h > 95) continue;

    const height = 9 + rng() * 11;
    const width = height * (0.85 + rng() * 0.3);
    position.set(x, h - 0.3, z);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    scale.set(width, height, width);
    trees.setMatrixAt(placed, matrix.compose(position, q, scale));
    const v = 0.75 + rng() * 0.5;
    tint.setRGB(v, v * (0.92 + rng() * 0.1), v * 0.86);
    trees.setColorAt(placed, tint);
    placed += 1;
  }
  trees.count = placed;
  scene.add(trees);
}

function buildReeds(scene) {
  const rng = mulberry32(90210);
  const blade = coloredGeometry(new THREE.CylinderGeometry(0.004, 0.018, 0.86, 4).translate(0, 0.43, 0), 0x7c8a3e);
  const head = coloredGeometry(new THREE.CapsuleGeometry(0.02, 0.09, 2, 5).translate(0, 0.91, 0), 0x5a3b22);
  const geometry = mergeGeometries([blade, head]);
  const material = addWind(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.09, 1.9);
  const reeds = new THREE.InstancedMesh(geometry, material, REED_COUNT);
  reeds.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();

  let placed = 0;
  for (let attempt = 0; attempt < 60000 && placed < REED_COUNT; attempt += 1) {
    const side = rng() < 0.5 ? -1 : 1;
    const d = rng() < 0.65 ? -1 + rng() * 120 : 120 + rng() * 150;
    const x = side * (lakeHalfWidth(d, side) + (rng() * 3.2 - 2.4));
    const z = -d;
    if (Math.abs(x) < 0.86 * Math.max(d, 0) + 1.1) continue; // keep the casting cone open
    if (Math.abs(x) < DOCK_HALF_WIDTH + 1 && z > DOCK_END_Z - 1) continue;
    if (fbm(x * 0.09, z * 0.09, 2) < 0.47) continue; // clumps, not an even hedge

    const y = Math.min(0, terrainHeight(x, z)) - 0.05;
    const height = 1.4 + rng() * 1.3;
    position.set(x, y, z);
    euler.set((rng() - 0.5) * 0.2, rng() * Math.PI * 2, (rng() - 0.5) * 0.2);
    q.setFromEuler(euler);
    scale.set(height, height, height);
    reeds.setMatrixAt(placed, matrix.compose(position, q, scale));
    const v = 0.8 + rng() * 0.4;
    tint.setRGB(v, v, v * 0.85);
    reeds.setColorAt(placed, tint);
    placed += 1;
  }
  reeds.count = placed;
  scene.add(reeds);
}

// ---- Dock -------------------------------------------------------------------------
function woodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(3301);
  ctx.fillStyle = '#a58a68';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 90; i += 1) {
    const y = rng() * canvas.height;
    ctx.strokeStyle = `rgba(${rng() < 0.75 ? '58,40,24' : '205,180,145'},${0.07 + rng() * 0.2})`;
    ctx.lineWidth = 0.5 + rng() * 1.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y + (rng() - 0.5) * 8, 340, y + (rng() - 0.5) * 8, 512, y + (rng() - 0.5) * 5);
    ctx.stroke();
  }
  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = 'rgba(48,32,18,0.55)';
    ctx.beginPath();
    ctx.ellipse(rng() * 512, rng() * 64, 7 + rng() * 7, 2 + rng() * 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function buildDock(scene) {
  const rng = mulberry32(5150);
  const material = new THREE.MeshStandardMaterial({
    map: woodTexture(),
    roughness: 0.9,
    envMapIntensity: 0.5,
  });
  const BACK_Z = 3.4;
  const PLANK_W = 0.145;
  const PLANK_GAP = 0.012;
  const PLANK_H = 0.04;
  const length = DOCK_HALF_WIDTH * 2;
  const count = Math.ceil((BACK_Z - DOCK_END_Z) / (PLANK_W + PLANK_GAP));

  const planks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(length, PLANK_H, PLANK_W),
    material,
    count
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const tint = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    const z = DOCK_END_Z + PLANK_W / 2 + i * (PLANK_W + PLANK_GAP);
    p.set((rng() - 0.5) * 0.05, DECK_Y - PLANK_H / 2 - (rng() < 0.2 ? 0.003 : 0), z);
    e.set(0, (rng() - 0.5) * 0.008, (rng() - 0.5) * 0.004);
    q.setFromEuler(e);
    s.set(1, 1, 1);
    planks.setMatrixAt(i, m.compose(p, q, s));
    const v = 0.68 + rng() * 0.42;
    tint.setRGB(v, v * (0.95 + rng() * 0.05), v * (0.86 + rng() * 0.1));
    planks.setColorAt(i, tint);
  }
  scene.add(planks);

  const postZ = [BACK_Z - 0.3, 1.2, -0.7, -2.2, DOCK_END_Z + 0.08];
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.075, 0.09, 1, 10), material, postZ.length * 2);
  const POST_BOTTOM = -2.2;
  let index = 0;
  for (const z of postZ) {
    for (const side of [-1, 1]) {
      const isEnd = z === postZ[postZ.length - 1];
      const top = DECK_Y + (isEnd ? 0.95 : 0.1);
      p.set(side * (DOCK_HALF_WIDTH + 0.03), (top + POST_BOTTOM) / 2, z);
      s.set(1, top - POST_BOTTOM, 1);
      posts.setMatrixAt(index, m.compose(p, q.identity(), s));
      index += 1;
    }
  }
  scene.add(posts);
}

// ---- Gear props, batched by material so the whole set costs a few draw calls ------
const batches = { paint: [], metal: [], net: [], shadow: [] };

function tm(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
}

function under(parent, matrix) {
  return new THREE.Matrix4().multiplyMatrices(parent, matrix);
}

function put(kind, geometry, hex, matrix) {
  const g = coloredGeometry(geometry, hex);
  g.applyMatrix4(matrix);
  batches[kind].push(g);
}

function strut(kind, a, b, radiusAtA, radiusAtB, hex, radial = 7) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const geometry = new THREE.CylinderGeometry(radiusAtB, radiusAtA, length, radial);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  put(kind, geometry, hex, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
}

function box(kind, parent, w, h, d, x, y, z, hex, rx = 0, ry = 0, rz = 0) {
  put(kind, new THREE.BoxGeometry(w, h, d), hex, under(parent, tm(x, y, z, rx, ry, rz)));
}

function contactShadow(x, z, rx, rz, ry = 0) {
  const plane = new THREE.PlaneGeometry(2, 2);
  plane.rotateX(-Math.PI / 2);
  plane.applyMatrix4(tm(x, DECK_Y + 0.002, z, 0, ry, 0, rx, 1, rz));
  batches.shadow.push(plane);
}

function crankbait(parent, x, y, z, bodyHex, bellyHex, ry = 0) {
  const base = under(parent, tm(x, y, z, 0, ry, 0));
  const sphere = new THREE.SphereGeometry(1, 8, 6);
  put('paint', sphere, bodyHex, under(base, tm(0, 0.004, 0, 0, 0, 0, 0.027, 0.011, 0.009)));
  put('paint', sphere, bellyHex, under(base, tm(0.001, -0.002, 0, 0, 0, 0, 0.022, 0.008, 0.0085)));
  put('metal', sphere, 0xe8e8e8, under(base, tm(0.017, 0.006, 0, 0, 0, 0, 0.0028)));
  put('paint', new THREE.BoxGeometry(0.012, 0.0012, 0.008), 0xd8e3e6, under(base, tm(0.03, -0.002, 0, 0, 0, -0.5)));
  const hook = new THREE.TorusGeometry(0.0045, 0.0007, 4, 8, Math.PI * 1.4);
  put('metal', hook, 0xb4b8bb, under(base, tm(0.006, -0.012, 0)));
  put('metal', hook, 0xb4b8bb, under(base, tm(-0.02, -0.01, 0)));
}

function spoon(parent, x, y, z, hex, ry = 0) {
  put('metal', new THREE.SphereGeometry(1, 8, 6), hex, under(parent, tm(x, y, z, 0, ry, 0, 0.026, 0.0025, 0.01)));
}

function softPlastic(parent, x, y, z, hex, ry = 0) {
  const base = under(parent, tm(x, y, z, 0, ry, 0));
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.026, 0, 0),
    new THREE.Vector3(-0.008, 0, 0.007),
    new THREE.Vector3(0.012, 0, -0.005),
    new THREE.Vector3(0.027, 0, 0.004),
  ]);
  put('paint', new THREE.TubeGeometry(curve, 10, 0.0035, 5), hex, base);
}

function buildTackleBox() {
  const W = 0.46;
  const D = 0.25;
  const H = 0.13;
  const WALL = 0.008;
  const shell = 0x3d5c3a;
  const tray = 0xcdbf9d;
  const base = tm(-0.98, DECK_Y, -2.78, 0, 0.14, 0);
  contactShadow(-0.98, -2.74, 0.34, 0.2, 0.14);

  box('paint', base, W, WALL, D, 0, WALL / 2, 0, shell);
  box('paint', base, W, H, WALL, 0, H / 2, D / 2 - WALL / 2, shell);
  box('paint', base, W, H, WALL, 0, H / 2, -D / 2 + WALL / 2, shell);
  box('paint', base, WALL, H, D, -W / 2 + WALL / 2, H / 2, 0, shell);
  box('paint', base, WALL, H, D, W / 2 - WALL / 2, H / 2, 0, shell);

  // Cantilever tray sitting just inside the rim, divided into a 5x3 grid of compartments.
  const trayY = H - 0.03;
  const trayW = W - 2 * WALL - 0.002;
  const trayD = D - 2 * WALL - 0.002;
  box('paint', base, trayW, 0.004, trayD, 0, trayY, 0, tray);
  for (let i = 0; i <= 5; i += 1) {
    box('paint', base, 0.003, 0.024, trayD, -trayW / 2 + (i * trayW) / 5, trayY + 0.012, 0, tray);
  }
  for (let i = 0; i <= 3; i += 1) {
    box('paint', base, trayW, 0.024, 0.003, 0, trayY + 0.012, -trayD / 2 + (i * trayD) / 3, tray);
  }

  const cellX = (i) => -trayW / 2 + ((i + 0.5) * trayW) / 5;
  const cellZ = (j) => -trayD / 2 + ((j + 0.5) * trayD) / 3;
  const lureY = trayY + 0.012;
  crankbait(base, cellX(0), lureY, cellZ(0), 0xd8362a, 0xf1eadb, 0.4);
  crankbait(base, cellX(1), lureY, cellZ(0), 0xe9c32c, 0xf4f0d8, -0.3);
  spoon(base, cellX(2), lureY - 0.006, cellZ(0), 0xe6c15a, 0.5);
  softPlastic(base, cellX(3), lureY - 0.008, cellZ(0), 0x7a3fa0, 0.2);
  crankbait(base, cellX(4), lureY, cellZ(0), 0x2f7fb4, 0xe9eef0, 0.1);
  spoon(base, cellX(0), lureY - 0.006, cellZ(1), 0xd8dde0, -0.4);
  softPlastic(base, cellX(1), lureY - 0.008, cellZ(1), 0xdb5d24, 0.6);
  crankbait(base, cellX(2), lureY, cellZ(1), 0x48a04b, 0xf1ead0, -0.2);
  spoon(base, cellX(3), lureY - 0.006, cellZ(1), 0xcf7c3a, 0.2);
  softPlastic(base, cellX(4), lureY - 0.008, cellZ(1), 0x2c8f7e, -0.5);
  crankbait(base, cellX(0), lureY, cellZ(2), 0xf0f0ea, 0xd3382d, 0.3);
  softPlastic(base, cellX(1), lureY - 0.008, cellZ(2), 0xe3d33c, -0.2);
  spoon(base, cellX(2), lureY - 0.006, cellZ(2), 0xe6c15a, -0.7);
  crankbait(base, cellX(3), lureY, cellZ(2), 0x202a33, 0xd8c23a, 0.5);
  put('metal', new THREE.SphereGeometry(0.0045, 6, 5), 0x8e9396, under(base, tm(cellX(4) - 0.012, lureY - 0.006, cellZ(2))));
  put('metal', new THREE.SphereGeometry(0.0045, 6, 5), 0x8e9396, under(base, tm(cellX(4) + 0.008, lureY - 0.006, cellZ(2) + 0.012)));
  put('metal', new THREE.SphereGeometry(0.0045, 6, 5), 0x8e9396, under(base, tm(cellX(4) + 0.01, lureY - 0.006, cellZ(2) - 0.01)));

  // Lid hinged along the far edge, opened past vertical so its inside faces the camera.
  const lid = under(base, tm(0, H, -D / 2, -1.72, 0, 0));
  const LID_H = 0.035;
  box('paint', lid, W, 0.006, D, 0, LID_H, D / 2, shell);
  box('paint', lid, W, LID_H, WALL, 0, LID_H / 2, WALL / 2, shell);
  box('paint', lid, W, LID_H, WALL, 0, LID_H / 2, D - WALL / 2, shell);
  box('paint', lid, WALL, LID_H, D, -W / 2 + WALL / 2, LID_H / 2, D / 2, shell);
  box('paint', lid, WALL, LID_H, D, W / 2 - WALL / 2, LID_H / 2, D / 2, shell);
  box('paint', lid, W - 0.03, 0.003, D - 0.03, 0, LID_H - 0.006, D / 2, 0xdfe4dc);
  crankbait(lid, -0.12, 0.016, 0.08, 0xc23b6a, 0xf3e9e0, 0.3);
  spoon(lid, 0.02, 0.022, 0.13, 0xe2e4e5, 0.6);
  softPlastic(lid, 0.13, 0.022, 0.1, 0x3d8ac0, -0.4);
  // Carry handle and latches end up on the lid's free edge, now at the top.
  put('metal', new THREE.TorusGeometry(0.055, 0.006, 6, 12, Math.PI), 0x2a2d2f, under(lid, tm(0, LID_H + 0.002, D + 0.002, Math.PI / 2, 0, 0, 1, 0.45, 1)));
  box('metal', lid, 0.03, 0.012, 0.004, -0.15, LID_H / 2, D + 0.003, 0xb6babc);
  box('metal', lid, 0.03, 0.012, 0.004, 0.15, LID_H / 2, D + 0.003, 0xb6babc);
  box('metal', base, 0.03, 0.022, 0.004, -0.15, H - 0.012, D / 2 + 0.003, 0xb6babc);
  box('metal', base, 0.03, 0.022, 0.004, 0.15, H - 0.012, D / 2 + 0.003, 0xb6babc);
}

function lathe(points, segments = 16) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

function buildThermos() {
  const x = -0.8;
  const z = -2.2;
  contactShadow(x, z, 0.095, 0.095);
  const base = tm(x, DECK_Y, z, 0, 0.9, 0);
  put('paint', lathe([[0, 0], [0.046, 0], [0.05, 0.008], [0.05, 0.2], [0.04, 0.228], [0.034, 0.238]]), 0x35684b, base);
  put('metal', lathe([[0.051, 0.01], [0.052, 0.018], [0.051, 0.026]], 16), 0xc2c7ca, base);
  put('metal', lathe([[0.051, 0.186], [0.052, 0.194], [0.051, 0.202]], 16), 0xc2c7ca, base);
  put('metal', lathe([[0.036, 0.238], [0.04, 0.244], [0.04, 0.285], [0.035, 0.292], [0, 0.295]]), 0xc2c7ca, base);
  put('metal', new THREE.TorusGeometry(0.05, 0.006, 6, 12, Math.PI), 0x24292b, under(base, tm(0.05, 0.11, 0, 0, 0, -Math.PI / 2, 0.85, 0.5, 1)));
}

function buildBucket() {
  const x = 1.02;
  const z = -2.34;
  contactShadow(x, z, 0.26, 0.26);
  const base = tm(x, DECK_Y, z);
  const steel = 0x9aa2a5;
  put('metal', lathe([
    [0, 0.005], [0.125, 0.005], [0.128, 0], [0.165, 0.27], [0.172, 0.275], [0.172, 0.285], [0.16, 0.282], [0.122, 0.02], [0, 0.02],
  ], 20), steel, base);
  put('metal', new THREE.TorusGeometry(0.166, 0.005, 5, 20), 0xb2babd, under(base, tm(0, 0.12, 0, Math.PI / 2, 0, 0, 0.84, 0.84, 1)));
  put('paint', new THREE.CircleGeometry(0.148, 18), 0x18404a, under(base, tm(0, 0.205, 0, -Math.PI / 2)));
  // Wire bail dropped against the rim, with a wooden grip at its apex.
  put('metal', new THREE.TorusGeometry(0.17, 0.0035, 5, 18, Math.PI), 0x70777a, under(base, tm(0, 0.28, 0, -0.55)));
  put('paint', new THREE.CylinderGeometry(0.012, 0.012, 0.09, 7), 0x8a5f35, under(base, tm(0, 0.28 + 0.17 * Math.cos(0.55), -0.17 * Math.sin(0.55), 0, 0, Math.PI / 2)));
  for (const side of [-1, 1]) {
    put('metal', new THREE.SphereGeometry(0.009, 6, 5), 0x70777a, under(base, tm(side * 0.17, 0.28, 0)));
  }
}

function buildRope() {
  const x = 0.97;
  const z = -3.02;
  contactShadow(x, z, 0.33, 0.33);
  const points = [];
  const TURNS = 3.2;
  const STEPS = 90;
  for (let layer = 0; layer < 3; layer += 1) {
    const baseR = 0.2 - layer * 0.03;
    const y = 0.018 + layer * 0.027;
    for (let i = 0; i < STEPS; i += 1) {
      const t = i / STEPS;
      const a = t * TURNS * Math.PI * 2 + layer;
      const r = baseR - t * 0.075;
      points.push(new THREE.Vector3(Math.cos(a) * r, y + t * 0.02, Math.sin(a) * r));
    }
  }
  const curve = new THREE.CatmullRomCurve3(points);
  put('paint', new THREE.TubeGeometry(curve, 340, 0.0135, 6), 0xb79a6a, tm(x, DECK_Y, z));

  // Loose tail trailing off the coil across the planks.
  const tail = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.2, 0.016, 0),
    new THREE.Vector3(0.24, 0.015, 0.1),
    new THREE.Vector3(0.14, 0.015, 0.22),
    new THREE.Vector3(0.18, 0.015, 0.33),
  ]);
  put('paint', new THREE.TubeGeometry(tail, 22, 0.0135, 6), 0xa98c5e, tm(x, DECK_Y, z));
}

function buildLandingNet() {
  const foot = new THREE.Vector3(-0.93, DECK_Y + 0.01, -3.03);
  const rest = new THREE.Vector3(-DOCK_HALF_WIDTH + 0.03, DECK_Y + 0.84, DOCK_END_Z + 0.08);
  const dir = new THREE.Vector3().subVectors(rest, foot).normalize();
  const hoopJoin = foot.clone().addScaledVector(dir, 1.25);
  strut('metal', foot, hoopJoin, 0.013, 0.011, 0x2f3438);
  strut('paint', foot.clone().addScaledVector(dir, 0.02), foot.clone().addScaledVector(dir, 0.3), 0.017, 0.017, 0x1b1d1f);
  contactShadow(foot.x, foot.z, 0.07, 0.07);

  const HOOP_R = 0.21;
  const center = hoopJoin.clone().addScaledVector(dir, HOOP_R);
  const normal = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), dir).normalize();
  const yAxis = new THREE.Vector3().crossVectors(normal, dir).normalize();
  const hoop = new THREE.Matrix4().makeBasis(dir, yAxis, normal).setPosition(center);
  put('metal', new THREE.TorusGeometry(HOOP_R, 0.007, 6, 28), 0x2f3438, hoop);

  const bag = lathe([[HOOP_R, 0], [0.19, -0.1], [0.15, -0.21], [0.085, -0.3], [0.02, -0.35]], 22);
  const bagGeometry = coloredGeometry(bag, 0xd9d3c0);
  bagGeometry.applyMatrix4(under(hoop, tm(0, 0, 0, Math.PI / 2)));
  batches.net.push(bagGeometry);
}

function buildSpareRod() {
  const post = new THREE.Vector3(DOCK_HALF_WIDTH + 0.03, 0, DOCK_END_Z + 0.08);
  const holderLow = new THREE.Vector3(post.x - 0.1, DECK_Y + 0.28, post.z + 0.03);
  const holderHigh = new THREE.Vector3(post.x - 0.04, DECK_Y + 0.62, post.z - 0.09);
  strut('metal', holderLow, holderHigh, 0.024, 0.026, 0x8d9396, 10);
  for (const t of [0.25, 0.8]) {
    const at = holderLow.clone().lerp(holderHigh, t);
    strut('metal', at, new THREE.Vector3(post.x, at.y, post.z), 0.008, 0.008, 0x6f7578);
    put('metal', new THREE.TorusGeometry(0.09, 0.009, 6, 16), 0x6f7578, tm(post.x, at.y, post.z, Math.PI / 2));
  }

  const butt = holderLow.clone().addScaledVector(new THREE.Vector3().subVectors(holderHigh, holderLow), -0.2);
  const axis = new THREE.Vector3().subVectors(holderHigh, holderLow).normalize();
  const point = (d) => butt.clone().addScaledVector(axis, d);
  const LENGTH = 3.0;

  strut('paint', point(0), point(0.75), 0.012, 0.0115, 0xb78f5b);
  strut('paint', point(0.75), point(0.98), 0.0115, 0.009, 0x24292b);
  strut('paint', point(0.98), point(LENGTH), 0.0078, 0.0016, 0x2b3744);

  const reelAt = point(0.86);
  const side = new THREE.Vector3(-0.8, -0.1, 0.55).normalize();
  const spool = reelAt.clone().addScaledVector(side, 0.07);
  strut('metal', reelAt, spool, 0.006, 0.008, 0x3c4246);
  strut('metal', spool.clone().addScaledVector(axis, -0.038), spool.clone().addScaledVector(axis, 0.038), 0.036, 0.03, 0xaab0b3, 14);

  for (const d of [1.25, 1.55, 1.85, 2.15, 2.45, 2.72, 2.96]) {
    const c = point(d).addScaledVector(side, 0.012);
    const size = 0.016 - (d / LENGTH) * 0.008;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
    put('metal', new THREE.TorusGeometry(size, 0.0012, 4, 10), 0xc8ccce, new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1)));
  }
}

function shadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(18,10,4,0.62)');
  gradient.addColorStop(0.6, 'rgba(18,10,4,0.3)');
  gradient.addColorStop(1, 'rgba(18,10,4,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function buildProps(scene) {
  buildTackleBox();
  buildThermos();
  buildBucket();
  buildRope();
  buildLandingNet();
  buildSpareRod();

  scene.add(new THREE.Mesh(
    mergeGeometries(batches.paint),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, envMapIntensity: 0.6 })
  ));
  scene.add(new THREE.Mesh(
    mergeGeometries(batches.metal),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.85, envMapIntensity: 1 })
  ));
  scene.add(new THREE.Mesh(
    mergeGeometries(batches.net),
    new THREE.MeshBasicMaterial({ vertexColors: true, wireframe: true, transparent: true, opacity: 0.75 })
  ));
  const shadows = new THREE.Mesh(
    mergeGeometries(batches.shadow),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadows.renderOrder = 1;
  scene.add(shadows);
}

// The water's normals warp reflections of objects this close into dark jagged blobs.
function hideFromReflection(objects) {
  const renderWaterReflection = water.onBeforeRender;
  water.onBeforeRender = (renderer, scene, camera) => {
    objects.forEach((object) => { object.visible = false; });
    renderWaterReflection.call(water, renderer, scene, camera);
    objects.forEach((object) => { object.visible = true; });
  };
}

// ---- Public API ----------------------------------------------------------------
export function buildWorld(scene, renderer) {
  const sunDirection = buildAtmosphere(scene, renderer);
  buildWater(scene, sunDirection);
  buildTerrain(scene);
  buildTrees(scene);
  const firstNearObject = scene.children.length;
  buildReeds(scene);
  buildDock(scene);
  buildProps(scene);
  hideFromReflection(scene.children.slice(firstNearObject));
  return { sunDirection };
}

export function updateWorld(dt, time) {
  if (water) water.material.uniforms.time.value += dt * 0.8;
  windTime.value = time;
}
