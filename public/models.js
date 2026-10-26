import * as THREE from 'three';
import { HOUSE_WIDTH } from './family-layout.js';
import { STATUS } from './themes.js';
import { familyOf, lookOf } from './family-look.js';

export const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); };
export const rnd = (seed) => { let t = seed >>> 0; return () => ((t = Math.imul(t ^ (t >>> 15), t | 1) ^ (t + Math.imul(t ^ (t >>> 7), t | 61))), ((t ^ (t >>> 14)) >>> 0) / 4294967296); };
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.02, ...o });
const mesh = (geo, m, shadow = true) => { const x = new THREE.Mesh(geo, m); x.castShadow = shadow; x.receiveShadow = true; return x; };

/* ---------- sprites (status bubbles) ---------- */
const spriteTex = {};
function bubble(kind) {
  if (spriteTex[kind]) return spriteTex[kind];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = kind === 'needs' ? '#fbbf24' : '#7c8cf5';
  g.beginPath(); g.arc(64, 60, 46, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(50, 98); g.lineTo(64, 124); g.lineTo(78, 98); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 66px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(kind === 'needs' ? '!' : 'z', 64, 64);
  return (spriteTex[kind] = new THREE.CanvasTexture(c));
}
function makeBubble(kind) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubble(kind), depthTest: false, transparent: true }));
  s.scale.set(0.9, 0.9, 1); s.renderOrder = 10; return s;
}

