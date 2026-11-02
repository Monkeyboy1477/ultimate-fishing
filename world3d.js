// world3d.js
// Procedural fishing worlds, one per map (pond, river, lake, ocean): sky, water, terrain, scenery, dock and gear props.
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

// ---- Per-map look: sky, sun, fog, light and water --------------------------------
// Fog is blended after tone mapping, so fog colors here are the on-screen sRGB values.
const MAP_STYLE = {
  pond: {
    sunElevation: 25, sunAzimuth: 36, turbidity: 2.2, rayleigh: 3.4, mie: 0.003, mieG: 0.8,
    exposure: 0.6, skyTint: [0.55, 0.8, 1.3], fog: [0.78, 0.82, 0.74], fogDensity: 0.0036,
    sunHex: 0xffd49c, sunIntensity: 3.3, hemiSky: 0xd2e2f2, hemiGround: 0x5c5434, hemiIntensity: 1.15,
    water: { color: 0x1f7058, sun: 0xffe2b4, distortion: 1.5, size: 1.5, flow: [0, 0], drift: 1, swell: 0 },
  },
  river: {
    sunElevation: 31, sunAzimuth: -30, turbidity: 1.8, rayleigh: 4, mie: 0.003, mieG: 0.8,
    exposure: 0.6, skyTint: [0.7, 0.85, 1.15], fog: [0.62, 0.74, 0.8], fogDensity: 0.0034,
    sunHex: 0xe6eeff, sunIntensity: 3, hemiSky: 0xb2cfe8, hemiGround: 0x3a4638, hemiIntensity: 1.2,
    water: { color: 0x1b5058, sun: 0xeaf2ff, distortion: 1.7, size: 2, flow: [0, 7], drift: 0.2, swell: 0 },
  },
  lake: {
    sunElevation: SUN_ELEVATION_DEG, sunAzimuth: SUN_AZIMUTH_DEG, turbidity: 6, rayleigh: 2.2, mie: 0.006, mieG: 0.82,
    exposure: TONE_EXPOSURE, fog: [0.87, 0.71, 0.56], fogDensity: FOG_DENSITY,
    sunHex: 0xffc98a, sunIntensity: 3.4, hemiSky: 0xbcd3ea, hemiGround: 0x4a3d2a, hemiIntensity: 1.1,
    water: { color: 0x0b3a48, sun: 0xffe2b0, distortion: 2.4, size: 1, flow: [0, 0], drift: 1, swell: 0 },
  },
  ocean: {
    sunElevation: 42, sunAzimuth: 14, turbidity: 1.4, rayleigh: 3.6, mie: 0.002, mieG: 0.8,
    exposure: 0.66, skyTint: [0.32, 0.62, 1.4], fog: [0.62, 0.77, 0.92], fogDensity: 0.0015,
    sunHex: 0xfff3e0, sunIntensity: 3.6, hemiSky: 0xc4deff, hemiGround: 0x2f4a66, hemiIntensity: 1.2,
    water: { color: 0x0a66b0, sun: 0xfff6e2, distortion: 3.2, size: 0.55, flow: [0, 0], drift: 1, swell: 1 },
  },
};

let sceneRef = null;
let rendererRef = null;
let sky = null;
let sunLight = null;
let hemiLight = null;
let currentMapId = null;
const envTextures = {};
const mapEntries = {};
const docks = {};
const nearObjects = []; // everything close to the water that must not show in its reflection

function buildAtmosphere(scene, renderer) {
  sky = new Sky();
  sky.scale.setScalar(4000);
  // Optional blue-up tint so daytime skies stay blue instead of washing out to white.
  sky.material.uniforms.uTint = { value: new THREE.Vector3(1, 1, 1) };
  sky.material.fragmentShader = `uniform vec3 uTint;
${sky.material.fragmentShader}`.replace(
    'gl_FragColor = vec4( retColor, 1.0 );',
    'retColor *= mix( vec3( 1.0 ), uTint, smoothstep( -0.15, 0.25, direction.y ) ); gl_FragColor = vec4( retColor, 1.0 );'
  );
  scene.add(sky);

  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.87, 0.71, 0.56), FOG_DENSITY);
  sunLight = new THREE.DirectionalLight(0xffc98a, 3.4);
  scene.add(sunLight);
  hemiLight = new THREE.HemisphereLight(0xbcd3ea, 0x4a3d2a, 1.1);
  scene.add(hemiLight);
}

function sunVector(style) {
  const elevation = THREE.MathUtils.degToRad(style.sunElevation);
  const azimuth = THREE.MathUtils.degToRad(style.sunAzimuth);
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    -Math.cos(azimuth) * Math.cos(elevation)
  ).normalize();
}

function applyStyle(id) {
  const style = MAP_STYLE[id];
  const sunDirection = sunVector(style);
  const u = sky.material.uniforms;
  u.turbidity.value = style.turbidity;
  u.rayleigh.value = style.rayleigh;
  u.mieCoefficient.value = style.mie;
  u.mieDirectionalG.value = style.mieG;
  u.sunPosition.value.copy(sunDirection);
  u.uTint.value.fromArray(style.skyTint || [1, 1, 1]);

  // One environment map per sky, made the first time the map is visited and then reused.
  if (!envTextures[id]) {
    const pmrem = new THREE.PMREMGenerator(rendererRef);
    const skyOnly = new THREE.Scene();
    skyOnly.add(sky);
    envTextures[id] = pmrem.fromScene(skyOnly, 0.03, 0.1, 5000).texture;
    pmrem.dispose();
    sceneRef.add(sky);
  }
  sceneRef.environment = envTextures[id];
  rendererRef.toneMappingExposure = style.exposure;

  sceneRef.fog.color.setRGB(style.fog[0], style.fog[1], style.fog[2]);
  sceneRef.fog.density = style.fogDensity;
  sunLight.color.setHex(style.sunHex);
  sunLight.intensity = style.sunIntensity;
  sunLight.position.copy(sunDirection).multiplyScalar(300);
  hemiLight.color.setHex(style.hemiSky);
  hemiLight.groundColor.setHex(style.hemiGround);
  hemiLight.intensity = style.hemiIntensity;

  const wu = water.material.uniforms;
  wu.sunDirection.value.copy(sunDirection);
  wu.sunColor.value.setHex(style.water.sun);
  wu.waterColor.value.setHex(style.water.color);
  wu.distortionScale.value = style.water.distortion;
  wu.size.value = style.water.size;
  wu.uFlow.value.set(style.water.flow[0], style.water.flow[1]);
  wu.uDrift.value = style.water.drift;
  wu.uSwell.value = style.water.swell;
}

