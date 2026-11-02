// fishModels.js
// Procedural fish and lure models. A fish model is one unit long from snout (or bill) tip at
// x=+0.5 to tail tip at x=-0.5, with +Y up, so callers scale it by the fish's length in meters.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const RINGS = 30;
const RING_SIDES = 16;
const TEX_W = 512;
const TEX_H = 192;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Body loft
// ---------------------------------------------------------------------------

function catmull(a, b, c, d, t) {
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
}

// Stations are [u, top, bottom, halfWidth], with u running 0 at the snout to 1 at the tail joint.
function makeProfile(def) {
  const stations = def.stations;
  const at = (u) => {
    const clamped = Math.min(1, Math.max(0, u));
    let i = 0;
    while (i < stations.length - 2 && clamped > stations[i + 1][0]) i += 1;
    const p1 = stations[i];
    const p2 = stations[i + 1];
    const p0 = stations[Math.max(0, i - 1)];
    const p3 = stations[Math.min(stations.length - 1, i + 2)];
    const t = (clamped - p1[0]) / (p2[0] - p1[0] || 1);
    const pick = (k) => Math.max(0.0005, catmull(p0[k], p1[k], p2[k], p3[k], t));
    return { top: pick(1), bot: pick(2), w: pick(3) };
  };
  const x = (u) => 0.5 - (def.start + (def.end - def.start) * u);
  return { at, x };
}

function buildBody(def, profile) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= RINGS; i += 1) {
    const u = i / RINGS;
    const { top, bot, w } = profile.at(u);
    for (let j = 0; j < RING_SIDES; j += 1) {
      const angle = (j / RING_SIDES) * TAU;
      const c = Math.cos(angle);
      const y = c >= 0 ? top * c : bot * c;
      positions.push(profile.x(u), y, w * Math.sin(angle));
      uvs.push(u, (y + bot) / (top + bot));
    }
  }
  for (let i = 0; i < RINGS; i += 1) {
    for (let j = 0; j < RING_SIDES; j += 1) {
      const a = i * RING_SIDES + j;
      const b = i * RING_SIDES + (j + 1) % RING_SIDES;
      const c = a + RING_SIDES;
      const d = b + RING_SIDES;
      indices.push(a, b, c, b, d, c);
    }
  }
  // Close the snout and tail ends so no hole shows from any angle.
  const cap = (ring, flip) => {
    const center = positions.length / 3;
    const { top, bot } = profile.at(ring / RINGS);
    positions.push(profile.x(ring / RINGS), (top - bot) * 0.5, 0);
    uvs.push(ring / RINGS, 0.5);
    for (let j = 0; j < RING_SIDES; j += 1) {
      const a = ring * RING_SIDES + j;
      const b = ring * RING_SIDES + (j + 1) % RING_SIDES;
      if (flip) indices.push(center, b, a);
      else indices.push(center, a, b);
    }
  };
  cap(0, false);
  cap(RINGS, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Skin painting. u runs snout to tail, v runs belly (0) to back (1).
// ---------------------------------------------------------------------------

const px = (u) => u * TEX_W;
const py = (v) => (1 - v) * TEX_H;

function skin(ctx, back, flank, belly, line = 0.42) {
  const gradient = ctx.createLinearGradient(0, 0, 0, TEX_H);
  gradient.addColorStop(0, back);
  gradient.addColorStop(Math.max(0.05, 1 - line - 0.28), back);
  gradient.addColorStop(Math.min(0.9, 1 - line), flank);
  gradient.addColorStop(Math.min(0.97, 1 - line + 0.2), belly);
  gradient.addColorStop(1, belly);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
}

function bars(ctx, us, width, color, v0 = 0.3, v1 = 1) {
  ctx.fillStyle = color;
  for (const u of us) {
    const jitter = (Math.random() - 0.5) * 0.008;
    ctx.fillRect(px(u + jitter), py(v1), px(width), py(v0) - py(v1));
  }
}

function spots(ctx, count, color, u0, u1, v0, v1, r0, r1) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i += 1) {
    const r = r0 + Math.random() * (r1 - r0);
    ctx.beginPath();
    ctx.ellipse(
      px(u0 + Math.random() * (u1 - u0)),
      py(v0 + Math.random() * (v1 - v0)),
      r * (1 + Math.random() * 0.6),
      r,
      Math.random() * Math.PI,
      0,
      TAU
    );
    ctx.fill();
  }
}

function stripe(ctx, v, thickness, color, u0 = 0.12, u1 = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(px(u0), py(v + thickness / 2), px(u1 - u0), py(v - thickness / 2) - py(v + thickness / 2));
}

function blotchStripe(ctx, v, color, u0 = 0.18, u1 = 1) {
  ctx.fillStyle = color;
  for (let u = u0; u < u1; u += 0.028) {
    const size = 8 + Math.random() * 7;
    ctx.beginPath();
    ctx.ellipse(px(u), py(v + (Math.random() - 0.5) * 0.08), size * 1.5, size, 0, 0, TAU);
    ctx.fill();
  }
}

function gillCover(ctx, u, color = 'rgba(15,15,15,0.4)') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(px(u - 0.03), py(0.92));
  ctx.quadraticCurveTo(px(u + 0.035), py(0.5), px(u - 0.04), py(0.1));
  ctx.stroke();
}

function mouthLine(ctx, u, v, color = 'rgba(10,8,8,0.8)', width = 3) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(px(0), py(v + 0.04));
  ctx.quadraticCurveTo(px(u * 0.6), py(v - 0.05), px(u), py(v + 0.03));
  ctx.stroke();
}

function scales(ctx, color, u0 = 0.2, u1 = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  for (let row = 0; row < 12; row += 1) {
    const y = (row + 0.5) * (TEX_H / 12);
    for (let u = u0 + (row % 2) * 0.012; u < u1; u += 0.024) {
      ctx.beginPath();
      ctx.arc(px(u), y, 7, -1.1, 1.1);
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// Fins and small parts, merged into one vertex-coloured mesh.
// ---------------------------------------------------------------------------

class Parts {
  constructor(profile) {
    this.profile = profile;
    this.items = [];
    this.m = new THREE.Matrix4();
  }

  add(geometry, color) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.deleteAttribute('uv');
    const c = new THREE.Color(color);
    const count = flat.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.items.push(flat);
    return flat;
  }

  polygon(points) {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }

  // A fin on the back: points are [u, height above the body surface].
  dorsal(points, color) {
    const pts = points.map(([u, h]) => {
      const { top } = this.profile.at(u);
      return [this.profile.x(u), top * 0.92 + h];
    });
    this.add(this.polygon(pts), color);
  }

  anal(points, color) {
    const pts = points.map(([u, h]) => {
      const { bot } = this.profile.at(u);
      return [this.profile.x(u), -(bot * 0.92 + h)];
    });
    this.add(this.polygon(pts), color);
  }

  // Tail outline: points are [u past the tail joint, absolute y].
  tail(points, color) {
    this.add(this.polygon(points.map(([u, y]) => [this.profile.x(u), y])), color);
  }

  surface(u, v) {
    const { top, bot, w } = this.profile.at(u);
    const y = -bot + v * (top + bot);
    const ratio = y >= 0 ? y / top : y / bot;
    const z = w * Math.sqrt(Math.max(0, 1 - ratio * ratio));
    return new THREE.Vector3(this.profile.x(u), y, z);
  }

  // A pair of side fins: points are [dx, dy] from the base, tilted outward by the given angle.
  sideFins(u, v, points, tilt, color) {
    const base = this.surface(u, v);
    for (const side of [1, -1]) {
      const geometry = this.polygon(points);
      this.m.makeRotationX(side * tilt);
      geometry.applyMatrix4(this.m);
      geometry.translate(base.x, base.y, base.z * side);
      this.add(geometry, color);
    }
  }

  eye(u, v, radius, iris = 0xd8c98a) {
    const point = this.surface(u, v);
    for (const side of [1, -1]) {
      const white = new THREE.SphereGeometry(radius, 12, 8);
      white.translate(point.x, point.y, point.z * side);
      this.add(white, iris);
      const pupil = new THREE.SphereGeometry(radius * 0.62, 10, 6);
      pupil.translate(point.x + radius * 0.08, point.y, (point.z + radius * 0.62) * side);
      this.add(pupil, 0x050505);
    }
  }

  barbel(u, v, reachX, reachY, reachZ, radius, color) {
    const start = this.surface(u, v);
    for (const side of [1, -1]) {
      const a = new THREE.Vector3(start.x, start.y, start.z * side);
      const c = new THREE.Vector3(a.x + reachX, a.y + reachY, a.z + reachZ * side);
      const b = a.clone().lerp(c, 0.5);
      b.y += Math.abs(reachY) * 0.35;
      this.add(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, b, c), 6, radius, 4, false), color);
    }
  }

  // A tapered spike along X from x0 (thick end) to x1 (tip).
  spike(x0, x1, r0, r1, color, flatY = 1, y = 0) {
    const length = Math.abs(x1 - x0);
    const geometry = new THREE.CylinderGeometry(r1, r0, length, 10, 1);
    geometry.rotateZ(-Math.PI / 2);
    geometry.scale(1, flatY, 1);
    geometry.translate((x0 + x1) / 2, y, 0);
    this.add(geometry, color);
  }

  scuteRow(v, count, size, color, u0 = 0.2, u1 = 0.98) {
    for (let i = 0; i < count; i += 1) {
      const u = u0 + ((u1 - u0) * (i + 0.5)) / count;
      const point = this.surface(u, v);
      for (const side of v >= 0.99 ? [0] : [1, -1]) {
        const scute = new THREE.OctahedronGeometry(1, 0);
        scute.scale(size * 1.7, size * 0.75, size * 0.75);
        scute.translate(point.x, point.y, point.z * side);
        this.add(scute, color);
      }
    }
  }

  teeth(u0, u1, v, count, height, width, color, pointUp) {
    for (let i = 0; i < count; i += 1) {
      const u = u0 + ((u1 - u0) * i) / Math.max(1, count - 1);
      const point = this.surface(u, v);
      for (const side of [1, -1]) {
        const tooth = new THREE.ConeGeometry(width, height, 4);
        if (!pointUp) tooth.rotateX(Math.PI);
        tooth.translate(point.x, point.y + (pointUp ? height / 2 : -height / 2), (point.z + width * 0.5) * side);
        this.add(tooth, color);
      }
    }
  }

  build() {
    const merged = mergeGeometries(this.items, false);
    for (const item of this.items) item.dispose();
    this.items = [];
    merged.computeBoundingSphere();
    return merged;
  }
}