/* ---------- robot worker ---------- */
const lerp = (a, b, k) => a + (b - a) * k;
export class Robot {
  constructor(color, scale = 1, family = 'other') {
    this.root = new THREE.Group(); this.root.scale.setScalar(scale);
    this.rig = new THREE.Group(); this.root.add(this.rig);
    const body = mat(color), light = mat(new THREE.Color(color).lerp(new THREE.Color('#fff'), 0.45)), dark = mat('#2a2f45');
    const torso = mesh(new THREE.BoxGeometry(0.52, 0.5, 0.36), body); torso.position.y = 0.67; this.rig.add(torso);
    this.head = new THREE.Group(); this.head.position.y = 1.1; this.rig.add(this.head);
    this.head.add(mesh(new THREE.BoxGeometry(0.5, 0.36, 0.4), light));
    const face = mesh(new THREE.BoxGeometry(0.4, 0.22, 0.02), dark, false); face.position.set(0, 0, 0.205); this.head.add(face);
    const eyeM = new THREE.MeshBasicMaterial({ color: '#8ff7ff' });
    this.eyes = new THREE.Group(); this.eyes.position.set(0, 0, 0.22);
    for (const x of [-0.09, 0.09]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.02), eyeM); e.position.x = x; this.eyes.add(e); }
    this.head.add(this.eyes);
    const stalk = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6), dark, false); stalk.position.y = 0.26; this.head.add(stalk);
    this.ballMat = new THREE.MeshBasicMaterial({ color: '#94a3b8' });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), this.ballMat); ball.position.y = 0.37; this.head.add(ball);
    this.familyMat = family === 'other' ? null : mat(color);
    if (family === 'bella') {
      const bowGeo = new THREE.ConeGeometry(0.1, 0.14, 3);
      for (const side of [-1, 1]) {
        const bow = mesh(bowGeo, this.familyMat, false); bow.rotation.z = side * Math.PI / 2;
        bow.position.set(side * 0.085, 0.22, 0.15); this.head.add(bow);
      }
      const knot = mesh(new THREE.BoxGeometry(0.07, 0.07, 0.06), this.familyMat, false);
      knot.position.set(0, 0.22, 0.15); this.head.add(knot);
    } else if (family === 'interstellar') {
      const visor = mesh(new THREE.BoxGeometry(0.44, 0.035, 0.025), this.familyMat, false);
      visor.position.set(0, 0.075, 0.225); this.head.add(visor);
      const tip = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.07, 5), this.familyMat, false);
      tip.position.y = 0.46; this.head.add(tip);
    }
    const limb = (w, h, d, x, y, m) => { const p = new THREE.Group(); p.position.set(x, y, 0); const l = mesh(new THREE.BoxGeometry(w, h, d), m); l.position.y = -h / 2 + 0.03; p.add(l); this.rig.add(p); return p; };
    this.armL = limb(0.12, 0.4, 0.12, -0.34, 0.86, light); this.armR = limb(0.12, 0.4, 0.12, 0.34, 0.86, light);
    this.legL = limb(0.15, 0.42, 0.17, -0.13, 0.42, dark); this.legR = limb(0.15, 0.42, 0.17, 0.13, 0.42, dark);
    this.pose = { legL: 0, legR: 0, armL: 0, armR: 0, armRz: 0, headX: 0, headY: 0, y: 0, eye: 1, lean: 0 };
    this.mode = 'idle'; this.phase = Math.random() * 10; this.bubbleKind = null; this.bubble = null;
  }
  setStatus(status) {
    this.ballMat.color.set(STATUS[status].color);
    const kind = status === 'needs' ? 'needs' : status === 'sleeping' ? 'z' : null;
    if (kind === this.bubbleKind) return;
    if (this.bubble) { this.root.remove(this.bubble); this.bubble.material.dispose(); }
    this.bubbleKind = kind; this.bubble = kind ? makeBubble(kind) : null;
    if (this.bubble) { this.bubble.position.y = 2.2; this.root.add(this.bubble); }
  }
  update(t, dt) {
    const p = this.pose, T = t + this.phase, k = 1 - Math.exp(-dt * 12);
    let g = { legL: 0, legR: 0, armL: 0, armR: 0, armRz: 0, headX: 0, headY: 0, y: 0, eye: 1, lean: 0 };
    switch (this.mode) {
      case 'walk': { const s = Math.sin(T * 9); g = { ...g, legL: s * 0.8, legR: -s * 0.8, armL: -s * 0.7, armR: s * 0.7, y: Math.abs(s) * 0.05 }; break; }
      case 'hammer': { const s = Math.sin(T * 11); g = { ...g, armR: -1.4 + s * 1.0, armL: -0.5 - s * 0.3, lean: 0.18 + s * 0.05, y: Math.abs(s) * 0.02, headX: 0.15 }; break; }
      case 'wave': { const s = Math.sin(T * 5); g = { ...g, y: Math.abs(s) * 0.3, armR: -0.2, armRz: -2.5 + Math.sin(T * 14) * 0.35, armL: 0.3, headY: Math.sin(T * 2) * 0.3 }; break; }
      case 'sleep': g = { ...g, legL: -1.45, legR: -1.45, armL: 0.3, armR: 0.3, headX: 0.55, y: -0.18, eye: 0.08, lean: 0.12 }; break;
      default: g = { ...g, armL: Math.sin(T * 1.5) * 0.05, armR: -Math.sin(T * 1.5) * 0.05, headY: Math.sin(T * 0.7) * 0.45, y: Math.sin(T * 2) * 0.015 };
    }
    for (const key in g) p[key] = lerp(p[key], g[key], k);
    this.legL.rotation.x = p.legL; this.legR.rotation.x = p.legR; this.armL.rotation.x = p.armL; this.armR.rotation.x = p.armR; this.armR.rotation.z = p.armRz;
    this.head.rotation.x = p.headX; this.head.rotation.y = p.headY; this.rig.position.y = p.y; this.rig.rotation.x = p.lean; this.eyes.scale.y = p.eye;
    if (this.bubble) { const s = this.bubbleKind === 'needs' ? 1 + Math.sin(T * 6) * 0.1 : 1; this.bubble.scale.set(0.9 * s, 0.9 * s, 1); this.bubble.position.y = 2.2 + Math.sin(T * 2.5) * 0.08; }
  }
  dispose() { this.root.traverse(o => { o.geometry?.dispose?.(); }); this.familyMat?.dispose(); }
}