function buildWater(scene) {
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
    sunDirection: new THREE.Vector3(0, 1, 0),
    sunColor: 0xffe2b0,
    waterColor: 0x0b3a48,
    distortionScale: 2.4,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, -130);

  // Extra shader inputs: a steady current (river), slower base drift, and big swells (ocean).
  // With flow = 0, drift = 1 and swell = 0 the shader matches stock Water exactly.
  const mat = water.material;
  mat.uniforms.uFlow = { value: new THREE.Vector2() };
  mat.uniforms.uDrift = { value: 1 };
  mat.uniforms.uSwell = { value: 0 };
  const noiseStart = mat.fragmentShader.indexOf('vec4 getNoise( vec2 uv ) {');
  const noiseEnd = mat.fragmentShader.indexOf('return noise * 0.5 - 1.0;');
  const noiseBody = mat.fragmentShader
    .slice(noiseStart, noiseEnd)
    .replace(/time/g, 'tt')
    .replace('vec4 getNoise( vec2 uv ) {', 'vec4 getNoise( vec2 uv ) {\n float tt = time * uDrift; uv += uFlow * time;');
  mat.fragmentShader = `uniform vec2 uFlow;
uniform float uDrift;
uniform float uSwell;
vec3 swellTerms( vec2 p, float t ) {
  vec2 slope = vec2( 0.0 );
  float h = 0.0;
  float a = dot( p, vec2( 0.31, 0.95 ) ) * 0.11 - t * 0.9;
  slope += vec2( 0.31, 0.95 ) * cos( a ) * 0.2; h += sin( a ) * 0.5;
  float b = dot( p, vec2( -0.8, 0.6 ) ) * 0.19 - t * 1.25;
  slope += vec2( -0.8, 0.6 ) * cos( b ) * 0.16; h += sin( b ) * 0.3;
  float c = dot( p, vec2( 0.95, 0.3 ) ) * 0.31 - t * 1.7;
  slope += vec2( 0.95, 0.3 ) * cos( c ) * 0.1; h += sin( c ) * 0.2;
  return vec3( slope, h );
}
${mat.fragmentShader.slice(0, noiseStart)}${noiseBody}${mat.fragmentShader.slice(noiseEnd)}`
    .replace(
      'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
      `vec3 swell = uSwell > 0.0 ? swellTerms( worldPosition.xz, time ) * uSwell : vec3( 0.0 );
					vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) + vec3( swell.x, 0.0, swell.y ) );`
    )
    .replace(
      'vec3 outgoingLight = albedo;',
      'albedo *= 1.0 + swell.z * 0.28;\n\t\t\t\t\tvec3 outgoingLight = albedo;'
    );
  scene.add(water);
}

// ---- Terrain -------------------------------------------------------------------
// def: { height(x, z), color(color, h, tint, x, z) }
function buildTerrain(group, def) {
  const SEGMENTS = 220;
  const EXTENT = 950;
  const CENTER_Z = -60;
  const WARP = 2.2; // packs vertices near the water, sparse out at the fogged horizon
  const geometry = new THREE.PlaneGeometry(2, 2, SEGMENTS, SEGMENTS);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  const warp = (v) => Math.sign(v) * EXTENT * Math.pow(Math.abs(v), WARP);

  for (let i = 0; i < pos.count; i += 1) {
    const x = warp(pos.getX(i));
    const z = CENTER_Z - warp(pos.getY(i));
    const h = def.height(x, z);
    pos.setXYZ(i, x, h, z);
    def.color(color, h, fbm(x * 0.05, z * 0.05, 2), x, z);
    color.toArray(colors, i * 3);
  }

  geometry.deleteAttribute('uv');
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  group.add(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true })));
}

const LAKE_SAND = new THREE.Color(0x9c8460);
const LAKE_GRASS = new THREE.Color(0x5d6b32);
const LAKE_FOREST = new THREE.Color(0x2c3f25);
const LAKE_ROCK = new THREE.Color(0x6d6358);
const LAKE_DEF = {
  height: terrainHeight,
  color(color, h, tint) {
    color.copy(LAKE_SAND).lerp(LAKE_GRASS, smooth(0.25, 0.8, h + (tint - 0.5) * 0.5));
    color.lerp(LAKE_FOREST, smooth(2, 14, h + tint * 8));
    color.lerp(LAKE_ROCK, smooth(48, 85, h + tint * 22));
  },
};

// ---- Mill Pond shape -------------------------------------------------------------
// A little pond, about 70 m from the dock to the far bank. The near banks follow the same
// 0.88 slope as the lake (outside the 40-degree aim cone), then a cove opens either side of the
// dock and the pond widens to 90+ m across. Water always spans the full +-30 m x 55 m cast area.
const POND_FAR_D = 70;

function pondHalfWidth(d, side) {
  if (d <= -SHORE_BEHIND_Z || d >= POND_FAR_D) return 0;
  const cone = 0.88 * (d + SHORE_BEHIND_Z);
  const cove = 8 * smooth(2, 14, d) * (1 - smooth(26, 42, d));
  const k = (d - 34) / 36;
  const body = 47 * Math.sqrt(Math.max(0, 1 - k * k)) - 1.5 + valueNoise(d * 0.06, side * 5.1) * 3.5;
  return Math.min(body, cone + cove);
}

function pondShore(x, z) {
  const d = -z;
  const side = x >= 0 ? 1 : -1;
  return Math.max(Math.abs(x) - pondHalfWidth(d, side), z - SHORE_BEHIND_Z, d - POND_FAR_D);
}

function pondHeight(x, z) {
  const s = pondShore(x, z);
  if (s <= 0) return Math.max(-3, s * 0.2);
  const shelf = 0.2 * Math.min(s, 5);
  const bumps = (fbm(x * 0.12, z * 0.12, 2) - 0.5) * 0.7 * smooth(1, 6, s);
  const rolling = fbm(x * 0.03, z * 0.03, 3) * 5 * smooth(6, 60, s);
  const hills = fbm(x * 0.008 + 9, z * 0.008 + 4, 4) * 52 * smooth(25, 350, s);
  return shelf + bumps + rolling + hills;
}