function pectoral(length, depth) {
  return [[0.002, 0], [-length * 0.55, depth * 0.35], [-length, -depth * 0.25], [-length * 0.45, -depth * 0.6], [0, -depth * 0.2]];
}

function forkedTail(p, joint, peduncle, spread, length, notch, color) {
  p.tail([
    [0.97, peduncle],
    [1 + length, spread],
    [1 + length * notch, 0],
    [1 + length, -spread],
    [0.97, -peduncle],
  ], color);
  void joint;
}

function roundTail(p, peduncle, spread, length, color) {
  p.tail([
    [0.97, peduncle],
    [1 + length * 0.75, spread],
    [1 + length, spread * 0.45],
    [1 + length, -spread * 0.45],
    [1 + length * 0.75, -spread],
    [0.97, -peduncle],
  ], color);
}

function heteroTail(p, peduncle, upperHeight, lowerHeight, length, color) {
  p.tail([
    [0.97, peduncle],
    [1 + length, upperHeight],
    [1 + length * 0.86, upperHeight * 0.55],
    [1 + length * 0.42, 0.012],
    [1 + length * 0.5, -lowerHeight],
    [1 + length * 0.2, -lowerHeight * 0.3],
    [0.97, -peduncle],
  ], color);
}

// ---------------------------------------------------------------------------
// Species definitions. length/refWeight anchor real size: meters at a weight in pounds.
// ---------------------------------------------------------------------------

const BASS_STATIONS = [[0, 0.012, 0.018, 0.012], [0.05, 0.045, 0.055, 0.032], [0.2, 0.1, 0.11, 0.06], [0.45, 0.125, 0.12, 0.065], [0.75, 0.085, 0.08, 0.04], [1, 0.032, 0.032, 0.012]];
const TROUT_STATIONS = [[0, 0.008, 0.012, 0.01], [0.06, 0.035, 0.04, 0.026], [0.22, 0.075, 0.075, 0.046], [0.48, 0.09, 0.09, 0.05], [0.78, 0.058, 0.055, 0.03], [1, 0.03, 0.03, 0.012]];
const PIKE_STATIONS = [[0, 0.006, 0.008, 0.016], [0.1, 0.016, 0.018, 0.028], [0.25, 0.04, 0.046, 0.038], [0.6, 0.054, 0.056, 0.04], [0.85, 0.05, 0.044, 0.028], [1, 0.024, 0.024, 0.01]];
const CAT_STATIONS = [[0, 0.012, 0.02, 0.022], [0.08, 0.04, 0.05, 0.078], [0.22, 0.07, 0.07, 0.09], [0.5, 0.08, 0.075, 0.06], [0.8, 0.055, 0.05, 0.03], [1, 0.03, 0.03, 0.012]];
const STURGEON_STATIONS = [[0, 0.004, 0.006, 0.012], [0.1, 0.022, 0.018, 0.038], [0.24, 0.05, 0.04, 0.054], [0.5, 0.062, 0.058, 0.055], [0.8, 0.036, 0.032, 0.028], [1, 0.016, 0.012, 0.008]];
const SHARK_STATIONS = [[0, 0.004, 0.006, 0.006], [0.07, 0.034, 0.024, 0.036], [0.2, 0.078, 0.066, 0.076], [0.42, 0.098, 0.088, 0.09], [0.72, 0.05, 0.045, 0.042], [1, 0.012, 0.011, 0.008]];

function fishCommon(p, { eyeU, eyeV, eyeR, fin }) {
  p.eye(eyeU, eyeV, eyeR);
  p.sideFins(0.3, 0.3, pectoral(0.08, 0.06), 1.0, fin);
  p.sideFins(0.52, 0.06, pectoral(0.055, 0.04), 1.2, fin);
}

function bassParts(fin, dark) {
  return (p) => {
    fishCommon(p, { eyeU: 0.14, eyeV: 0.66, eyeR: 0.016, fin });
    p.dorsal([[0.3, -0.01], [0.34, 0.07], [0.47, 0.05], [0.52, 0.015], [0.57, 0.055], [0.74, 0.04], [0.76, -0.01]], dark);
    p.anal([[0.68, -0.01], [0.72, 0.05], [0.84, 0.03], [0.86, -0.01]], fin);
    forkedTail(p, 1, 0.03, 0.085, 0.2, 0.72, dark);
  };
}

function troutParts(fin, adipose) {
  return (p) => {
    fishCommon(p, { eyeU: 0.12, eyeV: 0.66, eyeR: 0.013, fin });
    p.dorsal([[0.42, -0.01], [0.46, 0.05], [0.6, 0.03], [0.62, -0.01]], fin);
    p.dorsal([[0.8, -0.005], [0.83, 0.02], [0.87, -0.005]], adipose);
    p.anal([[0.7, -0.01], [0.73, 0.04], [0.85, 0.022], [0.86, -0.01]], fin);
    forkedTail(p, 1, 0.028, 0.075, 0.2, 0.84, fin);
  };
}

function pikeParts(fin) {
  return (p) => {
    p.eye(0.17, 0.82, 0.012);
    p.sideFins(0.3, 0.16, pectoral(0.06, 0.04), 1.1, fin);
    p.sideFins(0.58, 0.05, pectoral(0.05, 0.035), 1.2, fin);
    p.dorsal([[0.68, -0.01], [0.72, 0.045], [0.88, 0.03], [0.9, -0.01]], fin);
    p.anal([[0.72, -0.01], [0.76, 0.04], [0.89, 0.026], [0.9, -0.01]], fin);
    forkedTail(p, 1, 0.024, 0.066, 0.17, 0.72, fin);
    p.teeth(0.02, 0.13, 0.42, 7, 0.009, 0.0028, 0xf4f0e0, false);
  };
}

function catParts(fin, whisker, forked) {
  return (p) => {
    p.eye(0.09, 0.78, 0.008, 0xb8ad80);
    p.sideFins(0.24, 0.2, pectoral(0.075, 0.05), 1.05, fin);
    p.sideFins(0.55, 0.05, pectoral(0.05, 0.04), 1.2, fin);
    p.dorsal([[0.27, -0.01], [0.3, 0.09], [0.38, 0.055], [0.4, -0.01]], fin);
    p.dorsal([[0.78, -0.005], [0.8, 0.02], [0.86, 0.01], [0.87, -0.005]], fin);
    p.anal([[0.64, -0.01], [0.67, 0.045], [0.92, 0.03], [0.94, -0.01]], fin);
    if (forked) forkedTail(p, 1, 0.03, 0.07, 0.15, 0.7, fin);
    else roundTail(p, 0.03, 0.06, 0.14, fin);
    p.barbel(0.02, 0.8, -0.03, 0.04, 0.09, 0.0028, whisker);
    p.barbel(0.03, 0.42, -0.05, -0.05, 0.1, 0.0026, whisker);
    p.barbel(0.05, 0.1, -0.02, -0.055, 0.04, 0.002, whisker);
    p.barbel(0.08, 0.05, -0.01, -0.06, 0.05, 0.002, whisker);
  };
}

function sturgeonParts(fin, scute, belly) {
  return (p) => {
    p.eye(0.17, 0.72, 0.008, 0x8d8468);
    p.sideFins(0.26, 0.14, pectoral(0.08, 0.05), 1.2, fin);
    p.sideFins(0.62, 0.08, pectoral(0.04, 0.03), 1.2, fin);
    p.dorsal([[0.74, -0.005], [0.78, 0.045], [0.88, 0.016], [0.9, -0.005]], fin);
    p.anal([[0.74, -0.005], [0.78, 0.03], [0.86, 0.01], [0.88, -0.005]], fin);
    heteroTail(p, 0.014, 0.085, 0.03, 0.2, fin);
    p.scuteRow(1, 12, 0.0085, scute);
    p.scuteRow(0.55, 26, 0.0062, scute);
    p.scuteRow(0.14, 18, 0.005, scute, 0.26, 0.74);
    p.barbel(0.07, 0.02, 0.01, -0.03, 0.006, 0.0018, belly);
    p.barbel(0.08, 0.05, -0.008, -0.03, 0.012, 0.0018, belly);
  };
}

function sharkParts(fin, belly, opts) {
  return (p) => {
    p.eye(0.095, 0.72, 0.006, 0x0a0a0a);
    p.sideFins(0.28, 0.2, [[0.03, 0], [-0.04, -0.015], [-0.12, -0.13], [-0.045, -0.09], [-0.03, -0.012]], 0.95, fin);
    p.sideFins(0.67, 0.1, pectoral(0.05, 0.035), 1.0, fin);
    p.dorsal([[0.36, -0.01], [0.5, opts.dorsal], [0.56, opts.dorsal * 0.92], [0.53, -0.01]], fin);
    p.dorsal([[0.8, -0.005], [0.85, 0.022], [0.87, -0.005]], fin);
    p.anal([[0.78, -0.005], [0.83, 0.02], [0.85, -0.005]], fin);
    heteroTail(p, 0.014, opts.tailUp, opts.tailDown, 0.28, fin);
    if (opts.teeth) {
      p.teeth(0.035, 0.145, 0.29, 7, 0.016, 0.0052, 0xfbf8ec, false);
      p.teeth(0.05, 0.14, 0.18, 6, 0.012, 0.0042, 0xfbf8ec, true);
    }
    void belly;
  };
}