/* ---------- building ---------- */
export class Building {
  constructor(theme, session) {
    const family = familyOf(session), look = lookOf(session), toolColor = look.color;
    this.family = family;
    const r = rnd(hash(session.id));
    this.group = new THREE.Group(); this.group.userData.key = session.key;
    const w = HOUSE_WIDTH, h = 0.85 + Math.min(1.0, Math.log10((session.size || 40000) / 4000 + 1) * 0.85);
    this.h = h; this.w = w;
    const wallC = new THREE.Color(theme.walls[Math.floor(r() * theme.walls.length)]).lerp(new THREE.Color(toolColor), family === 'other' ? 0.22 : 0.30);
    const roofC = new THREE.Color(theme.roofs[Math.floor(r() * theme.roofs.length)]);
    if (family !== 'other') roofC.lerp(new THREE.Color(toolColor), 0.35);
    this.bodyMat = mat(wallC); this.roofMat = mat(roofC, theme.roof === 'dome' ? { transparent: true, opacity: 0.88, roughness: 0.3 } : {});
    this.winMat = mat(family === 'interstellar' ? '#ffb347' : '#1d2740', { emissive: '#ffd27a', emissiveIntensity: 0 });
    const g = this.group;
    let body, roofH, rBody;
    if (theme.roof === 'gable') { body = mesh(new THREE.BoxGeometry(w, h, w), this.bodyMat); rBody = w / 2; roofH = 0.75; }
    else if (theme.roof === 'spire') { body = mesh(new THREE.CylinderGeometry(w * 0.52, w * 0.62, h, 6), this.bodyMat); rBody = w * 0.5; roofH = 1.0; }
    else { body = mesh(new THREE.CylinderGeometry(w * 0.58, w * 0.62, h, 14), this.bodyMat); rBody = w * 0.58; roofH = w * 0.55; }
    body.position.y = h / 2; g.add(body);
    let roof;
    if (theme.roof === 'gable') { roof = mesh(new THREE.ConeGeometry(w * 0.82, roofH, 4), this.roofMat); roof.rotation.y = Math.PI / 4; roof.scale.set(1.05, 1, 1.05); }
    else if (theme.roof === 'spire') roof = mesh(new THREE.ConeGeometry(w * 0.66, roofH, 6), this.roofMat);
    else roof = mesh(new THREE.SphereGeometry(w * 0.62, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.roofMat);
    roof.position.y = h + (theme.roof === 'dome' ? 0 : roofH / 2); g.add(roof);
    const winGeo = new THREE.BoxGeometry(0.24, 0.3, 0.05);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, wn = mesh(winGeo, this.winMat, false);
      wn.position.set(Math.sin(a) * (rBody + 0.01), h * 0.58, Math.cos(a) * (rBody + 0.01)); wn.rotation.y = a; g.add(wn);
    }
    const door = mesh(new THREE.BoxGeometry(0.22, 0.36, 0.05), mat('#5a3d2b'), false); door.position.set(0, 0.18, rBody + 0.01); g.add(door);
    const top = h + (theme.roof === 'dome' ? w * 0.62 : roofH);
    if (theme.roof === 'gable') { const ch = mesh(new THREE.BoxGeometry(0.16, 0.45, 0.16), mat('#7a5a4a')); ch.position.set(w * 0.22, h + roofH * 0.45, -w * 0.15); g.add(ch); }
    if (theme.roof === 'spire' || family !== 'other') {
      this.poleMat = mat('#fff'); this.flagMat = mat(toolColor);
      const pole = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5), this.poleMat, false); pole.position.y = top + 0.15; g.add(pole);
      const fl = mesh(new THREE.BoxGeometry(0.22, 0.12, 0.01), this.flagMat, false); fl.position.set(0.12, top + 0.28, 0); g.add(fl); this.flag = fl; }
    if (theme.roof === 'dome') { const an = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 5), mat('#ccd'), false); an.position.y = top + 0.2; g.add(an); }
    this.beaconMat = new THREE.MeshBasicMaterial({ color: '#94a3b8' });
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), this.beaconMat);
    this.beacon.position.y = top + (theme.roof === 'spire' ? 0.62 : theme.roof === 'dome' ? 0.55 : 0.4); g.add(this.beacon);
    this.top = this.beacon.position.y;
    const pad = mesh(new THREE.CylinderGeometry(w * 0.95, w * 1.0, 0.08, theme.roof === 'gable' ? 4 : 10), mat(theme.id === 'moon' ? '#9a9dab' : '#d8c9a8'));
    pad.position.y = 0.04; if (theme.roof === 'gable') pad.rotation.y = Math.PI / 4; g.add(pad);
    g.traverse(o => { if (o.isMesh) o.userData.own = true; });
  }
  setStatus(status, night) {
    this.status = status;
    this.beaconMat.color.set(STATUS[status].color);
    const lit = status === 'sleeping' ? 0.15 : status === 'idle' ? 0.55 : 1;
    this.winMat.emissiveIntensity = (0.15 + night * 2.4) * lit;
    this.winMat.emissive.set(this.family === 'interstellar' ? (status === 'needs' ? '#ffb347' : '#ffd9a0') : status === 'needs' ? '#ffd27a' : '#ffe9b0');
    this.lit = lit;
  }
  dispose() { this.group.traverse(o => { o.geometry?.dispose?.(); }); this.bodyMat.dispose(); this.roofMat.dispose(); this.winMat.dispose(); this.flagMat?.dispose(); this.poleMat?.dispose(); }
}