const POND_MUD = new THREE.Color(0x7a6a44);
const POND_GRASS = new THREE.Color(0x7aa83c);
const POND_MEADOW = new THREE.Color(0x98b84a);
const POND_HILL = new THREE.Color(0x4f7a30);
const POND_DEEP = new THREE.Color(0x35602a);
const POND_DEF = {
  height: pondHeight,
  color(color, h, tint, x, z) {
    const s = pondShore(x, z);
    color.copy(POND_MUD).lerp(POND_GRASS, smooth(0.1, 1.6, s));
    color.lerp(POND_MEADOW, smooth(0.4, 0.75, tint) * 0.7);
    color.lerp(POND_HILL, smooth(4, 24, h + tint * 6));
    color.lerp(POND_DEEP, smooth(18, 50, h + tint * 10));
  },
};

// ---- Rocky River shape -----------------------------------------------------------
// The river runs away from the dock, with the bank cone at the dock and a gentle meander. At
// least 30 m of water each side of the centerline keeps the +-24 m cast width wet along the
// 100 m cast range (the centerline never strays more than 4 m from the dock axis out there).
function riverCenter(d) {
  const dd = Math.max(d, 0);
  return 4 * Math.sin(dd * 0.03) * smooth(15, 60, dd) + 55 * Math.sin((dd - 90) * 0.0075) * smooth(100, 280, dd);
}

function riverEdges(d, side) {
  if (d <= -SHORE_BEHIND_Z) return null;
  const cone = 0.88 * (d + SHORE_BEHIND_Z);
  const c = riverCenter(d);
  const w = 30.5 + valueNoise(d * 0.04, side * 3.1 + 2) * 2.4 - 1.2;
  return { left: Math.max(c - w, -cone), right: Math.min(c + w, cone) };
}

function riverShore(x, z) {
  const d = -z;
  const e = riverEdges(d, x >= 0 ? 1 : -1);
  if (!e) return Math.max(z - SHORE_BEHIND_Z, 0.5);
  const across = x > e.right ? x - e.right : e.left - x;
  const inside = -Math.min(x - e.left, e.right - x);
  return Math.max(across > 0 ? across : inside, z - SHORE_BEHIND_Z);
}

function riverHeight(x, z) {
  const s = riverShore(x, z);
  if (s <= 0) return Math.max(-4, s * 0.16);
  const shelf = 0.32 * Math.min(s, 8);
  const bumps = (fbm(x * 0.08, z * 0.08, 2) - 0.5) * 1.2 * smooth(1, 8, s);
  const foot = fbm(x * 0.03, z * 0.03, 3) * 10 * smooth(6, 60, s);
  const ridge = Math.pow(fbm(x * 0.007 + 3, z * 0.007 + 8, 5), 1.3) * 140 * smooth(12, 260, s);
  return shelf + bumps + foot + ridge;
}

const RIVER_GRAVEL = new THREE.Color(0x8a8578);
const RIVER_MOSS = new THREE.Color(0x4a5a34);
const RIVER_FOREST = new THREE.Color(0x26382a);
const RIVER_ROCK = new THREE.Color(0x6c6c6a);
const RIVER_DEF = {
  height: riverHeight,
  color(color, h, tint, x, z) {
    const s = riverShore(x, z);
    color.copy(RIVER_GRAVEL).lerp(RIVER_MOSS, smooth(1.5, 5 + tint * 4, s));
    color.lerp(RIVER_FOREST, smooth(3, 16, h + tint * 8));
    color.lerp(RIVER_ROCK, smooth(55, 95, h + tint * 22));
  },
};

// ---- Instancing helpers ------------------------------------------------------------
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

function instanced(geometry, material, count) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  return mesh;
}

// ---- Trees ---------------------------------------------------------------------------
let pineAssets = null;
function getPineAssets() {
  if (pineAssets) return pineAssets;
  // Unit height so the wind shader's y^2 term means the same thing for every instance.
  const parts = [
    coloredGeometry(new THREE.CylinderGeometry(0.02, 0.035, 0.2, 5).translate(0, 0.1, 0), 0x3a2a1c),
    coloredGeometry(new THREE.ConeGeometry(0.24, 0.5, 7, 1, true).translate(0, 0.33, 0), 0x25402a),
    coloredGeometry(new THREE.ConeGeometry(0.18, 0.42, 7, 1, true).translate(0, 0.58, 0), 0x2d4c30),
    coloredGeometry(new THREE.ConeGeometry(0.11, 0.36, 7, 1, true).translate(0, 0.82, 0), 0x355638),
  ];
  pineAssets = {
    geometry: mergeGeometries(parts),
    material: addWind(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.012, 0.9),
  };
  return pineAssets;
}

function buildTrees(group) {
  const rng = mulberry32(7741);
  const { geometry, material } = getPineAssets();
  const trees = instanced(geometry, material, TREE_COUNT);

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
  group.add(trees);
}

function buildRiverPines(group) {
  const COUNT = 1500;
  const rng = mulberry32(31337);
  const { geometry, material } = getPineAssets();
  const trees = instanced(geometry, material, COUNT);

  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();

  let placed = 0;
  for (let attempt = 0; attempt < 200000 && placed < COUNT; attempt += 1) {
    const x = (rng() - 0.5) * 900;
    const z = 40 - rng() * 560;
    const s = riverShore(x, z);
    if (s < 5 || rng() > Math.exp(-s / 230)) continue;
    if (fbm(x * 0.02 + 1, z * 0.02 + 7, 2) < 0.28) continue;
    const h = riverHeight(x, z);
    if (h < 0.8 || h > 110) continue;

    const height = 13 + rng() * 13;
    const width = height * (0.7 + rng() * 0.25);
    position.set(x, h - 0.3, z);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    scale.set(width, height, width);
    trees.setMatrixAt(placed, matrix.compose(position, q, scale));
    const v = 0.7 + rng() * 0.45;
    tint.setRGB(v * 0.9, v, v * 1.05);
    trees.setColorAt(placed, tint);
    placed += 1;
  }
  trees.count = placed;
  group.add(trees);
}