function sharkSkin(ctx, back, flank, belly, line, jagged) {
  skin(ctx, back, flank, belly, line);
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.moveTo(0, TEX_H);
  ctx.lineTo(0, py(line - 0.02));
  for (let u = 0; u <= 1.001; u += 0.03) {
    ctx.lineTo(px(u), py(line - 0.05 + (jagged ? Math.sin(u * 48) * 0.05 : 0)));
  }
  ctx.lineTo(TEX_W, TEX_H);
  ctx.fill();
  ctx.strokeStyle = 'rgba(12,14,18,0.8)';
  ctx.lineWidth = 2.6;
  for (let i = 0; i < 5; i += 1) {
    const u = 0.205 + i * 0.022;
    ctx.beginPath();
    ctx.moveTo(px(u), py(0.72));
    ctx.quadraticCurveTo(px(u + 0.012), py(0.5), px(u - 0.006), py(0.3));
    ctx.stroke();
  }
  // Open mouth, low on the head.
  ctx.fillStyle = 'rgba(58,16,20,0.96)';
  ctx.beginPath();
  ctx.moveTo(px(0.035), py(0.3));
  ctx.quadraticCurveTo(px(0.09), py(0.08), px(0.15), py(0.3));
  ctx.quadraticCurveTo(px(0.09), py(0.26), px(0.035), py(0.3));
  ctx.fill();
}