/* ---------- plot decoration ---------- */
export function decorate(theme, name, S) {
  const g = new THREE.Group(), r = rnd(hash(name)), count = 3 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    const a = ((i * 60 + (r() > 0.5 ? 0 : 60)) % 360) * Math.PI / 180 + (r() - 0.5) * 0.2, rad = S * (0.7 + r() * 0.12);
    const o = new THREE.Group(); o.position.set(Math.sin(a) * rad, 0, Math.cos(a) * rad);
    const col = theme.trees[Math.floor(r() * theme.trees.length)], s = 0.8 + r() * 0.6;
    if (theme.id === 'moon') {
      if (r() > 0.5) { const rock = mesh(new THREE.DodecahedronGeometry(0.4 * s, 0), mat(theme.rock)); rock.position.y = 0.2; rock.rotation.set(r() * 3, r() * 3, 0); o.add(rock); }
      else { const base = mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.7 * s, 6), mat('#cfd3e0')); base.position.y = 0.35 * s; const cr = mesh(new THREE.OctahedronGeometry(0.28 * s, 0), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, flatShading: true })); cr.position.y = 0.95 * s; o.add(base, cr); o.userData.crystal = cr; }
    } else if (theme.id === 'village') {
      if (r() > 0.25) { const trunk = mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.4, 5), mat('#6b4a32')); trunk.position.y = 0.2; o.add(trunk);
        for (let k = 0; k < 3; k++) { const c = mesh(new THREE.ConeGeometry(0.55 * s - k * 0.12, 0.75 * s, 7), mat(col)); c.position.y = 0.6 + k * 0.42 * s; o.add(c); } }
      else { const post = mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 5), mat('#3b3b44')); post.position.y = 0.55; const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd27a' })); bulb.position.y = 1.15; o.add(post, bulb); o.userData.lamp = bulb; }
    } else {
      const trunk = mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.5, 5), mat('#8a6a5a')); trunk.position.y = 0.25; o.add(trunk);
      const crown = mesh(new THREE.IcosahedronGeometry(0.45 * s, 0), mat(col)); crown.position.y = 0.75; o.add(crown);
    }
    o.userData.ph = r() * 6; o.userData.sway = theme.id !== 'moon' && !o.userData.lamp;
    g.add(o);
  }
  return g;
}