function buildLeafyTrees(group, avoid) {
  const COUNT = 280;
  const rng = mulberry32(2024);
  const blob = (r, x, y, z, hex, sy = 0.85) =>
    coloredGeometry(new THREE.IcosahedronGeometry(r, 1).scale(1, sy, 1).translate(x, y, z), hex);
  const geometry = mergeGeometries([
    coloredGeometry(new THREE.CylinderGeometry(0.03, 0.055, 0.5, 6).translate(0, 0.25, 0), 0x4b3622),
    blob(0.3, 0, 0.64, 0, 0x3f7a2a),
    blob(0.22, 0.2, 0.55, 0.05, 0x4e8c30),
    blob(0.22, -0.19, 0.57, -0.06, 0x468433),
    blob(0.2, 0.02, 0.84, 0.04, 0x5a9a38),
    blob(0.18, -0.05, 0.52, 0.2, 0x3a7028),
  ]);
  const material = addWind(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.014, 1.1);
  const trees = instanced(geometry, material, COUNT);

  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();

  let placed = 0;
  for (let attempt = 0; attempt < 100000 && placed < COUNT; attempt += 1) {
    const x = (rng() - 0.5) * 700;
    const z = 40 - rng() * 480;
    const s = pondShore(x, z);
    if (s < 4 || rng() > Math.exp(-s / 70)) continue;
    if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < 16) continue;
    if (fbm(x * 0.025 + 3, z * 0.025 + 9, 2) < 0.4) continue;
    const h = pondHeight(x, z);
    if (h > 70) continue;

    const height = 6 + rng() * 6;
    const width = height * (0.9 + rng() * 0.35);
    position.set(x, h - 0.2, z);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    scale.set(width, height, width);
    trees.setMatrixAt(placed, matrix.compose(position, q, scale));
    const v = 0.78 + rng() * 0.4;
    tint.setRGB(v * (0.9 + rng() * 0.2), v, v * 0.82);
    trees.setColorAt(placed, tint);
    placed += 1;
  }
  trees.count = placed;
  group.add(trees);
}

// ---- Reeds, grass and lilies ---------------------------------------------------------
const LAKE_REEDS = {
  seed: 90210, count: REED_COUNT, clump: 0.47, latCap: Infinity, farD: 270,
  halfWidth: lakeHalfWidth, height: terrainHeight,
  pickD: (rng) => (rng() < 0.65 ? -1 + rng() * 120 : 120 + rng() * 150),
};
const POND_REEDS = {
  seed: 4471, count: 1000, clump: 0.4, latCap: 33, farD: 70,
  halfWidth: pondHalfWidth, height: pondHeight,
  pickD: (rng) => -1 + rng() * 72,
};

function buildReeds(group, cfg) {
  const rng = mulberry32(cfg.seed);
  const blade = coloredGeometry(new THREE.CylinderGeometry(0.004, 0.018, 0.86, 4).translate(0, 0.43, 0), 0x7c8a3e);
  const head = coloredGeometry(new THREE.CapsuleGeometry(0.02, 0.09, 2, 5).translate(0, 0.91, 0), 0x5a3b22);
  const geometry = mergeGeometries([blade, head]);
  const material = addWind(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.09, 1.9);
  const reeds = instanced(geometry, material, cfg.count);

  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();

  let placed = 0;
  for (let attempt = 0; attempt < 60000 && placed < cfg.count; attempt += 1) {
    const side = rng() < 0.5 ? -1 : 1;
    const d = cfg.pickD(rng);
    const x = side * (cfg.halfWidth(d, side) + (rng() * 3.2 - 2.4));
    const z = -d;
    if (Math.abs(x) < Math.min(0.86 * Math.max(d, 0) + 1.1, cfg.latCap + 2)) continue; // keep the casting cone open
    if (Math.abs(x) < DOCK_HALF_WIDTH + 1 && z > DOCK_END_Z - 1) continue;
    if (fbm(x * 0.09, z * 0.09, 2) < cfg.clump) continue; // clumps, not an even hedge

    const y = Math.min(0, cfg.height(x, z)) - 0.05;
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
  group.add(reeds);
  nearObjects.push(reeds);
}

function buildGrassTufts(group, avoid) {
  const COUNT = 3600;
  const rng = mulberry32(8080);
  const blades = [];
  for (let i = 0; i < 3; i += 1) {
    const g = new THREE.ConeGeometry(0.025, 0.4, 3).translate(0, 0.2, 0);
    g.rotateZ((i - 1) * 0.25);
    g.rotateY(i * 1.1);
    blades.push(coloredGeometry(g, i === 1 ? 0x7fae3e : 0x628f2f));
  }
  const material = addWind(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.35, 2.2);
  const tufts = instanced(mergeGeometries(blades), material, COUNT);

  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();

  let placed = 0;
  for (let attempt = 0; attempt < 120000 && placed < COUNT; attempt += 1) {
    const x = (rng() - 0.5) * 220;
    const z = 20 - rng() * 150;
    const s = pondShore(x, z);
    if (s < 0.3 || rng() > Math.exp(-s / 22)) continue;
    if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < 6) continue;
    if (Math.abs(x) < DOCK_HALF_WIDTH + 0.5 && z > DOCK_END_Z - 1) continue;
    const h = pondHeight(x, z);
    const size = 0.8 + rng() * 1.1;
    position.set(x, h - 0.02, z);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    scale.set(size, size * (0.8 + rng() * 0.8), size);
    tufts.setMatrixAt(placed, matrix.compose(position, q, scale));
    const v = 0.75 + rng() * 0.5;
    tint.setRGB(v, v, v * 0.8);
    tufts.setColorAt(placed, tint);
    placed += 1;
  }
  tufts.count = placed;
  group.add(tufts);
}