// Spots ringed by a pale halo (brown trout).
function haloSpots(ctx, count, core, halo, u0, u1, v0, v1, r0, r1) {
  for (let i = 0; i < count; i += 1) {
    const r = r0 + Math.random() * (r1 - r0);
    const x = px(u0 + Math.random() * (u1 - u0));
    const y = py(v0 + Math.random() * (v1 - v0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = core(i);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
}

// Wavy dark bars running down from the back (mackerel).
function waveBars(ctx, u0, u1, step, vTop, vBottom, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (let u = u0; u < u1; u += step) {
    ctx.beginPath();
    for (let k = 0; k <= 12; k += 1) {
      const t = k / 12;
      const v = vTop + (vBottom - vTop) * t;
      const x = px(u + Math.sin(t * 9 + u * 60) * 0.006);
      if (k === 0) ctx.moveTo(x, py(v));
      else ctx.lineTo(x, py(v));
    }
    ctx.stroke();
  }
}

// Vertical bars that fade out toward the belly (tiger shark).
function fadingBars(ctx, u0, u1, step, vTop, vFade, color) {
  for (let u = u0; u < u1; u += step) {
    const w = 8 + Math.random() * 7;
    const g = ctx.createLinearGradient(0, py(vTop), 0, py(vFade));
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(20,22,24,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(px(u), py(vTop));
    ctx.lineTo(px(u) + w, py(vTop));
    ctx.quadraticCurveTo(px(u) + w + 6, py((vTop + vFade) / 2), px(u) + w * 0.4, py(vFade));
    ctx.quadraticCurveTo(px(u) - 6, py((vTop + vFade) / 2), px(u), py(vTop));
    ctx.fill();
  }
}

// A small round dot on both faces of a fin.
function finDots(p, pts, radius, color) {
  for (const [u, h] of pts) {
    const { top } = p.profile.at(u);
    for (const z of [0.0015, -0.0015]) {
      const dot = new THREE.CircleGeometry(radius, 8);
      dot.translate(p.profile.x(u), top * 0.92 + h, z);
      p.add(dot, color);
    }
  }
}

const SPECIES = {
  pumpkinseed: {
    length: 0.15, refWeight: 0.4, leaps: false, start: 0, end: 0.84,
    stations: [[0, 0.012, 0.014, 0.01], [0.06, 0.055, 0.058, 0.03], [0.2, 0.165, 0.165, 0.055], [0.46, 0.225, 0.215, 0.066], [0.72, 0.15, 0.14, 0.05], [0.92, 0.055, 0.05, 0.02], [1, 0.04, 0.035, 0.012]],
    paint(ctx) {
      skin(ctx, '#4a5a2c', '#a39a46', '#e8892f', 0.45);
      spots(ctx, 60, 'rgba(200,100,30,0.55)', 0.3, 0.95, 0.35, 0.85, 2, 4);
      spots(ctx, 40, 'rgba(60,90,70,0.4)', 0.3, 0.95, 0.5, 0.95, 1.5, 3);
      bars(ctx, [0.32, 0.42, 0.52, 0.62, 0.72], 0.025, 'rgba(40,60,50,0.22)', 0.3);
      // Wavy blue-green streaks across the cheek.
      ctx.strokeStyle = 'rgba(70,170,200,0.9)';
      ctx.lineWidth = 2.4;
      for (const v of [0.38, 0.47, 0.56]) {
        ctx.beginPath();
        ctx.moveTo(px(0.05), py(v));
        for (let k = 1; k <= 8; k += 1) ctx.lineTo(px(0.05 + k * 0.016), py(v + Math.sin(k * 1.6) * 0.02 - k * 0.004));
        ctx.stroke();
      }
      // Black ear flap tipped with a red-orange spot.
      ctx.fillStyle = '#10141b';
      ctx.beginPath();
      ctx.ellipse(px(0.26), py(0.62), 15, 17, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e0431c';
      ctx.beginPath();
      ctx.ellipse(px(0.285), py(0.6), 7, 10, 0, 0, TAU);
      ctx.fill();
      gillCover(ctx, 0.23);
      mouthLine(ctx, 0.07, 0.46);
    },
    parts(p) {
      fishCommon(p, { eyeU: 0.14, eyeV: 0.65, eyeR: 0.024, fin: 0xb88a48 });
      p.dorsal([[0.25, -0.01], [0.3, 0.075], [0.55, 0.07], [0.7, 0.05], [0.8, -0.005]], 0x6b6a35);
      p.anal([[0.6, -0.01], [0.66, 0.06], [0.82, 0.03], [0.86, -0.005]], 0xc9843a);
      forkedTail(p, 1, 0.036, 0.1, 0.17, 0.86, 0xb5883f);
    },
  },
  black_crappie: {
    length: 0.3, refWeight: 1, leaps: false, start: 0, end: 0.84,
    stations: [[0, 0.012, 0.016, 0.01], [0.06, 0.06, 0.062, 0.028], [0.2, 0.18, 0.17, 0.05], [0.45, 0.245, 0.23, 0.058], [0.72, 0.17, 0.15, 0.045], [0.92, 0.06, 0.055, 0.02], [1, 0.04, 0.035, 0.01]],
    paint(ctx) {
      skin(ctx, '#4b5b43', '#b6c1ab', '#eef0e4', 0.5);
      spots(ctx, 130, 'rgba(24,30,24,0.8)', 0.14, 0.98, 0.15, 1, 2.2, 5.5);
      gillCover(ctx, 0.22, 'rgba(20,24,20,0.5)');
      mouthLine(ctx, 0.09, 0.47);
    },
    parts(p) {
      fishCommon(p, { eyeU: 0.12, eyeV: 0.66, eyeR: 0.025, fin: 0x9aa58f });
      p.dorsal([[0.46, -0.01], [0.5, 0.1], [0.7, 0.085], [0.8, -0.005]], 0x6f7e63);
      p.anal([[0.48, -0.01], [0.53, 0.095], [0.74, 0.06], [0.85, -0.005]], 0x8a9780);
      forkedTail(p, 1, 0.036, 0.1, 0.17, 0.82, 0x7d8b72);
      finDots(p, [[0.55, 0.05], [0.62, 0.055], [0.68, 0.04]], 0.004, 0x1c241c);
    },
  },
  brown_bullhead: {
    length: 0.3, refWeight: 1.5, leaps: false, start: 0, end: 0.86,
    stations: [[0, 0.012, 0.02, 0.024], [0.08, 0.036, 0.04, 0.074], [0.22, 0.068, 0.065, 0.085], [0.5, 0.078, 0.072, 0.06], [0.8, 0.055, 0.05, 0.03], [1, 0.03, 0.03, 0.012]],
    paint(ctx) {
      skin(ctx, '#5a4a28', '#8c7640', '#e4d49a', 0.34);
      spots(ctx, 50, 'rgba(30,24,12,0.35)', 0.1, 1, 0.4, 1, 3, 8);
      mouthLine(ctx, 0.06, 0.34, 'rgba(10,10,10,0.8)', 4);
    },
    parts(p) {
      p.eye(0.09, 0.76, 0.008, 0xb8ad80);
      p.sideFins(0.24, 0.2, pectoral(0.07, 0.05), 1.05, 0x6a5832);
      p.sideFins(0.55, 0.05, pectoral(0.05, 0.04), 1.2, 0x6a5832);
      p.dorsal([[0.27, -0.01], [0.3, 0.08], [0.38, 0.05], [0.4, -0.01]], 0x6a5832);
      p.dorsal([[0.78, -0.005], [0.8, 0.02], [0.86, 0.01], [0.87, -0.005]], 0x6a5832);
      p.anal([[0.64, -0.01], [0.67, 0.04], [0.92, 0.03], [0.94, -0.01]], 0x6a5832);
      roundTail(p, 0.03, 0.06, 0.12, 0x5a4a28);
      p.barbel(0.02, 0.8, -0.03, 0.03, 0.08, 0.0026, 0x1c1810);
      p.barbel(0.03, 0.4, -0.05, -0.05, 0.085, 0.0024, 0x1c1810);
      p.barbel(0.05, 0.1, -0.02, -0.055, 0.04, 0.002, 0xcbbd8a);
      p.barbel(0.08, 0.05, -0.01, -0.06, 0.05, 0.002, 0xcbbd8a);
    },
  },
  atlantic_mackerel: {
    length: 0.38, refWeight: 1.5, leaps: false, start: 0, end: 0.86,
    stations: [[0, 0.008, 0.01, 0.008], [0.08, 0.042, 0.042, 0.034], [0.28, 0.068, 0.066, 0.056], [0.48, 0.072, 0.07, 0.06], [0.74, 0.04, 0.04, 0.034], [0.92, 0.015, 0.015, 0.012], [1, 0.01, 0.01, 0.01]],
    paint(ctx) {
      skin(ctx, '#1f5c63', '#8ab6b8', '#f1f3ee', 0.5);
      waveBars(ctx, 0.12, 0.98, 0.026, 1, 0.55, 'rgba(10,26,40,0.78)', 2.4);
      gillCover(ctx, 0.2, 'rgba(14,30,36,0.5)');
      mouthLine(ctx, 0.08, 0.42);
    },
    parts(p) {
      fishCommon(p, { eyeU: 0.12, eyeV: 0.64, eyeR: 0.018, fin: 0x4f7478 });
      p.dorsal([[0.3, -0.01], [0.34, 0.07], [0.46, 0.012], [0.47, -0.01]], 0x2a5058);
      p.dorsal([[0.58, -0.01], [0.62, 0.04], [0.66, -0.01]], 0x2a5058);
      p.anal([[0.6, -0.01], [0.64, 0.035], [0.68, -0.01]], 0x7a9a96);
      for (const u of [0.72, 0.76, 0.8, 0.84, 0.88]) {
        p.dorsal([[u, -0.004], [u + 0.012, 0.016], [u + 0.02, -0.004]], 0x36666a);
        p.anal([[u, -0.004], [u + 0.012, 0.016], [u + 0.02, -0.004]], 0x9ab4b0);
      }
      p.tail([[0.99, 0.01], [1.15, 0.1], [1.07, 0.02], [1.07, -0.02], [1.15, -0.1], [0.99, -0.01]], 0x2a5058);
    },
  },
  brown_trout: {
    length: 0.55, refWeight: 5, leaps: true, start: 0, end: 0.84, stations: TROUT_STATIONS,
    paint(ctx) {
      skin(ctx, '#5a4a26', '#b79a52', '#efe3b8', 0.42);
      haloSpots(ctx, 55, () => 'rgba(28,20,14,0.92)', 'rgba(228,230,214,0.85)', 0.1, 1, 0.5, 1, 1.8, 3.2);
      haloSpots(ctx, 26, () => 'rgba(190,40,34,0.95)', 'rgba(228,232,222,0.85)', 0.2, 1, 0.38, 0.72, 1.6, 2.6);
      gillCover(ctx, 0.2, 'rgba(60,40,18,0.6)');
      mouthLine(ctx, 0.1, 0.43);
    },
    parts: troutParts(0x9a8650, 0x6f6234),
  },
  barracuda: {
    length: 1.05, refWeight: 12, leaps: true, start: 0, end: 0.86,
    stations: [[0, 0.006, 0.008, 0.008], [0.1, 0.022, 0.022, 0.024], [0.25, 0.04, 0.038, 0.034], [0.6, 0.052, 0.05, 0.04], [0.85, 0.042, 0.038, 0.026], [1, 0.02, 0.02, 0.01]],
    paint(ctx) {
      skin(ctx, '#3c4a50', '#a8b4b6', '#f1f2ee', 0.5);
      bars(ctx, [0.32, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.88], 0.022, 'rgba(18,24,28,0.6)', 0.55, 0.9);
      spots(ctx, 18, 'rgba(18,24,28,0.5)', 0.4, 0.95, 0.15, 0.5, 2, 4);
      gillCover(ctx, 0.2, 'rgba(20,26,30,0.5)');
      mouthLine(ctx, 0.14, 0.34, 'rgba(8,8,8,0.9)', 3);
    },
    parts(p) {
      p.eye(0.1, 0.7, 0.011, 0xd8d0a0);
      p.sideFins(0.3, 0.2, pectoral(0.05, 0.03), 1.1, 0x59666b);
      p.sideFins(0.52, 0.1, pectoral(0.04, 0.026), 1.2, 0x59666b);
      p.dorsal([[0.5, -0.01], [0.53, 0.035], [0.58, 0.03], [0.6, -0.01]], 0x3a464b);
      p.dorsal([[0.8, -0.005], [0.83, 0.03], [0.88, 0.012], [0.9, -0.005]], 0x3a464b);
      p.anal([[0.8, -0.005], [0.83, 0.03], [0.88, 0.012], [0.9, -0.005]], 0x59666b);
      forkedTail(p, 1, 0.022, 0.07, 0.17, 0.7, 0x2f3a3f);
      // Lower jaw juts past the upper, set with fangs.
      p.spike(0.5 - 0.07, 0.5 + 0.014, 0.009, 0.0018, 0x7c898c, 1, -0.006);
      p.teeth(0.01, 0.1, 0.32, 8, 0.012, 0.0032, 0xfbf8ec, false);
      p.teeth(0.01, 0.09, 0.2, 7, 0.011, 0.003, 0xfbf8ec, true);
    },
  },
  red_snapper: {
    length: 0.6, refWeight: 10, leaps: false, start: 0, end: 0.84,
    stations: [[0, 0.012, 0.014, 0.01], [0.05, 0.065, 0.05, 0.03], [0.18, 0.125, 0.1, 0.05], [0.45, 0.15, 0.13, 0.06], [0.75, 0.09, 0.075, 0.04], [1, 0.035, 0.035, 0.012]],
    paint(ctx) {
      skin(ctx, '#b43a3c', '#e07872', '#f4d6cc', 0.42);
      scales(ctx, 'rgba(130,30,34,0.35)');
      gillCover(ctx, 0.22, 'rgba(110,20,28,0.5)');
      mouthLine(ctx, 0.1, 0.42, 'rgba(90,16,20,0.8)');
    },
    parts(p) {
      fishCommon(p, { eyeU: 0.13, eyeV: 0.66, eyeR: 0.022, fin: 0xc8504c });
      p.eye(0.13, 0.66, 0.014, 0xd01a1a);
      // One continuous dorsal: spiny in front, soft and rounded behind.
      p.dorsal([[0.24, -0.01], [0.27, 0.055], [0.4, 0.06], [0.5, 0.05], [0.54, 0.075], [0.62, 0.07], [0.72, 0.03], [0.76, -0.005]], 0xb83e40);
      p.anal([[0.6, -0.01], [0.65, 0.07], [0.74, 0.05], [0.79, -0.005]], 0xd25f5a);
      forkedTail(p, 1, 0.034, 0.09, 0.15, 0.82, 0xb83e40);
    },
  },
  lake_trout: {
    length: 0.75, refWeight: 20, leaps: false, start: 0, end: 0.84, stations: TROUT_STATIONS,
    paint(ctx) {
      skin(ctx, '#3c4a40', '#7b8a78', '#e6e8dc', 0.4);
      spots(ctx, 150, 'rgba(214,220,196,0.78)', 0.08, 1, 0.38, 1, 2, 5);
      spots(ctx, 40, 'rgba(214,220,196,0.5)', 0.1, 1, 0.1, 0.4, 1.5, 3);
      gillCover(ctx, 0.2, 'rgba(24,32,26,0.5)');
      mouthLine(ctx, 0.12, 0.42);
    },
    parts(p) {
      fishCommon(p, { eyeU: 0.12, eyeV: 0.66, eyeR: 0.014, fin: 0x6b7766 });
      p.dorsal([[0.4, -0.01], [0.44, 0.052], [0.58, 0.03], [0.6, -0.01]], 0x56634f);
      p.dorsal([[0.8, -0.005], [0.83, 0.02], [0.87, -0.005]], 0x56634f);
      p.anal([[0.7, -0.01], [0.73, 0.04], [0.85, 0.022], [0.86, -0.01]], 0x7a8573);
      // Deeply forked tail.
      forkedTail(p, 1, 0.03, 0.1, 0.24, 0.5, 0x56634f);
    },
  },
  mahi_mahi: {
    length: 1.15, refWeight: 25, leaps: true, start: 0, end: 0.84,
    stations: [[0, 0.02, 0.03, 0.012], [0.04, 0.07, 0.06, 0.028], [0.12, 0.125, 0.09, 0.05], [0.3, 0.12, 0.09, 0.05], [0.55, 0.085, 0.065, 0.038], [0.8, 0.045, 0.04, 0.024], [1, 0.026, 0.026, 0.01]],
    paint(ctx) {
      skin(ctx, '#0c7a4a', '#c4b22e', '#f4ecb0', 0.46);
      stripe(ctx, 0.62, 0.22, 'rgba(70,200,120,0.5)', 0.1, 1);
      spots(ctx, 70, 'rgba(60,170,230,0.9)', 0.12, 1, 0.5, 0.98, 1.5, 3.2);
      spots(ctx, 40, 'rgba(30,60,50,0.55)', 0.2, 1, 0.12, 0.45, 2, 4);
      gillCover(ctx, 0.2, 'rgba(10,50,40,0.55)');
      mouthLine(ctx, 0.07, 0.36);
    },
    parts(p) {
      fishCommon(p, { eyeU: 0.09, eyeV: 0.6, eyeR: 0.016, fin: 0x4aa8a0 });
      // The dorsal runs from above the eye almost to the tail.
      p.dorsal([[0.08, -0.01], [0.1, 0.014], [0.16, 0.034], [0.5, 0.03], [0.8, 0.024], [0.88, -0.004]], 0x2c8fb0);
      p.anal([[0.46, -0.01], [0.52, 0.026], [0.8, 0.02], [0.88, -0.005]], 0xe0c63a);
      forkedTail(p, 1, 0.026, 0.11, 0.2, 0.62, 0x3fa46a);
    },
  },
  yellowfin_tuna: {
    length: 1.45, refWeight: 100, leaps: true, start: 0, end: 0.86,
    stations: [[0, 0.01, 0.012, 0.01], [0.08, 0.052, 0.056, 0.046], [0.26, 0.105, 0.105, 0.09], [0.46, 0.112, 0.11, 0.095], [0.72, 0.054, 0.054, 0.046], [0.92, 0.014, 0.014, 0.012], [1, 0.009, 0.009, 0.016]],
    paint(ctx) {
      skin(ctx, '#0b1f3a', '#8a9fae', '#eef0ea', 0.5);
      stripe(ctx, 0.56, 0.06, 'rgba(238,204,52,0.9)', 0.14, 0.94);
      stripe(ctx, 0.5, 0.022, 'rgba(95,130,190,0.6)', 0.14, 0.94);
      for (let u = 0.36; u < 0.9; u += 0.07) {
        spots(ctx, 4, 'rgba(240,245,245,0.4)', u, u + 0.006, 0.08, 0.3, 1.5, 2.6);
      }
      gillCover(ctx, 0.24, 'rgba(12,22,36,0.55)');
      mouthLine(ctx, 0.09, 0.42);
    },
    parts(p) {
      fishCommon(p, { eyeU: 0.13, eyeV: 0.6, eyeR: 0.015, fin: 0x12284a });
      p.dorsal([[0.34, -0.01], [0.38, 0.045], [0.5, 0.016], [0.52, -0.01]], 0xd8b930);
      // Long sickle second dorsal and anal, swept back.
      p.dorsal([[0.55, -0.01], [0.575, 0.09], [0.6, 0.055], [0.66, 0.028], [0.74, 0.006], [0.65, -0.01]], 0xf0d23a);
      p.anal([[0.57, -0.01], [0.595, 0.085], [0.62, 0.05], [0.68, 0.026], [0.76, 0.006], [0.67, -0.01]], 0xf0d23a);
      for (const u of [0.74, 0.78, 0.82, 0.86, 0.9]) {
        p.dorsal([[u, -0.004], [u + 0.016, 0.018], [u + 0.022, -0.004]], 0xf0d23a);
        p.anal([[u, -0.004], [u + 0.016, 0.018], [u + 0.022, -0.004]], 0xf0d23a);
      }
      p.tail([[0.99, 0.008], [1.16, 0.125], [1.1, 0.026], [1.1, -0.026], [1.16, -0.125], [0.99, -0.008]], 0x12284a);
    },
  },
  sailfish: {
    length: 2.4, refWeight: 100, leaps: true, start: 0.2, end: 0.88,
    stations: [[0, 0.012, 0.014, 0.012], [0.1, 0.044, 0.046, 0.034], [0.28, 0.066, 0.07, 0.044], [0.52, 0.06, 0.062, 0.04], [0.82, 0.024, 0.022, 0.018], [1, 0.008, 0.008, 0.01]],
    paint(ctx) {
      skin(ctx, '#0e2a5c', '#3d6fa8', '#e8eef0', 0.5);
      bars(ctx, [0.26, 0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68, 0.74, 0.8, 0.86, 0.92], 0.01, 'rgba(120,180,230,0.55)', 0.35, 0.85);
      gillCover(ctx, 0.17, 'rgba(8,20,50,0.6)');
      mouthLine(ctx, 0.08, 0.44);
    },
    parts(p) {
      p.spike(0.5 - 0.22, 0.5, 0.013, 0.0018, 0x0c1c40, 1, 0.004);
      p.eye(0.09, 0.62, 0.014, 0x7aa3c8);
      p.sideFins(0.22, 0.2, pectoral(0.08, 0.035), 1.1, 0x1a3f7c);
      p.sideFins(0.26, 0.05, [[0.01, 0], [-0.1, -0.02], [-0.11, -0.03], [-0.01, -0.012]], 0.8, 0x2a5a98);
      // The enormous sail, running nearly the full back.
      const sail = [[0.12, -0.01], [0.17, 0.09], [0.25, 0.15], [0.36, 0.165], [0.48, 0.145], [0.6, 0.1], [0.7, 0.05], [0.76, -0.005]];
      p.dorsal(sail, 0x1b3f86);
      finDots(p, [[0.22, 0.06], [0.27, 0.11], [0.3, 0.05], [0.34, 0.125], [0.38, 0.08], [0.42, 0.11], [0.45, 0.05], [0.5, 0.085], [0.54, 0.05], [0.58, 0.06], [0.31, 0.09], [0.4, 0.035]], 0.0075, 0x07122e);
      p.dorsal([[0.86, -0.003], [0.9, 0.02], [0.92, -0.003]], 0x1b3f86);
      p.anal([[0.56, -0.005], [0.62, 0.06], [0.7, 0.016], [0.74, -0.005]], 0x1b3f86);
      p.anal([[0.84, -0.003], [0.88, 0.018], [0.9, -0.003]], 0x1b3f86);
      p.tail([[0.99, 0.008], [1.18, 0.125], [1.11, 0.024], [1.11, -0.024], [1.18, -0.125], [0.99, -0.008]], 0x0f2a62);
    },
  },
  tiger_shark: {
    length: 3.4, refWeight: 600, leaps: false, surface: 'fin', start: 0, end: 0.78,
    stations: [[0, 0.016, 0.016, 0.02], [0.05, 0.05, 0.035, 0.07], [0.2, 0.09, 0.076, 0.092], [0.42, 0.108, 0.094, 0.1], [0.72, 0.054, 0.048, 0.046], [1, 0.012, 0.011, 0.008]],
    paint(ctx) {
      sharkSkin(ctx, '#5c5d52', '#8b8c80', '#ece9dc', 0.38, false);
      fadingBars(ctx, 0.24, 0.98, 0.036, 1, 0.38, 'rgba(24,26,26,0.7)');
      ctx.fillStyle = 'rgba(24,26,26,0.4)';
      ctx.fillRect(0, 0, TEX_W, py(0.9));
    },
    parts: sharkParts(0x5a5c52, 0xece9dc, { dorsal: 0.1, tailUp: 0.15, tailDown: 0.05, teeth: true }),
  },
  bluegill: {
    length: 0.22, refWeight: 0.8, leaps: false, start: 0, end: 0.84,
    stations: [[0, 0.012, 0.014, 0.01], [0.06, 0.055, 0.055, 0.03], [0.2, 0.16, 0.155, 0.055], [0.46, 0.22, 0.205, 0.065], [0.72, 0.15, 0.135, 0.05], [0.92, 0.055, 0.05, 0.02], [1, 0.04, 0.035, 0.012]],
    paint(ctx) {
      skin(ctx, '#31503f', '#6d8a57', '#dc9a45', 0.45);
      bars(ctx, [0.3, 0.4, 0.5, 0.6, 0.7, 0.8], 0.035, 'rgba(25,40,48,0.32)', 0.25);
      ctx.fillStyle = '#10141b';
      ctx.beginPath();
      ctx.ellipse(px(0.26), py(0.62), 17, 21, 0, 0, TAU);
      ctx.fill();
      gillCover(ctx, 0.23);
      mouthLine(ctx, 0.08, 0.46);
    },
    parts(p) {
      fishCommon(p, { eyeU: 0.14, eyeV: 0.65, eyeR: 0.024, fin: 0x54684a });
      p.dorsal([[0.25, -0.01], [0.3, 0.08], [0.55, 0.075], [0.7, 0.05], [0.8, -0.005]], 0x344a3d);
      p.anal([[0.6, -0.01], [0.66, 0.06], [0.82, 0.03], [0.86, -0.005]], 0x45583e);
      forkedTail(p, 1, 0.036, 0.11, 0.19, 0.84, 0x3f5540);
    },
  },
  rainbow_trout: {
    length: 0.55, refWeight: 4, leaps: true, start: 0, end: 0.84, stations: TROUT_STATIONS,
    paint(ctx) {
      skin(ctx, '#4a6b4e', '#b8bfa8', '#eeeadc', 0.42);
      stripe(ctx, 0.52, 0.2, 'rgba(226,84,112,0.72)', 0.1, 1);
      spots(ctx, 90, '#1a1c18', 0.08, 1, 0.5, 1, 1.5, 3.5);
      gillCover(ctx, 0.2, 'rgba(180,50,70,0.65)');
      mouthLine(ctx, 0.09, 0.43);
    },
    parts: troutParts(0x7b8a76, 0x53624f),
  },
  largemouth_bass: {
    length: 0.5, refWeight: 5, leaps: true, start: 0, end: 0.84, stations: BASS_STATIONS,
    paint(ctx) {
      skin(ctx, '#2d4a24', '#7c9153', '#e9e5c6', 0.42);
      blotchStripe(ctx, 0.52, 'rgba(18,28,14,0.85)');
      gillCover(ctx, 0.25);
      // The jaw runs back past the eye, which is what names the species.
      ctx.fillStyle = 'rgba(12,8,8,0.92)';
      ctx.beginPath();
      ctx.moveTo(px(0), py(0.36));
      ctx.lineTo(px(0.2), py(0.5));
      ctx.lineTo(px(0.19), py(0.42));
      ctx.lineTo(px(0), py(0.28));
      ctx.fill();
    },
    parts: bassParts(0x5d7044, 0x37502e),
  },
  smallmouth_bass: {
    length: 0.42, refWeight: 3.5, leaps: true, start: 0, end: 0.84, stations: BASS_STATIONS,
    paint(ctx) {
      skin(ctx, '#6e5a2b', '#a68f53', '#e7dcae', 0.4);
      bars(ctx, [0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76, 0.84, 0.92], 0.028, 'rgba(45,34,14,0.68)', 0.32);
      stripe(ctx, 0.62, 0.015, 'rgba(45,34,14,0.5)', 0.04, 0.22);
      gillCover(ctx, 0.22);
      mouthLine(ctx, 0.12, 0.43);
    },
    parts: bassParts(0x8a7648, 0x5e4d29),
  },
  common_carp: {
    length: 0.7, refWeight: 15, leaps: false, start: 0, end: 0.82,
    stations: [[0, 0.016, 0.018, 0.016], [0.08, 0.05, 0.05, 0.036], [0.22, 0.115, 0.09, 0.07], [0.42, 0.14, 0.105, 0.078], [0.72, 0.09, 0.07, 0.044], [1, 0.034, 0.032, 0.012]],
    paint(ctx) {
      skin(ctx, '#5e4a20', '#b58a37', '#ecd18a', 0.38);
      scales(ctx, 'rgba(50,30,6,0.5)');
      gillCover(ctx, 0.2);
      mouthLine(ctx, 0.045, 0.4);
    },
    parts(p) {
      fishCommon(p, { eyeU: 0.12, eyeV: 0.66, eyeR: 0.011, fin: 0x8a6d34 });
      p.dorsal([[0.34, -0.01], [0.38, 0.06], [0.76, 0.03], [0.8, -0.005]], 0x6b5426);
      p.anal([[0.72, -0.01], [0.76, 0.045], [0.86, 0.02], [0.88, -0.005]], 0x8a6d34);
      forkedTail(p, 1, 0.032, 0.09, 0.22, 0.72, 0x6b5426);
      p.barbel(0.02, 0.38, -0.01, -0.03, 0.012, 0.0024, 0xc9a65f);
    },
  },
  yellow_perch: {
    length: 0.28, refWeight: 1, leaps: false, start: 0, end: 0.84,
    stations: [[0, 0.01, 0.014, 0.012], [0.06, 0.04, 0.045, 0.028], [0.22, 0.095, 0.09, 0.05], [0.45, 0.115, 0.1, 0.056], [0.76, 0.07, 0.058, 0.032], [1, 0.03, 0.028, 0.011]],
    paint(ctx) {
      skin(ctx, '#596b23', '#d9c33a', '#f3e8b4', 0.38);
      bars(ctx, [0.28, 0.37, 0.46, 0.55, 0.64, 0.73, 0.82], 0.045, 'rgba(26,34,14,0.82)', 0.24);
      gillCover(ctx, 0.22);
      mouthLine(ctx, 0.09, 0.42);
    },
    parts(p) {
      fishCommon(p, { eyeU: 0.13, eyeV: 0.65, eyeR: 0.017, fin: 0xdd6a22 });
      p.dorsal([[0.26, -0.01], [0.3, 0.075], [0.48, 0.05], [0.52, 0.006], [0.58, 0.05], [0.74, 0.03], [0.76, -0.005]], 0x5e6a2b);
      p.anal([[0.68, -0.01], [0.72, 0.045], [0.84, 0.02], [0.86, -0.005]], 0xdd6a22);
      forkedTail(p, 1, 0.028, 0.075, 0.19, 0.84, 0x7a7d31);
    },
  },
  walleye: {
    length: 0.6, refWeight: 6, leaps: false, start: 0, end: 0.84, stations: TROUT_STATIONS,
    paint(ctx) {
      skin(ctx, '#49502c', '#a7a464', '#eee8cc', 0.4);
      spots(ctx, 120, 'rgba(36,40,18,0.45)', 0.14, 1, 0.45, 1, 3, 8);
      bars(ctx, [0.34, 0.48, 0.62, 0.76], 0.05, 'rgba(26,30,12,0.45)', 0.48);
      gillCover(ctx, 0.2);
      mouthLine(ctx, 0.11, 0.42);
    },
    parts(p) {
      fishCommon(p, { eyeU: 0.12, eyeV: 0.68, eyeR: 0.016, fin: 0x7a7a4d });
      p.eye(0.12, 0.68, 0.009, 0xf2f0c8);
      p.dorsal([[0.26, -0.01], [0.3, 0.06], [0.46, 0.04], [0.5, 0.004], [0.55, 0.045], [0.72, 0.03], [0.74, -0.005]], 0x3d4326);
      p.anal([[0.7, -0.01], [0.73, 0.04], [0.85, 0.02], [0.87, -0.005]], 0x8f8d5a);
      forkedTail(p, 1, 0.028, 0.075, 0.19, 0.76, 0x4d5430);
      p.teeth(0.03, 0.09, 0.46, 3, 0.008, 0.0024, 0xf4f0e0, false);
    },
  },
  atlantic_salmon: {
    length: 0.8, refWeight: 12, leaps: true, start: 0, end: 0.84, stations: TROUT_STATIONS,
    paint(ctx) {
      skin(ctx, '#39546a', '#c9d4d8', '#f3f4ef', 0.48);
      spots(ctx, 44, '#14171c', 0.1, 0.72, 0.6, 1, 2, 4.5);
      gillCover(ctx, 0.2, 'rgba(24,30,40,0.55)');
      mouthLine(ctx, 0.1, 0.42);
    },
    parts: troutParts(0x5a6f7e, 0x3d5163),
  },
  northern_pike: {
    length: 0.95, refWeight: 14, leaps: false, start: 0, end: 0.86, stations: PIKE_STATIONS,
    paint(ctx) {
      skin(ctx, '#2c4324', '#6f8848', '#efeac4', 0.4);
      spots(ctx, 95, 'rgba(232,226,160,0.9)', 0.22, 1, 0.3, 0.92, 3.5, 6);
      gillCover(ctx, 0.27);
      mouthLine(ctx, 0.17, 0.4, 'rgba(8,8,8,0.9)', 4);
    },
    parts: pikeParts(0x7b6d36),
  },
  muskellunge: {
    length: 1.25, refWeight: 30, leaps: false, start: 0, end: 0.86, stations: PIKE_STATIONS,
    paint(ctx) {
      skin(ctx, '#52542e', '#a7a56a', '#efead0', 0.38);
      bars(ctx, [0.28, 0.35, 0.42, 0.49, 0.56, 0.63, 0.7, 0.77, 0.84, 0.91], 0.03, 'rgba(26,28,14,0.72)', 0.2);
      spots(ctx, 40, 'rgba(26,28,14,0.55)', 0.26, 1, 0.3, 0.9, 3, 6);
      gillCover(ctx, 0.27);
      mouthLine(ctx, 0.17, 0.4, 'rgba(8,8,8,0.9)', 4);
    },
    parts: pikeParts(0x8c6b35),
  },
  striped_bass: {
    length: 0.9, refWeight: 20, leaps: true, start: 0, end: 0.84,
    stations: [[0, 0.01, 0.014, 0.012], [0.06, 0.04, 0.045, 0.03], [0.22, 0.085, 0.085, 0.056], [0.48, 0.1, 0.095, 0.06], [0.78, 0.062, 0.058, 0.032], [1, 0.03, 0.03, 0.012]],
    paint(ctx) {
      skin(ctx, '#39505a', '#cfd5d4', '#f4f4ee', 0.5);
      for (const v of [0.42, 0.5, 0.58, 0.66, 0.74, 0.82, 0.9]) stripe(ctx, v, 0.024, 'rgba(18,22,26,0.82)', 0.2, 0.98);
      gillCover(ctx, 0.22);
      mouthLine(ctx, 0.12, 0.42);
    },
    parts: bassParts(0x8c979b, 0x46555c),
  },
  channel_catfish: {
    length: 0.7, refWeight: 12, leaps: false, start: 0, end: 0.86, stations: CAT_STATIONS,
    paint(ctx) {
      skin(ctx, '#4c5a62', '#8d9aa0', '#eeeee4', 0.34);
      spots(ctx, 60, '#14181b', 0.2, 1, 0.42, 0.95, 2, 4);
      mouthLine(ctx, 0.06, 0.34, 'rgba(10,10,10,0.8)', 4);
    },
    parts: catParts(0x57646b, 0x25292b, true),
  },
  flathead_catfish: {
    length: 1.05, refWeight: 40, leaps: false, start: 0, end: 0.87,
    stations: [[0, 0.01, 0.02, 0.03], [0.08, 0.026, 0.05, 0.1], [0.22, 0.05, 0.07, 0.115], [0.5, 0.075, 0.075, 0.065], [0.8, 0.055, 0.05, 0.032], [1, 0.03, 0.03, 0.012]],
    paint(ctx) {
      skin(ctx, '#4d3d1e', '#88703d', '#e6dcb4', 0.32);
      spots(ctx, 60, 'rgba(32,24,10,0.7)', 0.05, 1, 0.34, 1, 6, 15);
      mouthLine(ctx, 0.06, 0.32, 'rgba(10,10,10,0.8)', 4);
    },
    parts: catParts(0x67542c, 0x2c2413, false),
  },
  blue_catfish: {
    length: 1.2, refWeight: 60, leaps: false, start: 0, end: 0.86, stations: CAT_STATIONS,
    paint(ctx) {
      skin(ctx, '#2f4a66', '#6d8aa6', '#f0f2ee', 0.36);
      mouthLine(ctx, 0.06, 0.34, 'rgba(8,10,14,0.85)', 4);
    },
    parts: catParts(0x3b5674, 0x161e28, true),
  },
  lake_sturgeon: {
    length: 1.6, refWeight: 120, leaps: false, start: 0, end: 0.82, stations: STURGEON_STATIONS,
    paint(ctx) {
      skin(ctx, '#3d3a30', '#756f58', '#d9d4bc', 0.34);
      spots(ctx, 60, 'rgba(24,22,16,0.4)', 0.1, 1, 0.45, 1, 4, 11);
    },
    parts: sturgeonParts(0x4a4739, 0xcfc8ac, 0xb9b294),
  },
  beluga_sturgeon: {
    length: 3.6, refWeight: 1500, leaps: false, start: 0, end: 0.83,
    stations: [[0, 0.006, 0.008, 0.016], [0.1, 0.03, 0.022, 0.05], [0.24, 0.06, 0.05, 0.068], [0.5, 0.08, 0.075, 0.07], [0.8, 0.044, 0.038, 0.032], [1, 0.016, 0.012, 0.008]],
    paint(ctx) {
      skin(ctx, '#23303a', '#5d6f78', '#e8ebe2', 0.36);
      spots(ctx, 70, 'rgba(12,18,24,0.42)', 0.1, 1, 0.5, 1, 6, 16);
    },
    parts: sturgeonParts(0x2b3942, 0xe2e4d6, 0xb9c0b8),
  },
  alligator_gar: {
    length: 2.0, refWeight: 150, leaps: false, start: 0, end: 0.88,
    stations: [[0, 0.004, 0.005, 0.009], [0.09, 0.008, 0.01, 0.016], [0.18, 0.016, 0.02, 0.024], [0.27, 0.036, 0.038, 0.036], [0.55, 0.05, 0.05, 0.042], [0.84, 0.04, 0.036, 0.028], [1, 0.022, 0.02, 0.01]],
    paint(ctx) {
      skin(ctx, '#3c4627', '#7f8751', '#dcd7b0', 0.36);
      ctx.strokeStyle = 'rgba(20,24,12,0.45)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 44; i += 1) {
        const u = 0.28 + i * 0.0165;
        ctx.beginPath();
        ctx.moveTo(px(u), 0);
        ctx.lineTo(px(u + 0.08), TEX_H);
        ctx.moveTo(px(u + 0.08), 0);
        ctx.lineTo(px(u), TEX_H);
        ctx.stroke();
      }
      spots(ctx, 34, 'rgba(18,20,10,0.75)', 0.45, 1, 0.3, 0.95, 4, 9);
      mouthLine(ctx, 0.22, 0.44, 'rgba(6,6,6,0.95)', 3);
    },
    parts(p) {
      p.eye(0.215, 0.78, 0.008);
      p.sideFins(0.32, 0.12, pectoral(0.055, 0.036), 1.1, 0x6e6c3e);
      p.sideFins(0.6, 0.06, pectoral(0.05, 0.03), 1.2, 0x6e6c3e);
      p.dorsal([[0.77, -0.005], [0.8, 0.04], [0.9, 0.024], [0.92, -0.005]], 0x53552f);
      p.anal([[0.78, -0.005], [0.81, 0.036], [0.9, 0.02], [0.92, -0.005]], 0x6e6c3e);
      roundTail(p, 0.022, 0.05, 0.12, 0x53552f);
      p.teeth(0.02, 0.215, 0.52, 16, 0.009, 0.0024, 0xf6f2e2, false);
      p.teeth(0.03, 0.2, 0.42, 14, 0.008, 0.0022, 0xf6f2e2, true);
    },
  },
  paddlefish: {
    length: 1.5, refWeight: 90, leaps: false, start: 0.27, end: 0.88,
    stations: [[0, 0.012, 0.016, 0.018], [0.12, 0.05, 0.055, 0.044], [0.3, 0.07, 0.074, 0.054], [0.6, 0.07, 0.066, 0.05], [0.85, 0.042, 0.038, 0.026], [1, 0.02, 0.02, 0.01]],
    paint(ctx) {
      skin(ctx, '#3f4c58', '#7a8894', '#e9ebe6', 0.36);
      gillCover(ctx, 0.3, 'rgba(14,18,22,0.6)');
      mouthLine(ctx, 0.2, 0.4, 'rgba(10,10,12,0.9)', 5);
    },
    parts(p) {
      // The paddle snout: long, flat and rounded at the end.
      const paddle = new THREE.SphereGeometry(1, 18, 10);
      paddle.scale(0.145, 0.0055, 0.04);
      paddle.translate(0.5 - 0.145, 0, 0);
      p.add(paddle, 0x54626e);
      p.eye(0.05, 0.56, 0.006);
      p.sideFins(0.28, 0.16, pectoral(0.07, 0.04), 1.1, 0x3f4c58);
      p.sideFins(0.6, 0.06, pectoral(0.05, 0.03), 1.2, 0x3f4c58);
      p.dorsal([[0.56, -0.005], [0.62, 0.05], [0.72, 0.02], [0.74, -0.005]], 0x36424d);
      p.anal([[0.62, -0.005], [0.66, 0.045], [0.76, 0.016], [0.78, -0.005]], 0x48555f);
      heteroTail(p, 0.02, 0.075, 0.055, 0.2, 0x36424d);
    },
  },
  bluefin_tuna: {
    length: 2.1, refWeight: 500, leaps: true, start: 0, end: 0.86,
    stations: [[0, 0.01, 0.012, 0.01], [0.08, 0.055, 0.06, 0.05], [0.26, 0.112, 0.115, 0.1], [0.46, 0.12, 0.122, 0.105], [0.72, 0.058, 0.06, 0.05], [0.92, 0.014, 0.014, 0.012], [1, 0.009, 0.009, 0.016]],
    paint(ctx) {
      skin(ctx, '#0d2340', '#7b95a8', '#eef2ef', 0.5);
      for (let u = 0.34; u < 0.9; u += 0.05) {
        spots(ctx, 7, 'rgba(240,245,245,0.5)', u, u + 0.006, 0.08, 0.42, 1.5, 3);
      }
      stripe(ctx, 0.52, 0.03, 'rgba(204,190,110,0.5)', 0.14, 0.9);
      gillCover(ctx, 0.24, 'rgba(12,22,36,0.55)');
      mouthLine(ctx, 0.09, 0.42);
    },
    parts(p) {
      fishCommon(p, { eyeU: 0.13, eyeV: 0.6, eyeR: 0.016, fin: 0x12284a });
      p.dorsal([[0.34, -0.01], [0.38, 0.065], [0.52, 0.018], [0.54, -0.01]], 0x12284a);
      p.dorsal([[0.56, -0.01], [0.62, 0.095], [0.63, 0.012], [0.67, -0.01]], 0xc5a93b);
      p.anal([[0.58, -0.01], [0.64, 0.09], [0.65, 0.012], [0.69, -0.01]], 0xc5a93b);
      for (const u of [0.7, 0.745, 0.79, 0.835, 0.88, 0.925]) {
        p.dorsal([[u, -0.004], [u + 0.018, 0.018], [u + 0.024, -0.004]], 0xe6c83a);
        p.anal([[u, -0.004], [u + 0.018, 0.018], [u + 0.024, -0.004]], 0xe6c83a);
      }
      // A thin crescent tail on a narrow joint.
      p.tail([
        [0.99, 0.008],
        [1 + 0.16, 0.13],
        [1 + 0.1, 0.026],
        [1 + 0.1, -0.026],
        [1 + 0.16, -0.13],
        [0.99, -0.008],
      ], 0x12284a);
    },
  },
  swordfish: {
    length: 2.9, refWeight: 600, leaps: true, start: 0.28, end: 0.88,
    stations: [[0, 0.012, 0.016, 0.018], [0.1, 0.04, 0.045, 0.04], [0.26, 0.078, 0.082, 0.07], [0.5, 0.074, 0.076, 0.064], [0.82, 0.026, 0.024, 0.024], [1, 0.009, 0.009, 0.012]],
    paint(ctx) {
      skin(ctx, '#20201f', '#5e5a55', '#d8d4cb', 0.48);
      gillCover(ctx, 0.2, 'rgba(10,10,10,0.6)');
      mouthLine(ctx, 0.08, 0.42);
    },
    parts(p) {
      // Long and flat in cross-section: the sword.
      p.spike(0.5 - 0.3, 0.5, 0.032, 0.0025, 0x1f1e1d, 0.28);
      p.eye(0.1, 0.62, 0.016, 0x3c6e8a);
      p.sideFins(0.24, 0.2, [[0.02, 0], [-0.02, -0.01], [-0.12, -0.1], [-0.05, -0.08], [-0.015, -0.02]], 1, 0x2a2927);
      p.dorsal([[0.14, -0.01], [0.2, 0.125], [0.24, 0.1], [0.27, 0.024], [0.34, -0.005]], 0x1b1a19);
      p.dorsal([[0.88, -0.003], [0.92, 0.024], [0.94, -0.003]], 0x1b1a19);
      p.anal([[0.56, -0.005], [0.62, 0.07], [0.65, 0.02], [0.7, -0.005]], 0x2a2927);
      p.tail([
        [0.99, 0.008],
        [1 + 0.2, 0.12],
        [1 + 0.12, 0.024],
        [1 + 0.12, -0.024],
        [1 + 0.2, -0.12],
        [0.99, -0.008],
      ], 0x1b1a19);
    },
  },
  blue_marlin: {
    length: 3.3, refWeight: 900, leaps: true, start: 0.2, end: 0.87,
    stations: [[0, 0.018, 0.018, 0.016], [0.1, 0.05, 0.052, 0.04], [0.28, 0.082, 0.088, 0.062], [0.52, 0.072, 0.074, 0.054], [0.82, 0.026, 0.024, 0.02], [1, 0.009, 0.009, 0.01]],
    paint(ctx) {
      skin(ctx, '#0a2a72', '#2f6cb2', '#eef3f5', 0.5);
      const stripes = [];
      for (let u = 0.22; u < 0.96; u += 0.055) stripes.push(u);
      bars(ctx, stripes, 0.012, 'rgba(120,210,245,0.85)', 0.28, 0.96);
      gillCover(ctx, 0.17, 'rgba(8,20,50,0.65)');
      mouthLine(ctx, 0.08, 0.44);
    },
    parts(p) {
      // Round spear of a bill.
      p.spike(0.5 - 0.22, 0.5, 0.016, 0.0022, 0x0b1e4a, 1, 0.006);
      p.eye(0.09, 0.6, 0.016, 0x7aa3c8);
      p.sideFins(0.2, 0.22, pectoral(0.1, 0.05), 1.1, 0x0d2a66);
      // Tall sail along the back, the marlin's giveaway.
      p.dorsal([[0.14, -0.01], [0.19, 0.17], [0.27, 0.125], [0.42, 0.06], [0.6, 0.026], [0.72, 0.012], [0.74, -0.005]], 0x10357a);
      p.dorsal([[0.86, -0.003], [0.9, 0.022], [0.92, -0.003]], 0x10357a);
      p.anal([[0.56, -0.005], [0.62, 0.075], [0.7, 0.02], [0.76, -0.005]], 0x10357a);
      p.anal([[0.84, -0.003], [0.88, 0.02], [0.9, -0.003]], 0x10357a);
      p.tail([
        [0.99, 0.008],
        [1 + 0.21, 0.135],
        [1 + 0.12, 0.024],
        [1 + 0.12, -0.024],
        [1 + 0.21, -0.135],
        [0.99, -0.008],
      ], 0x0b2a68);
    },
  },
  bull_shark: {
    length: 2.3, refWeight: 350, leaps: false, surface: 'fin', start: 0, end: 0.78,
    stations: [[0, 0.012, 0.012, 0.012], [0.06, 0.05, 0.036, 0.06], [0.2, 0.09, 0.076, 0.094], [0.42, 0.112, 0.098, 0.104], [0.72, 0.054, 0.048, 0.046], [1, 0.012, 0.011, 0.008]],
    paint(ctx) { sharkSkin(ctx, '#4a5258', '#7f888d', '#f0f0ea', 0.36, false); },
    parts: sharkParts(0x4c555b, 0xf0f0ea, { dorsal: 0.1, tailUp: 0.115, tailDown: 0.05, teeth: true }),
  },
  great_white_shark: {
    length: 4.6, refWeight: 2500, leaps: false, surface: 'fin', start: 0, end: 0.78, stations: SHARK_STATIONS,
    paint(ctx) { sharkSkin(ctx, '#3d464f', '#6a747c', '#f7f7f2', 0.4, true); },
    parts: sharkParts(0x3f4951, 0xf7f7f2, { dorsal: 0.115, tailUp: 0.13, tailDown: 0.085, teeth: true }),
  },
};

function genericDef(hex) {
  const flank = new THREE.Color(hex);
  const css = (c) => `#${c.getHexString()}`;
  return {
    length: 0.6,
    refWeight: 6,
    leaps: false,
    start: 0,
    end: 0.84,
    stations: BASS_STATIONS,
    paint(ctx) {
      skin(ctx, css(flank.clone().multiplyScalar(0.45)), css(flank), css(flank.clone().lerp(new THREE.Color(0xf1ead6), 0.8)), 0.42);
      gillCover(ctx, 0.22);
      mouthLine(ctx, 0.1, 0.43);
    },
    parts: bassParts(flank.clone().multiplyScalar(0.7).getHex(), flank.clone().multiplyScalar(0.5).getHex()),
  };
}

// ---------------------------------------------------------------------------
// Model assembly
// ---------------------------------------------------------------------------

function installBend(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBend = uniforms.uBend;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBend;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float bendT = clamp((0.28 - position.x) / 0.78, 0.0, 1.0);
        transformed.z += uBend.x * bendT * bendT * sin(position.x * uBend.y + uBend.z);`
      );
  };
  material.customProgramCacheKey = () => 'fish-bend';
}

function paintTexture(def) {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  def.paint(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const modelCache = new Map();

export function createFishModel(speciesId, colorHex = 0x4d7a8c) {
  const known = Object.prototype.hasOwnProperty.call(SPECIES, speciesId);
  const key = known ? speciesId : `generic:${colorHex}`;
  if (modelCache.has(key)) return modelCache.get(key);

  const def = known ? SPECIES[speciesId] : genericDef(colorHex);
  const profile = makeProfile(def);
  const uniforms = { uBend: { value: new THREE.Vector3(0, 7, 0) } };

  const bodyMaterial = new THREE.MeshStandardMaterial({
    map: paintTexture(def),
    roughness: 0.38,
    metalness: 0.08,
  });
  installBend(bodyMaterial, uniforms);

  const partMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  installBend(partMaterial, uniforms);

  const parts = new Parts(profile);
  def.parts(parts);

  const group = new THREE.Group();
  group.add(new THREE.Mesh(buildBody(def, profile), bodyMaterial));
  group.add(new THREE.Mesh(parts.build(), partMaterial));

  let top = 0;
  let bottom = 0;
  for (const station of def.stations) {
    top = Math.max(top, station[1]);
    bottom = Math.max(bottom, station[2]);
  }

  const model = {
    group,
    leaps: def.leaps,
    surfaceMode: def.surface || 'back',
    top,
    bottom,
    mouth: new THREE.Vector3(profile.x(0.02), 0, 0),
    lengthFor(weightLb) {
      const ratio = Math.max(0.02, (weightLb || def.refWeight) / def.refWeight);
      return THREE.MathUtils.clamp(def.length * Math.cbrt(ratio), 0.12, 6.5);
    },
    setSwim(amplitude, phase) {
      uniforms.uBend.value.x = amplitude;
      uniforms.uBend.value.z = phase;
    },
  };
  modelCache.set(key, model);
  return model;
}

// ---------------------------------------------------------------------------
// Lures. Origin is the line tie at the top, with the lure hanging along -Y.
// ---------------------------------------------------------------------------

const lureCache = new Map();

function lureMaterial(color, roughness = 0.4, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addHook(group, y, material) {
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0022, 5, 10, Math.PI * 1.4), material);
  hook.position.set(0, y, 0);
  hook.rotation.z = Math.PI * 0.9;
  group.add(hook);
}

const LURE_BUILDERS = {
  bobber(group) {
    const radius = 0.06;
    const top = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 8, 0, TAU, 0, Math.PI / 2), lureMaterial(0xd8261c, 0.35));
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 8, 0, TAU, Math.PI / 2, Math.PI / 2), lureMaterial(0xf4f1e8));
    const band = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.005, 6, 18), lureMaterial(0x1b1b1b, 0.6));
    band.rotation.x = Math.PI / 2;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8), lureMaterial(0xf4f1e8));
    stem.position.y = radius + 0.02;
    group.add(top, bottom, band, stem);
    return { flat: false, spin: null };
  },
  spinner(group) {
    const silver = lureMaterial(0xdfe5e8, 0.18, 1);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.14, 6), silver);
    wire.position.y = -0.07;
    group.add(wire);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), lureMaterial(0xe0a81f, 0.3, 0.6));
    body.scale.y = 1.7;
    body.position.y = -0.1;
    group.add(body);
    const spin = new THREE.Group();
    spin.position.y = -0.04;
    const blade = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 8), lureMaterial(0xf2d24a, 0.14, 1));
    blade.scale.set(0.62, 1.05, 0.08);
    blade.position.x = 0.03;
    spin.add(blade);
    group.add(spin);
    addHook(group, -0.145, lureMaterial(0x22262a, 0.4, 0.7));
    return { flat: true, spin };
  },
  jig(group) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), lureMaterial(0xe8501e, 0.3, 0.2));
    head.position.y = -0.03;
    group.add(head);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), lureMaterial(0xf8f4d8));
    eye.position.set(0.024, -0.024, 0.016);
    group.add(eye);
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.1, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0x1f8f4c, roughness: 0.7, side: THREE.DoubleSide }));
    skirt.position.y = -0.1;
    skirt.rotation.x = 0;
    group.add(skirt);
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * TAU;
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.0012, 0.08, 4), lureMaterial(i % 2 ? 0xf0d030 : 0x1f8f4c, 0.7));
      strand.position.set(Math.cos(angle) * 0.03, -0.16, Math.sin(angle) * 0.03);
      group.add(strand);
    }
    addHook(group, -0.17, lureMaterial(0x22262a, 0.4, 0.7));
    return { flat: true, spin: null };
  },
  spoon(group) {
    const spoon = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), new THREE.MeshStandardMaterial({ color: 0xe6e9ec, roughness: 0.12, metalness: 1, side: THREE.DoubleSide }));
    spoon.scale.set(0.58, 1.5, 0.14);
    spoon.position.y = -0.075;
    group.add(spoon);
    const stripeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.016), lureMaterial(0xd42a22, 0.3));
    stripeMesh.position.y = -0.075;
    group.add(stripeMesh);
    addHook(group, -0.15, lureMaterial(0x22262a, 0.4, 0.7));
    return { flat: true, spin: null };
  },
  crankbait(group) {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), lureMaterial(0x2f8a5c, 0.28, 0.3));
    body.scale.set(0.75, 2.1, 1);
    body.position.y = -0.075;
    group.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 8), lureMaterial(0xf1d348, 0.3));
    belly.scale.set(0.7, 1.9, 1);
    belly.position.set(0, -0.075, 0.012);
    group.add(belly);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.003), new THREE.MeshStandardMaterial({ color: 0xcfe7f2, transparent: true, opacity: 0.65, roughness: 0.2 }));
    lip.position.set(0, -0.012, 0.012);
    lip.rotation.x = 0.7;
    group.add(lip);
    for (const side of [1, -1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 8, 6), lureMaterial(0x101010, 0.2));
      eye.position.set(side * 0.02, -0.035, 0.012);
      group.add(eye);
    }
    addHook(group, -0.145, lureMaterial(0x22262a, 0.4, 0.7));
    addHook(group, -0.09, lureMaterial(0x22262a, 0.4, 0.7));
    return { flat: true, spin: null };
  },
  popper(group) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.018, 0.11, 14), lureMaterial(0xf4f1e8, 0.32));
    body.position.y = -0.065;
    group.add(body);
    const face = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.008, 6, 16), lureMaterial(0xe1261c, 0.3));
    face.rotation.x = Math.PI / 2;
    face.position.y = -0.01;
    group.add(face);
    const cup = new THREE.Mesh(new THREE.CircleGeometry(0.026, 14), lureMaterial(0x7c120d, 0.5));
    cup.rotation.x = -Math.PI / 2;
    cup.position.y = -0.012;
    group.add(cup);
    addHook(group, -0.14, lureMaterial(0x22262a, 0.4, 0.7));
    return { flat: true, spin: null };
  },
  squid(group) {
    const pink = lureMaterial(0xee7fa8, 0.45);
    const mantle = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.11, 12), pink);
    mantle.position.y = -0.055;
    mantle.rotation.x = Math.PI;
    mantle.rotation.x = 0;
    group.add(mantle);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), pink);
    head.position.y = -0.115;
    group.add(head);
    for (const side of [1, -1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), lureMaterial(0x101010, 0.15));
      eye.position.set(side * 0.028, -0.115, 0.01);
      group.add(eye);
    }
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * TAU;
      const tentacle = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0015, 0.11, 5), pink);
      tentacle.position.set(Math.cos(angle) * 0.022, -0.19, Math.sin(angle) * 0.022);
      tentacle.rotation.set(Math.sin(angle) * 0.3, 0, -Math.cos(angle) * 0.3);
      group.add(tentacle);
    }
    return { flat: true, spin: null };
  },
  livebait(group) {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), lureMaterial(0x9fb7bd, 0.22, 0.4));
    body.scale.set(0.55, 2.6, 1);
    body.position.y = -0.08;
    group.add(body);
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 6), lureMaterial(0x395562, 0.4));
    back.scale.set(0.55, 3.2, 0.7);
    back.position.set(0, -0.08, 0.014);
    group.add(back);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.04, 4), lureMaterial(0x395562, 0.5));
    tail.scale.x = 0.18;
    tail.position.y = -0.165;
    group.add(tail);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), lureMaterial(0x080808, 0.2));
    eye.position.set(0.013, -0.025, 0.012);
    group.add(eye);
    addHook(group, -0.02, lureMaterial(0x22262a, 0.4, 0.7));
    return { flat: true, spin: null };
  },
};

export function createLureModel(kind) {
  const resolved = Object.prototype.hasOwnProperty.call(LURE_BUILDERS, kind) ? kind : 'bobber';
  if (lureCache.has(resolved)) return lureCache.get(resolved);
  const group = new THREE.Group();
  const { flat, spin } = LURE_BUILDERS[resolved](group);
  const lure = { group, flat, spin };
  lureCache.set(resolved, lure);
  return lure;
}