function buildLilies(group) {
  const PADS = 320;
  const rng = mulberry32(606);
  const padGeometry = new THREE.CircleGeometry(0.32, 14, 0.3, Math.PI * 2 - 0.6).rotateX(-Math.PI / 2);
  const pads = instanced(padGeometry, new THREE.MeshLambertMaterial({ color: 0x4f8f30, side: THREE.DoubleSide }), PADS);
  const flowerGeometry = new THREE.SphereGeometry(0.09, 6, 4).scale(1, 0.7, 1);
  const flowers = instanced(flowerGeometry, new THREE.MeshLambertMaterial({ color: 0xffffff }), 60);

  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();
  const flowerColors = [0xf4b6c8, 0xffffff, 0xf7e27a, 0xf4b6c8];

  let placed = 0;
  let flowerCount = 0;
  for (let attempt = 0; attempt < 60000 && placed < PADS; attempt += 1) {
    const side = rng() < 0.5 ? -1 : 1;
    const d = 2 + rng() * 66;
    const x = side * (pondHalfWidth(d, side) - 1.2 - rng() * 11);
    const z = -d;
    // Keep lilies out of the area a lure can land in.
    if (Math.abs(x) < Math.min(30, 0.86 * d) + 1.2 && d < 57) continue;
    if (pondShore(x, z) > -1) continue;
    if (fbm(x * 0.13 + 4, z * 0.13, 2) < 0.45) continue;

    const size = 0.7 + rng() * 0.9;
    position.set(x, 0.03, z);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    scale.set(size, 1, size);
    pads.setMatrixAt(placed, matrix.compose(position, q, scale));
    const v = 0.75 + rng() * 0.5;
    tint.setRGB(v * 0.95, v, v * 0.9);
    pads.setColorAt(placed, tint);
    if (placed % 5 === 0 && flowerCount < 60) {
      position.set(x + (rng() - 0.5) * 0.3, 0.1, z + (rng() - 0.5) * 0.3);
      flowers.setMatrixAt(flowerCount, matrix.compose(position, q, scale.set(1, 1, 1)));
      tint.setHex(flowerColors[flowerCount % flowerColors.length]);
      flowers.setColorAt(flowerCount, tint);
      flowerCount += 1;
    }
    placed += 1;
  }
  pads.count = placed;
  flowers.count = flowerCount;
  group.add(pads, flowers);
  nearObjects.push(pads, flowers);
}

// ---- The old mill ----------------------------------------------------------------------
function gableRoof(w, h, d, hex) {
  const A = [-w / 2, 0, -d / 2];
  const B = [w / 2, 0, -d / 2];
  const C = [w / 2, 0, d / 2];
  const D = [-w / 2, 0, d / 2];
  const R1 = [-w / 2, h, 0];
  const R2 = [w / 2, h, 0];
  const tris = [D, C, R2, D, R2, R1, B, A, R1, B, R1, R2, A, D, R1, C, B, R2];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  geometry.computeVertexNormals();
  const colors = [];
  const c = new THREE.Color(hex);
  for (let i = 0; i < tris.length; i += 1) colors.push(c.r, c.g, c.b);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function buildMill(group) {
  const parts = [];
  const add = (geometry, hex, matrix) => {
    const g = coloredGeometry(geometry, hex);
    g.applyMatrix4(matrix);
    parts.push(g);
  };
  const block = (w, h, d, x, y, z, hex, rx = 0, ry = 0, rz = 0) =>
    add(new THREE.BoxGeometry(w, h, d), hex, tm(x, y, z, rx, ry, rz));

  block(8.4, 2.8, 6.4, 0, 0.4, 0, 0x8d8a82); // stone footing
  block(7.6, 4.6, 5.6, 0, 4.1, 0, 0xd9ccb0); // plaster walls
  const timber = 0x4a3425;
  for (const x of [-3.7, -1.85, 0, 1.85, 3.7]) block(0.24, 4.6, 0.12, x, 4.1, 2.85, timber);
  for (const y of [1.9, 4.1, 6.3]) block(7.8, 0.22, 0.12, 0, y, 2.85, timber);
  block(1.4, 2.3, 0.14, 0.9, 2.75, 2.88, 0x3b2a1c); // door
  block(0.9, 0.95, 0.14, -2.6, 4.7, 2.88, 0x2a3846); // windows
  block(0.9, 0.95, 0.14, 2.9, 4.7, 2.88, 0x2a3846);
  block(1.1, 1.1, 0.14, 0, 5.4, 2.88, 0x3b2a1c); // loft hatch
  add(gableRoof(8.8, 3.4, 7.2, 0x7a4636), 0x7a4636, tm(0, 6.4, 0));
  block(0.9, 2.4, 0.9, 2.6, 8.2, -1.2, 0x8d8a82); // chimney

  // Water wheel on the left wall.
  const wx = -4.7;
  const wy = 2.6;
  const wz = 0.4;
  const R = 2.1;
  add(new THREE.TorusGeometry(R, 0.1, 5, 20), 0x5a4129, tm(wx, wy, wz, 0, Math.PI / 2, 0));
  for (let i = 0; i < 4; i += 1) {
    block(0.12, R * 2, 0.1, wx, wy, wz, 0x5a4129, (i * Math.PI) / 4);
  }
  for (let i = 0; i < 12; i += 1) {
    const a = (i * Math.PI * 2) / 12;
    block(1.0, 0.07, 0.55, wx, wy + Math.cos(a) * R, wz + Math.sin(a) * R, 0x6b4e30, a);
  }
  block(0.3, 0.3, 1.2, wx + 0.5, wy, wz, 0x4a3425); // axle stub into the wall

  const mesh = new THREE.Mesh(
    mergeGeometries(parts),
    new THREE.MeshLambertMaterial({ vertexColors: true })
  );
  mesh.frustumCulled = false;

  // Stand it on the far bank, left of the line of fire, facing the water.
  const mx = -17;
  let d = 50;
  while (d < 140 && pondShore(mx, -d) < 9) d += 1;
  const mz = -d - 3;
  let y = -Infinity;
  for (const [dx, dz] of [[-4, -3], [4, -3], [-4, 3], [4, 3], [0, 0]]) y = Math.max(y, pondHeight(mx + dx, mz + dz));
  mesh.position.set(mx, y - 0.3, mz);
  mesh.rotation.y = 0.18;
  mesh.scale.setScalar(1.35);
  group.add(mesh);
  return { x: mx, z: mz };
}

// ---- Boulders and river foam -----------------------------------------------------------
let softTexture = null;
function getSoftTexture() {
  if (softTexture) return softTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.4)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  softTexture = new THREE.CanvasTexture(canvas);
  return softTexture;
}

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = valueNoise(x * 2.1 + 10 + y * 1.3, z * 2.1 + y * 1.7);
    const r = 1 + (n - 0.5) * 0.6;
    pos.setXYZ(i, x * r, y * r * 0.72, z * r);
    const shade = 0.62 + valueNoise(x * 4 + 3, z * 4 + y * 3) * 0.38;
    colors[i * 3] = shade * 0.8;
    colors[i * 3 + 1] = shade * 0.79;
    colors[i * 3 + 2] = shade * 0.76;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

function buildRiverRocks(group) {
  const BANK = 150;
  const WATER = 90;
  const rng = mulberry32(5577);
  const rocks = instanced(rockGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), BANK + WATER);
  const foamGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const foamMaterial = new THREE.MeshBasicMaterial({
    map: getSoftTexture(), transparent: true, opacity: 0.8, depthWrite: false, color: 0xe8f4f6,
  });
  const foam = instanced(foamGeometry, foamMaterial, WATER);
  foam.renderOrder = 1;

  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();
  const noRot = new THREE.Quaternion();

  let placed = 0;
  let foamCount = 0;
  const putRock = (x, y, z, r) => {
    euler.set((rng() - 0.5) * 0.4, rng() * Math.PI * 2, (rng() - 0.5) * 0.4);
    q.setFromEuler(euler);
    position.set(x, y, z);
    scale.set(r * (0.9 + rng() * 0.5), r * (0.8 + rng() * 0.5), r * (0.9 + rng() * 0.5));
    rocks.setMatrixAt(placed, matrix.compose(position, q, scale));
    const v = 0.7 + rng() * 0.5;
    tint.setRGB(v, v * (0.95 + rng() * 0.08), v * (0.9 + rng() * 0.1));
    rocks.setColorAt(placed, tint);
    placed += 1;
  };

  // Boulders along both banks.
  for (let attempt = 0, n = 0; attempt < 20000 && n < BANK; attempt += 1) {
    const side = rng() < 0.5 ? -1 : 1;
    const d = 3 + rng() * (rng() < 0.7 ? 120 : 260);
    const e = riverEdges(d, side);
    const edge = side > 0 ? e.right : e.left;
    const x = edge + side * (rng() * 6 - 1.5);
    const z = -d;
    const s = riverShore(x, z);
    if (s < -1.5 || s > 8) continue;
    if (Math.abs(x) < DOCK_HALF_WIDTH + 1.5 && z > DOCK_END_Z - 2) continue;
    const r = 0.5 + Math.pow(rng(), 2) * 2.4;
    putRock(x, Math.max(riverHeight(x, z), -0.2) - 0.1 * r, z, r);
    n += 1;
  }

  // Rocks standing in the water, outside the area a lure can land in.
  for (let attempt = 0, n = 0; attempt < 40000 && n < WATER; attempt += 1) {
    const d = 4 + rng() * 240;
    const e = riverEdges(d, 1);
    const x = e.left + (e.right - e.left) * rng();
    const z = -d;
    const r = 0.5 + Math.pow(rng(), 2) * 2.2;
    if (riverShore(x, z) > -r - 1.5) continue;
    if (d < 104 && Math.abs(x) < Math.min(24, 0.86 * d) + r + 1.5) continue;
    putRock(x, -0.1 * r, z, r);
    position.set(x, 0.03, z - r * 1.8);
    scale.set(r * 2.4, 1, r * 4.2);
    foam.setMatrixAt(foamCount, matrix.compose(position, noRot, scale));
    foamCount += 1;
    n += 1;
  }
  rocks.count = placed;
  foam.count = foamCount;
  group.add(rocks, foam);
  nearObjects.push(foam);
}

// Pale streaks drifting downstream so the current reads even where the water is calm.
function buildRiverStreaks(group) {
  const COUNT = 90;
  const SPEED = 2.6;
  const rng = mulberry32(1919);
  const material = new THREE.MeshBasicMaterial({
    map: getSoftTexture(), transparent: true, opacity: 0.38, depthWrite: false, color: 0xdceef0,
  });
  const streaks = instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, COUNT);
  streaks.renderOrder = 1;
  const items = [];
  for (let i = 0; i < COUNT; i += 1) {
    items.push({ d: 4 + rng() * 150, u: rng(), w: 0.25 + rng() * 0.5, l: 3 + rng() * 6 });
  }
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  group.add(streaks);
  nearObjects.push(streaks);

  return (dt) => {
    for (let i = 0; i < COUNT; i += 1) {
      const it = items[i];
      it.d += SPEED * dt;
      if (it.d > 154) {
        it.d = 4;
        it.u = rng();
        it.w = 0.25 + rng() * 0.5;
        it.l = 3 + rng() * 6;
      }
      const e = riverEdges(it.d, 1);
      const x = e.left + 3 + (e.right - e.left - 6) * it.u;
      // Stay out of the lure's landing area so a streak never looks like a lure strike zone.
      const fade = smooth(4, 16, it.d) * (1 - smooth(110, 154, it.d));
      position.set(x, 0.04, -it.d);
      scale.set(it.w * fade, 1, it.l * fade + 0.001);
      streaks.setMatrixAt(i, matrix.compose(position, q, scale));
    }
    streaks.instanceMatrix.needsUpdate = true;
  };
}

// ---- Sky: clouds and seabirds -------------------------------------------------------
function cloudTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(777);
  for (let i = 0; i < 16; i += 1) {
    const x = 40 + rng() * 176;
    const y = 60 + (rng() - 0.5) * 26 - Math.abs(x - 128) * 0.12;
    const r = 20 + rng() * 26;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
  }
  // Flatten the underside.
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 70, 0, 100);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 256, 128);
  return new THREE.CanvasTexture(canvas);
}

function buildClouds(group, { count, seed, minY, maxY, brightness, opacity }) {
  const rng = mulberry32(seed);
  const material = new THREE.SpriteMaterial({
    map: cloudTexture(), transparent: true, depthWrite: false, fog: false, opacity,
    color: new THREE.Color().setRGB(brightness, brightness, brightness),
  });
  for (let i = 0; i < count; i += 1) {
    const sprite = new THREE.Sprite(material);
    const angle = (rng() - 0.5) * Math.PI * 0.95;
    const radius = 650 + rng() * 500;
    const width = 140 + rng() * 220;
    sprite.position.set(Math.sin(angle) * radius, minY + rng() * (maxY - minY), -Math.cos(angle) * radius);
    sprite.scale.set(width, width * 0.42, 1);
    group.add(sprite);
  }
}

function buildSeabirds(group) {
  const COUNT = 14;
  const rng = mulberry32(246);
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.13, 0, 0, -0.13, -0.95, 0.05, 0.02,
    0, 0, -0.13, 0, 0, 0.13, 0.95, 0.05, 0.02,
    0, 0.02, 0.28, 0, 0.02, -0.32, 0, -0.02, 0,
  ], 3));
  wing.computeVertexNormals();
  const birdTime = { value: 0 };
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBirdTime = birdTime;
    shader.vertexShader = `uniform float uBirdTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed.y += abs(transformed.x) * sin(uBirdTime * 7.0 + instanceMatrix[3].x * 0.37) * 0.32;`
    );
  };
  const birds = instanced(wing, material, COUNT);
  group.add(birds);
  nearObjects.push(birds);

  const flock = [];
  for (let i = 0; i < COUNT; i += 1) {
    flock.push({
      cx: (rng() - 0.5) * 80, cz: -100 - rng() * 60, r: 40 + rng() * 80, y: 7 + rng() * 22,
      a: rng() * Math.PI * 2, w: (0.18 + rng() * 0.2) * (rng() < 0.5 ? -1 : 1), size: 1.6 + rng() * 0.8,
    });
  }
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  return (dt, time) => {
    birdTime.value = time;
    for (let i = 0; i < COUNT; i += 1) {
      const b = flock[i];
      b.a += b.w * dt;
      const vx = -Math.sin(b.a) * Math.sign(b.w);
      const vz = Math.cos(b.a) * Math.sign(b.w);
      position.set(b.cx + Math.cos(b.a) * b.r, b.y + Math.sin(time * 0.7 + i) * 1.2, b.cz + Math.sin(b.a) * b.r);
      euler.set(0, Math.atan2(-vx, -vz), -0.35 * Math.sign(b.w));
      q.setFromEuler(euler);
      scale.setScalar(b.size);
      birds.setMatrixAt(i, matrix.compose(position, q, scale));
    }
    birds.instanceMatrix.needsUpdate = true;
  };
}

// ---- Docks -------------------------------------------------------------------------
let sharedWood = null;
function getWoodTexture() {
  if (!sharedWood) sharedWood = woodTexture();
  return sharedWood;
}

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

const DOCK_BACK_Z = 3.4;

function plankInstances(group, material, { seed, plankW, gap, tintFn }) {
  const rng = mulberry32(seed);
  const PLANK_H = 0.04;
  const length = DOCK_HALF_WIDTH * 2;
  const count = Math.ceil((DOCK_BACK_Z - DOCK_END_Z) / (plankW + gap));
  const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(length, PLANK_H, plankW), material, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const tint = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    const z = DOCK_END_Z + plankW / 2 + i * (plankW + gap);
    p.set((rng() - 0.5) * 0.05, DECK_Y - PLANK_H / 2 - (rng() < 0.2 ? 0.003 : 0), z);
    e.set(0, (rng() - 0.5) * 0.008, (rng() - 0.5) * 0.004);
    q.setFromEuler(e);
    planks.setMatrixAt(i, m.compose(p, q, s));
    tintFn(tint, rng);
    planks.setColorAt(i, tint);
  }
  group.add(planks);
}

function buildWoodDock() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    map: getWoodTexture(),
    roughness: 0.9,
    envMapIntensity: 0.5,
  });
  plankInstances(group, material, {
    seed: 5150, plankW: 0.145, gap: 0.012,
    tintFn: (tint, rng) => {
      const v = 0.68 + rng() * 0.42;
      tint.setRGB(v, v * (0.95 + rng() * 0.05), v * (0.86 + rng() * 0.1));
    },
  });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const postZ = [DOCK_BACK_Z - 0.3, 1.2, -0.7, -2.2, DOCK_END_Z + 0.08];
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
  group.add(posts);
  return group;
}

// A heavy, weathered sea pier: dark salt-grey planks, steel-capped bollards, tyre fenders and a
// lifebuoy. The end posts sit where the wooden dock's do, so the spare rod and net still fit.
function buildPier() {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ map: getWoodTexture(), roughness: 0.95, envMapIntensity: 0.3 });
  plankInstances(group, wood, {
    seed: 881, plankW: 0.19, gap: 0.016,
    tintFn: (tint, rng) => {
      const v = 0.36 + rng() * 0.3;
      tint.setRGB(v * 0.95, v * 0.97, v * (0.98 + rng() * 0.06));
    },
  });

  const dark = new THREE.MeshStandardMaterial({ color: 0x3e3b38, roughness: 0.9, envMapIntensity: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x2c3236, roughness: 0.5, metalness: 0.7, envMapIntensity: 0.8 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
  const length = DOCK_BACK_Z - DOCK_END_Z;
  const midZ = (DOCK_BACK_Z + DOCK_END_Z) / 2;

  // Stringers under the deck edge, and a low curb along it.
  const stringers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.26, length), dark, 2);
  const curbs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.09, length - 0.2), dark, 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  [-1, 1].forEach((side, i) => {
    stringers.setMatrixAt(i, m.compose(p.set(side * (DOCK_HALF_WIDTH - 0.08), DECK_Y - 0.17, midZ), q, one));
    curbs.setMatrixAt(i, m.compose(p.set(side * (DOCK_HALF_WIDTH - 0.02), DECK_Y + 0.045, midZ), q, one));
  });
  group.add(stringers, curbs);

  const postZ = [DOCK_BACK_Z - 0.3, 1.2, -0.7, -2.2, DOCK_END_Z + 0.08];
  const POST_BOTTOM = -2.6;
  const endPosts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.075, 0.09, 1, 10), dark, 2);
  const heavyCount = (postZ.length - 1) * 2;
  const heavyPosts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.14, 1, 10), dark, heavyCount);
  const bollards = new THREE.InstancedMesh(
    lathe([[0, 0], [0.09, 0], [0.085, 0.16], [0.12, 0.2], [0.12, 0.25], [0, 0.26]], 12), steel, heavyCount
  );
  let heavy = 0;
  postZ.forEach((z, zi) => {
    [-1, 1].forEach((side, si) => {
      const x = side * (DOCK_HALF_WIDTH + 0.03);
      if (zi === postZ.length - 1) {
        const top = DECK_Y + 0.95;
        endPosts.setMatrixAt(si, m.compose(p.set(x, (top + POST_BOTTOM) / 2, z), q, new THREE.Vector3(1, top - POST_BOTTOM, 1)));
      } else {
        const top = DECK_Y + 0.02;
        heavyPosts.setMatrixAt(heavy, m.compose(p.set(x, (top + POST_BOTTOM) / 2, z), q, new THREE.Vector3(1, top - POST_BOTTOM, 1)));
        bollards.setMatrixAt(heavy, m.compose(p.set(x, top - 0.02, z), q, one));
        heavy += 1;
      }
    });
  });
  group.add(endPosts, heavyPosts, bollards);

  // Tyre fenders hung against the outside piles, and a lifebuoy by the back post.
  const tyreZ = [-2.2, -0.7, 1.2];
  const tyres = new THREE.InstancedMesh(new THREE.TorusGeometry(0.2, 0.085, 8, 14), rubber, tyreZ.length * 2);
  let t = 0;
  for (const z of tyreZ) {
    for (const side of [-1, 1]) {
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
      tyres.setMatrixAt(t, m.compose(p.set(side * (DOCK_HALF_WIDTH + 0.27), 0.08, z), rot, one));
      t += 1;
    }
  }
  group.add(tyres);

  const buoyBands = [];
  for (let i = 0; i < 4; i += 1) {
    const hex = i % 2 === 0 ? 0xd9442b : 0xf2eee4;
    buoyBands.push(coloredGeometry(new THREE.TorusGeometry(0.3, 0.07, 6, 6, Math.PI / 2).rotateZ((i * Math.PI) / 2), hex));
  }
  const buoy = new THREE.Mesh(
    mergeGeometries(buoyBands),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })
  );
  buoy.position.set(DOCK_HALF_WIDTH + 0.17, DECK_Y + 0.45, 1.2);
  buoy.rotation.y = Math.PI / 2;
  group.add(buoy);
  return group;
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
  const propsGroup = new THREE.Group();
  scene.add(propsGroup);
  nearObjects.push(propsGroup);
  buildTackleBox();
  buildThermos();
  buildBucket();
  buildRope();
  buildLandingNet();
  buildSpareRod();

  propsGroup.add(new THREE.Mesh(
    mergeGeometries(batches.paint),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, envMapIntensity: 0.6 })
  ));
  propsGroup.add(new THREE.Mesh(
    mergeGeometries(batches.metal),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.85, envMapIntensity: 1 })
  ));
  propsGroup.add(new THREE.Mesh(
    mergeGeometries(batches.net),
    new THREE.MeshBasicMaterial({ vertexColors: true, wireframe: true, transparent: true, opacity: 0.75 })
  ));
  const shadows = new THREE.Mesh(
    mergeGeometries(batches.shadow),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadows.renderOrder = 1;
  propsGroup.add(shadows);
}

// The water's normals warp reflections of objects this close into dark jagged blobs.
// Objects of hidden maps are already invisible, so each one's visibility is put back as it was.
function hideFromReflection() {
  const renderWaterReflection = water.onBeforeRender;
  water.onBeforeRender = (renderer, scene, camera) => {
    const was = nearObjects.map((object) => object.visible);
    nearObjects.forEach((object) => { object.visible = false; });
    renderWaterReflection.call(water, renderer, scene, camera);
    nearObjects.forEach((object, i) => { object.visible = was[i]; });
  };
}

// ---- Maps, built the first time they are visited and then only shown or hidden ------
const DOCK_FOR_MAP = { pond: 'wood', river: 'wood', lake: 'wood', ocean: 'pier' };

function buildMapEntry(id) {
  const group = new THREE.Group();
  group.visible = false;
  sceneRef.add(group);
  let update = null;

  if (id === 'lake') {
    buildTerrain(group, LAKE_DEF);
    buildTrees(group);
    buildReeds(group, LAKE_REEDS);
  } else if (id === 'pond') {
    buildTerrain(group, POND_DEF);
    const mill = buildMill(group);
    buildLeafyTrees(group, mill);
    buildGrassTufts(group, mill);
    buildReeds(group, POND_REEDS);
    buildLilies(group);
    buildClouds(group, { count: 7, seed: 91, minY: 70, maxY: 190, brightness: 1.3, opacity: 0.8 });
  } else if (id === 'river') {
    buildTerrain(group, RIVER_DEF);
    buildRiverPines(group);
    buildRiverRocks(group);
    const streaks = buildRiverStreaks(group);
    buildClouds(group, { count: 6, seed: 17, minY: 100, maxY: 220, brightness: 1.15, opacity: 0.6 });
    update = (dt) => streaks(dt);
  } else if (id === 'ocean') {
    buildClouds(group, { count: 18, seed: 303, minY: 60, maxY: 220, brightness: 1.3, opacity: 0.85 });
    const birds = buildSeabirds(group);
    update = (dt, time) => birds(dt, time);
  }
  return { group, update };
}

// ---- Public API ----------------------------------------------------------------
export function buildWorld(scene, renderer) {
  sceneRef = scene;
  rendererRef = renderer;
  buildAtmosphere(scene, renderer);
  buildWater(scene);
  buildProps(scene);
  hideFromReflection();
  return { sunDirection: sunVector(MAP_STYLE.lake) };
}

// Shows one map's scenery and look. Unknown or missing ids fall back to the starter pond.
export function setWorldMap(mapId) {
  if (!sceneRef) return;
  const id = MAP_STYLE[mapId] ? mapId : 'pond';
  if (id === currentMapId) return;

  if (!mapEntries[id]) mapEntries[id] = buildMapEntry(id);
  const dockKind = DOCK_FOR_MAP[id];
  if (!docks[dockKind]) {
    docks[dockKind] = dockKind === 'pier' ? buildPier() : buildWoodDock();
    sceneRef.add(docks[dockKind]);
    nearObjects.push(docks[dockKind]);
  }
  for (const key of Object.keys(mapEntries)) mapEntries[key].group.visible = key === id;
  for (const key of Object.keys(docks)) docks[key].visible = key === dockKind;
  applyStyle(id);
  currentMapId = id;
}

export function updateWorld(dt, time) {
  if (water) water.material.uniforms.time.value += dt * 0.8;
  windTime.value = time;
  const entry = currentMapId && mapEntries[currentMapId];
  if (entry && entry.update) entry.update(dt, time);
}

// Test helpers: is there water at (x, z) on this map, and how many objects the world holds.
export function isWaterAt(mapId, x, z) {
  if (mapId === 'ocean') return true;
  const shore = { pond: pondShore, river: riverShore, lake: shoreDistance }[mapId];
  return shore(x, z) <= -0.5;
}

export function worldObjectCount() {
  let count = 0;
  sceneRef.traverse(() => { count += 1; });
  return { total: count, maps: Object.keys(mapEntries).length, docks: Object.keys(docks).length };
}
