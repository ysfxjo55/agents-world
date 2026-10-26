import { familyOf, lookOf } from './family-look.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { THEMES } from './themes.js';
import { Robot, Building, decorate, hash, rnd } from './models.js';
import { icon } from './icons.js';
import { familyLayout, familySessions, interstellarLayout, overviewDistance } from './family-layout.js';

const S = 6.2;                    // hex circumradius
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
function spiral(n) {
  const out = [[0, 0]];
  for (let ring = 1; out.length < n; ring++) {
    let q = DIRS[4][0] * ring, r = DIRS[4][1] * ring;
    for (let side = 0; side < 6; side++) for (let i = 0; i < ring; i++) { out.push([q, r]); q += DIRS[side][0]; r += DIRS[side][1]; }
  }
  return out;
}
const spiralArr = spiral(120);
const hexPos = (i) => { const [q, r] = spiralArr[i] ?? spiralArr[spiralArr.length - 1]; return new THREE.Vector3(S * 1.04 * Math.sqrt(3) * (q + r / 2), 0, S * 1.04 * 1.5 * r); };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const C = (h) => new THREE.Color(h);
// One cheap pass: miniature tilt-shift blur (top/bottom bands), gentle saturation, soft vignette.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, res: { value: new THREE.Vector2(1, 1) }, focus: { value: 0.54 }, amount: { value: 0 }, vig: { value: 0.32 }, sat: { value: 1.1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 res; uniform float focus; uniform float amount; uniform float vig; uniform float sat; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float b = smoothstep(0.17, 0.56, abs(vUv.y - focus)) * amount;
      if (b > 0.05) {
        vec3 acc = c.rgb; float wsum = 1.0;
        for (int i = 0; i < 12; i++) {
          float fi = float(i) + 1.0, a = fi * 2.39996, r = sqrt(fi / 12.0) * b;
          acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * r / res).rgb; wsum += 1.0;
        }
        c.rgb = acc / wsum;
      }
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, sat);
      vec2 q = vUv - 0.5; c.rgb *= 1.0 - vig * dot(q, q) * 1.7;
      gl_FragColor = c;
    }`,
};
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class World {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    const coarse = matchMedia('(pointer:coarse)').matches; this.lite = coarse;   // phones/tablets: lighter rendering
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer(); this.labels.domElement.className = 'labels'; host.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
    this.camera.position.set(22, 26, 30);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: 1.38, minDistance: 5, maxDistance: 160, screenSpacePanning: false });

    this.hemi = new THREE.HemisphereLight('#fff', '#888', 1); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff', 2); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.lite ? 1024 : 2048, this.lite ? 1024 : 2048); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04; this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: C('#000') }, bot: { value: C('#222') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying vec3 vP; void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(bot, top, smoothstep(-0.1, 0.65, h)), 1.); }',
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), this.skyMat); this.sky.renderOrder = -10; this.sky.frustumCulled = false; this.scene.add(this.sky);
    const sp = new Float32Array(900 * 3), r = rnd(7);
    for (let i = 0; i < 900; i++) { const a = r() * 6.283, b = Math.acos(r() * 1.7 - 0.7), R = 850; sp.set([R * Math.sin(b) * Math.cos(a), R * Math.cos(b), R * Math.sin(b) * Math.sin(a)], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#fff', size: 2.2, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false }));
    this.stars.frustumCulled = false; this.scene.add(this.stars);
    this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(26, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff4c8', fog: false })); this.scene.add(this.sunMesh);
    this.moonMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(20, 1), new THREE.MeshBasicMaterial({ color: '#e6ebff', fog: false })); this.scene.add(this.moonMesh);
    this.earth = new THREE.Mesh(new THREE.IcosahedronGeometry(70, 2), new THREE.MeshBasicMaterial({ color: '#4f8fe0', fog: false })); this.scene.add(this.earth);

    this.themeGroup = new THREE.Group(); this.scene.add(this.themeGroup);
    this.plots = new Map();       // project path -> plot
    this.buildings = new Map();   // session key -> agent
    this.slots = new Map();       // project path -> spiral index
    this.dying = [];
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.15, 40), new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.renderOrder = 9; this.ring.visible = false; this.scene.add(this.ring);
    this.raycaster = new THREE.Raycaster(); this.fly = null; this.timeOverride = null; this.hover = null; this.selected = null; this.sessions = [];
    this.clock = new THREE.Clock(); this.t = 0; this.night = 0; this.extent = 14; this.clouds = []; this.agents = []; this.guildItems = new Map(); this.bella = null; this.bellaItem = null; this.lab = null; this.labItem = null; this.interstellarItem = null;
    this.interstellar = null; this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.setTheme('island', false);
    this.setupPost();
    this.idleAt = performance.now(); this.interacting = false;
    this.controls.addEventListener('start', () => { this.interacting = true; });
    this.controls.addEventListener('end', () => { this.interacting = false; this.idleAt = performance.now(); });
    new ResizeObserver(() => this.resize()).observe(host); this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setupPost() {
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: this.lite ? 0 : 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (!this.lite) { this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.7, 0.92); this.composer.addPass(this.bloom); }
    // Bloom is additive screen-space light: depth alone cannot stop it filling
    // the black silhouette. Restore the core after bloom using the scene depth,
    // retaining the disc/rim wherever their front surfaces occlude the sphere.
    const coreScene = new THREE.Scene(), corePass = new RenderPass(coreScene, this.camera);
    corePass.clear = false;
    let coreCopy = null;
    const renderCore = corePass.render.bind(corePass);
    corePass.render = (...args) => {
      const core = this.interstellarItem?.core;
      if (!core) return;
      for (let o = core; o; o = o.parent) if (!o.visible) return;
      if (coreCopy?.geometry !== core.geometry) {
        coreScene.clear(); coreCopy = core.clone(); coreCopy.matrixAutoUpdate = false; coreScene.add(coreCopy);
      }
      coreCopy.matrix.copy(core.matrixWorld);
      renderCore(...args);
    };
    this.composer.addPass(corePass);
    this.grade = new ShaderPass(GradeShader); this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());   // tone mapping + sRGB once, at the end
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h); this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h);
    this.grade.uniforms.res.value.set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio()); this.labels.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /* ---------- theme ---------- */
  setTheme(id, rebuild = true) {
    this.theme = THEMES[id];
    for (const c of [...this.themeGroup.children]) { this.themeGroup.remove(c); c.traverse(o => o.geometry?.dispose?.()); }
    this.clouds = []; this.fireflies = null; this.cloudMat = null;
    const th = this.theme, r = rnd(11);
    if (th.ground) {
      const gm = new THREE.MeshStandardMaterial({ color: th.ground, flatShading: true, roughness: 1 });
      const gnd = new THREE.Mesh(new THREE.CircleGeometry(500, 9), gm);
      gnd.rotation.x = -Math.PI / 2; gnd.position.y = -1.2; gnd.receiveShadow = true; this.themeGroup.add(gnd);
      for (let i = 0; i < 46; i++) {
        const a = r() * 6.28, d = 70 + r() * 260;
        const geo = th.id === 'moon' ? new THREE.DodecahedronGeometry(2 + r() * 6, 0) : new THREE.ConeGeometry(10 + r() * 20, 8 + r() * 16, 5);
        const b = new THREE.Mesh(geo, gm.clone()); b.material.color.offsetHSL(0, 0, (r() - 0.5) * 0.08);
        b.position.set(Math.cos(a) * d, th.id === 'moon' ? 0 : 3, Math.sin(a) * d); b.receiveShadow = true; this.themeGroup.add(b);
      }
      if (th.id === 'moon') for (let i = 0; i < 30; i++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(3 + r() * 9, 3 + r() * 9, 0.1, 10), new THREE.MeshStandardMaterial({ color: '#6f7280', flatShading: true }));
        const a = r() * 6.28, d = 30 + r() * 220; c.position.set(Math.cos(a) * d, -1.15, Math.sin(a) * d); c.receiveShadow = true; this.themeGroup.add(c);
      }
    }
    if (th.floating) {
      this.cloudMat = new THREE.MeshStandardMaterial({ color: '#fff', flatShading: true, transparent: true, opacity: 0.93, emissive: '#ffd0c0', emissiveIntensity: 0.2 });
      for (let i = 0; i < 28; i++) {
        const cl = new THREE.Group();
        for (let k = 0; k < 4; k++) { const p = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + r() * 2.5, 0), this.cloudMat); p.position.set(k * 2.6 - 4, r() * 1.2, r() * 2); p.scale.y = 0.6; cl.add(p); }
        const a = r() * 6.28, d = 45 + r() * 170;
        cl.position.set(Math.cos(a) * d, -16 - r() * 40 + (r() > 0.75 ? 55 : 0), Math.sin(a) * d); cl.userData.speed = 0.4 + r() * 0.8; this.themeGroup.add(cl); this.clouds.push(cl);
      }
    }
    if (th.id === 'village') {
      const fg = new THREE.BufferGeometry(), n = 90, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pos.set([(r() - 0.5) * 120, 0.5 + r() * 4, (r() - 0.5) * 120], i * 3);
      fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ color: '#d9ff7a', size: 5, sizeAttenuation: false, transparent: true, opacity: 0 }));
      this.fireflies.frustumCulled = false; this.themeGroup.add(this.fireflies);
    }
    this.earth.visible = th.id === 'moon';
    this.scene.fog = new THREE.Fog('#888', 80, 380);
    if (rebuild) this.rebuild();
  }
  rebuild() {
    this.disposeFamily();
    for (const p of this.plots.values()) this.disposePlot(p);
    for (const a of [...this.buildings.values(), ...this.dying]) a.bld.dispose();
    for (const it of this.guildItems.values()) it.el.remove();
    this.bellaItem = null; this.labItem = null; this.interstellarItem = null; this.plots.clear(); this.guildItems.clear(); this.buildings.clear(); this.dying = []; this.ring.visible = false;
    const s = this.sessions; this.sessions = []; this.slots.clear(); this.sync(s);
  }
  setTimeOverride(h) { this.timeOverride = h; }

  /* ---------- plots & buildings ---------- */
  makePlot(path, name, slot) {
    const th = this.theme, g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.94, S * 0.94, 0.5, 6), new THREE.MeshStandardMaterial({ color: th.plotTop, flatShading: true, roughness: 0.95 }));
    top.position.y = -0.25; top.receiveShadow = true; top.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.99, S * 0.97, 0.36, 6), new THREE.MeshStandardMaterial({ color: th.plotRim, flatShading: true }));
    rim.position.y = -0.58; rim.castShadow = true; rim.receiveShadow = true;
    inner.add(top, rim);
    if (th.floating) {
      const rockMat = new THREE.MeshStandardMaterial({ color: th.rock, flatShading: true });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(S * 0.95, 7, 6, 3), rockMat);
      const pos = cone.geometry.attributes.position, rr = rnd(hash(name));
      for (let i = 0; i < pos.count; i++) { if (pos.getY(i) > 3.4 || pos.getY(i) < -3.4) continue; pos.setX(i, pos.getX(i) + (rr() - 0.5) * 0.9); pos.setZ(i, pos.getZ(i) + (rr() - 0.5) * 0.9); pos.setY(i, pos.getY(i) + (rr() - 0.5) * 0.7); }
      cone.geometry.computeVertexNormals(); cone.rotation.x = Math.PI; cone.position.y = -4.2; cone.castShadow = true; inner.add(cone);
      for (let i = 0; i < 3; i++) { const pb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rr() * 0.4, 0), rockMat); pb.position.set((rr() - 0.5) * 4, -6 - rr() * 3, (rr() - 0.5) * 4); inner.add(pb); }
    } else {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.98, S * 1.0, 0.5, 6), new THREE.MeshStandardMaterial({ color: th.rock, flatShading: true }));
      base.position.y = -0.85; base.receiveShadow = true; inner.add(base);
    }
    const foundation = inner.children.slice();
    const decor = decorate(th, name, S); inner.add(decor);
    const el = document.createElement('div'); el.className = 'plot-label';
    const nm = document.createElement('span'); nm.textContent = name; if (path === '__guild__') { nm.innerHTML = icon('guild', 15); nm.append(' Agent Guild'); } const cnt = document.createElement('i'); el.append(nm, cnt);
    const label = new CSS2DObject(el); label.position.set(0, 5.4, 0); g.add(label);
    this.scene.add(g);
    const target = hexPos(slot);
    g.position.copy(target); g.scale.setScalar(0.001);
    return { path, name, slot, group: g, inner, foundation, decor, label, el, cnt, target, list: [], grow: 0, dying: false, phase: Math.random() * 6 };
  }
  disposePlot(p) {
    if (p.isInterstellar && this.interstellarItem) { this.interstellarItem.sign.material.map.dispose(); this.interstellarItem = null; }
    this.scene.remove(p.group); p.el.remove(); p.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }

  sync(sessions) {
    this.sessions = sessions;
    this.syncBella(); this.syncLab(); this.syncInterstellar();                              // her block must exist before her agents' sessions are placed on it
    const byProject = new Map();
    for (const s of sessions) {
      if (!byProject.has(s.projectPath)) byProject.set(s.projectPath, { name: s.projectName, list: [], last: 0 });
      const p = byProject.get(s.projectPath); p.list.push(s); p.last = Math.max(p.last, s.lastActivity);
    }
    // stable slots: existing projects keep theirs; newcomers take the next free slot, most recent first
    for (const k of [...this.slots.keys()]) if (!byProject.has(k)) this.slots.delete(k);
    const used = new Set(this.slots.values());
    for (const [k] of [...byProject].sort((a, b) => b[1].last - a[1].last)) {
      if (this.slots.has(k) || k === '__bella__' || k === '__lab__' || k === '__interstellar__') continue;
      let i = 0; while (used.has(i)) i++; this.slots.set(k, i); used.add(i);
    }
    for (const [path, info] of byProject) {
      let plot = this.plots.get(path);
      if (!plot) { plot = this.makePlot(path, info.name, this.slots.get(path)); this.plots.set(path, plot); }
      if (!plot.isBella && !plot.isLab && !plot.isInterstellar) { plot.slot = this.slots.get(path); plot.target = hexPos(plot.slot); }   // special blocks are placed by the frame loop
      plot.dying = false; plot.list = info.list;
    }
    for (const [path, plot] of this.plots) if (!byProject.has(path)) { if (plot.isGuild || plot.isBella || plot.isLab || plot.isInterstellar) plot.list = []; else { plot.dying = true; plot.list = []; } }

    const keep = new Set(sessions.map(s => s.key));
    for (const [key, a] of this.buildings) if (!keep.has(key)) {
      a.dying = true; a.foldT = 0; this.dying.push(a); this.buildings.delete(key);
      if (this.selected === key) this.ring.visible = false;
    }
    for (const plot of this.plots.values()) {
      const list = plot.list.slice().sort((a, b) => a.firstSeen - b.firstSeen);
      const spacing = Math.min(1.55, 4.0 / Math.sqrt(list.length + 0.5)), sc = Math.max(0.72, Math.min(1, spacing / 1.4));
      const packed = plot.isBella || plot.isInterstellar ? familySessions(list.length, S, plot.isInterstellar) : null;
      if (packed) {
        if (!plot.overflowLabel) {
          const el = document.createElement('div'); el.className = 'plot-label';
          plot.overflowLabel = new CSS2DObject(el); plot.inner.add(plot.overflowLabel);
        }
        plot.overflowLabel.element.textContent = packed.overflow ? `+${packed.overflow}` : '';
        plot.overflowLabel.visible = !!packed.overflow;
        if (packed.marker) plot.overflowLabel.position.set(packed.marker.x, 0.8, packed.marker.z);
      }
      list.forEach((s, i) => {
        let a = this.buildings.get(s.key);
        if (!a) a = this.makeAgent(s, plot);
        a.session = s; a.plot = plot; a.hidden = false;
        const ang = i * 2.39996, rad = i === 0 ? 0 : spacing * Math.sqrt(i + 0.3);
        if (packed) {
          a.hidden = i >= packed.points.length;
          const pos = packed.points[i];
          if (pos) { a.target.set(pos.x, 0, pos.z); a.pos.copy(a.target); }
          a.scale = packed.scale;
        }
        else if (plot.isLab) { const t = 1.2 + (i % 6) * 0.75, r = 4.3 + Math.floor(i / 6) * 0.9; a.target.set(Math.sin(t) * r, 0, Math.cos(t) * r - 0.6); a.scale = 0.8; }   // an arc beside her HQ
        else { a.target.set(Math.sin(ang) * rad, 0, Math.cos(ang) * rad); a.scale = sc; }
        this.applyStatus(a, s);
      });
      plot.cnt.textContent = list.length ? ` · ${list.length}` : '';
    }
    this.syncGuild(); this.syncBella(); this.syncLab(); this.syncInterstellar();
  }

  disposeFamily() {
    if (!this.family) return;
    this.scene.remove(this.family.group); this.family.el.remove();
    const materials = new Set();
    this.family.group.traverse(o => { o.geometry?.dispose?.(); if (o.material) materials.add(o.material); });
    for (const m of materials) m.dispose();
    this.family = null; this.familyRadius = null; this.familyPlotCount = null;
  }
  syncFamily(radius) {
    const bp = this.plots.get('__bella__'), ip = this.plots.get('__interstellar__');
    if (radius !== this.familyRadius || this.plots.size !== this.familyPlotCount) {
      const centers = [...this.plots.values()].filter(p => !p.isBella && !p.isInterstellar).map(p => p.target);
      const layout = familyLayout(S, centers);
      if (bp) bp.target.set(layout.bella.x, 0, layout.bella.z);
      if (ip) ip.target.set(layout.interstellar.x, 0, layout.interstellar.z);
      this.familyRadius = radius; this.familyPlotCount = this.plots.size;
    }
    if (!bp || !ip || this.family) return;
    for (const p of [bp, ip]) {
      const top = p.foundation[0];
      top.geometry.dispose(); top.geometry = new THREE.CylinderGeometry(S, S, 0.5, 6);
      for (const base of p.foundation.slice(1)) base.visible = false;
      p.label.position.set(p === bp ? -1.8 : 1.8, 6.6, 0);
      p.label.center.set(p === bp ? 0.85 : 0.15, 0.5);
    }
    const group = new THREE.Group(), d = S * Math.sqrt(3) / 2;
    const shape = new THREE.Shape();
    const points = [[-d, -S], [0, -S / 2], [d, -S], [2 * d, -S / 2], [2 * d, S / 2], [d, S], [0, S / 2], [-d, S], [-2 * d, S / 2], [-2 * d, -S / 2]];
    points.forEach(([x, z], i) => { if (i) shape.lineTo(x, z); else shape.moveTo(x, z); }); shape.closePath();
    const mat = new THREE.MeshStandardMaterial({ color: '#82746e', flatShading: true, roughness: 1 });
    const geo = new THREE.ExtrudeGeometry(shape, { depth: this.theme.floating ? 3.8 : 0.55, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.1, bevelSegments: 1, steps: 1 });
    geo.rotateX(Math.PI / 2);
    const base = new THREE.Mesh(geo, mat); base.position.y = -0.52; base.castShadow = base.receiveShadow = true; group.add(base);
    const stone = new THREE.MeshStandardMaterial({ color: '#c4b6a0', roughness: 1 });
    const path = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, S), stone); path.position.y = 0.02; path.receiveShadow = true; group.add(path);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.9, 6), mat); post.position.set(0, 0.5, 0); group.add(post);
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.32), new THREE.MeshStandardMaterial({ color: '#ffe1a0', emissive: '#ffb65b', emissiveIntensity: 1.4 })); lantern.position.y = 1.1; group.add(lantern);
    const el = document.createElement('div'); el.className = 'plot-label family'; el.textContent = 'Family';
    const label = new CSS2DObject(el); label.position.set(0, 2.2, S * 0.3); group.add(label);
    this.scene.add(group); this.family = { group, el };
  }

  /* ---------- Bella HQ: the manager's own block, building and robot ---------- */
  setBella(b) { this.bella = b; this.syncBella(); }
  syncBella() {
    if (!this.bella) return;
    let plot = this.plots.get('__bella__');
    if (!plot) {
      plot = this.makePlot('__bella__', 'Bella HQ', 0); plot.isBella = true; this.plots.set('__bella__', plot);
      const [top, rim] = plot.inner.children;
      top.material.color.set('#ffd9e8'); rim.material.color.set('#ff8fbd');            // pink ground
      plot.el.classList.add('bella'); const nm = plot.el.firstChild; nm.innerHTML = icon('crown', 15); nm.append(' Bella HQ');
      const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.7, ...o });
      const mesh = (g, m) => { const x = new THREE.Mesh(g, m); x.castShadow = x.receiveShadow = true; return x; };
      const hq = new THREE.Group(); hq.userData.key = 'bella'; hq.position.set(0, 0, -0.9);
      const base = mesh(new THREE.CylinderGeometry(2.1, 2.3, 0.35, 8), mat('#fff3f8')); base.position.y = 0.17;
      const lower = mesh(new THREE.BoxGeometry(2.1, 1.35, 2.1), mat('#ff9ac4')); lower.position.y = 1.0;
      const upper = mesh(new THREE.BoxGeometry(1.35, 1.0, 1.35), mat('#ffc4dd')); upper.position.y = 2.18;
      const roof = mesh(new THREE.ConeGeometry(1.15, 1.0, 4), mat('#ffcf5a', { metalness: 0.2 })); roof.position.y = 3.2; roof.rotation.y = Math.PI / 4;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshBasicMaterial({ color: '#fff3b0' })); orb.position.y = 3.85;
      const pole = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), mat('#fff')); pole.position.set(0.5, 3.75, 0);
      const flag = mesh(new THREE.BoxGeometry(0.5, 0.3, 0.03), mat('#ff6fae')); flag.position.set(0.77, 3.95, 0);
      const winM = new THREE.MeshStandardMaterial({ color: '#7a3b58', emissive: '#ffd27a', emissiveIntensity: 0.4 });
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; const wn = mesh(new THREE.BoxGeometry(0.36, 0.42, 0.05), winM); wn.position.set(Math.sin(a) * 1.06, 1.15, Math.cos(a) * 1.06); wn.rotation.y = a; hq.add(wn);
        const wn2 = mesh(new THREE.BoxGeometry(0.28, 0.34, 0.05), winM); wn2.position.set(Math.sin(a) * 0.69, 2.25, Math.cos(a) * 0.69); wn2.rotation.y = a; hq.add(wn2); }
      const door = mesh(new THREE.BoxGeometry(0.45, 0.7, 0.06), mat('#7a3b58')); door.position.set(0, 0.7, 1.07);
      // a big "B" sign above the roof
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      g.fillStyle = '#ff6fae'; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill(); g.lineWidth = 8; g.strokeStyle = '#ffcf5a'; g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 76px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('B', 64, 70);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true })); sign.scale.set(1.5, 1.5, 1); sign.position.y = 5.0; sign.renderOrder = 10;
      hq.add(base, lower, upper, roof, orb, pole, flag, door, sign);
      // golden ring and sparkles around the block so it stands out
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.7, 3.9, 48), new THREE.MeshBasicMaterial({ color: '#ffcf5a', transparent: true, opacity: 0.75, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
      const sp = new Float32Array(40 * 3); for (let i = 0; i < 40; i++) { const a = Math.random() * 6.283, r = 1.5 + Math.random() * 3.6; sp.set([Math.sin(a) * r, 0.5 + Math.random() * 3.5, Math.cos(a) * r], i * 3); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      const sparkles = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffe38a', size: 4, sizeAttenuation: false, transparent: true, opacity: 0.9 })); sparkles.frustumCulled = false;
      // Bella herself: bigger than the others, pink, crowned, with a heart badge
      const robot = new Robot('#ff6fae', 1.15); robot.root.userData.key = 'bella'; robot.phase = 1.3;
      const gold = mat('#ffcf5a', { metalness: 0.3 });
      const crown = new THREE.Group(); crown.position.y = 0.21;
      const band = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.09, 10), gold); crown.add(band);
      for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; const spike = mesh(new THREE.ConeGeometry(0.05, 0.14, 5), gold); spike.position.set(Math.sin(a) * 0.17, 0.11, Math.cos(a) * 0.17); crown.add(spike); }
      robot.head.add(crown);
      const heart = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff' })); heart.position.set(0, 0.7, 0.19); robot.rig.add(heart);
      robot.root.position.set(0.3, 0.1, 2.5); robot.root.rotation.y = 0.35;
      plot.inner.add(hq, ring, sparkles, robot.root);
      this.bellaItem = { hq, ring, sparkles, robot, orb, sign, winM, flag };
    }
    plot.dying = false; this.bellaItem.robot.setStatus(this.bella.status === 'working' ? 'working' : 'idle');
  }
  tickBella(t, dt) {
    const it = this.bellaItem; if (!it) return;
    const st = this.bella?.status || 'idle';
    it.robot.mode = st === 'working' ? 'hammer' : Math.sin(t * 0.45) > 0.82 ? 'wave' : 'idle';      // she waves hello now and then
    it.robot.update(t, dt);
    it.ring.rotation.z += dt * 0.25; it.ring.material.opacity = 0.55 + Math.sin(t * 2) * 0.2;
    it.sign.position.y = 5.0 + Math.sin(t * 1.8) * 0.12; it.orb.scale.setScalar(1 + Math.sin(t * 3) * 0.15);
    it.sparkles.rotation.y += dt * 0.15; it.sparkles.material.opacity = 0.6 + Math.sin(t * 4) * 0.3;
    it.flag.rotation.y = Math.sin(t * 3) * 0.4; it.winM.emissiveIntensity = 0.35 + this.night * 1.8 + (st === 'working' ? 0.4 : 0);
  }
  bellaWorldPos() { return this.bellaItem && this.bellaItem.robot.root.getWorldPosition(new THREE.Vector3()); }

  /* ---------- Interstellar: Gargantua, Endurance and the partner ---------- */
  setInterstellar(a) {
    this.interstellar = a;
    const plot = this.plots.get('__interstellar__');
    if (plot) { plot.group.visible = !!a; plot.el.hidden = !a; }
    this.syncInterstellar();
  }
  syncInterstellar() {
    if (!this.interstellar) return;
    let plot = this.plots.get('__interstellar__');
    if (!plot) {
      plot = this.makePlot('__interstellar__', 'Interstellar', 0); plot.isInterstellar = true; this.plots.set('__interstellar__', plot);
      const [top, rim] = plot.inner.children; top.material.color.set('#101522'); rim.material.color.set('#8c572d'); rim.material.emissive.set('#ff9b36'); rim.material.emissiveIntensity = 0.3;
      plot.inner.remove(plot.decor); plot.decor.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      plot.el.classList.add('interstellar');
      const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.7, ...o });
      const mesh = (g, m) => { const x = new THREE.Mesh(g, m); x.castShadow = x.receiveShadow = true; return x; };
      const layout = interstellarLayout(S);
      const hole = new THREE.Group(); hole.userData.key = 'interstellar'; hole.position.set(layout.hole.x, 2.5, layout.hole.z);
      const black = mesh(new THREE.SphereGeometry(1.15, 24, 16), new THREE.MeshBasicMaterial({ color: '#010102', depthWrite: true, fog: false }));
      // Opaque depth keeps both the tilted disc and additive haze off the core.
      black.renderOrder = 0;
      const rimLight = new THREE.Mesh(new THREE.SphereGeometry(1.175, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffc878', side: THREE.BackSide })); rimLight.renderOrder = 1;
      const glowM = mat('#ffd29a', { emissive: '#ff9c32', emissiveIntensity: 2.2, side: THREE.DoubleSide });
      const disc = new THREE.Group(); disc.rotation.set(-1.35, 0.12, 0.15);
      const outer = new THREE.Mesh(new THREE.RingGeometry(1.35, 2.55, 64), glowM); disc.add(outer);
      const white = new THREE.Mesh(new THREE.TorusGeometry(1.39, 0.045, 6, 64), new THREE.MeshBasicMaterial({ color: '#fff3db' })); disc.add(white);
      const streakM = new THREE.MeshBasicMaterial({ color: '#fff0cf' });
      for (let i = 0; i < 5; i++) { const streak = new THREE.Mesh(new THREE.TorusGeometry(1.65 + i * 0.16, 0.018, 4, 32, 1.8), streakM); streak.rotation.z = i * 1.7; disc.add(streak); }
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.055, 6, 64), glowM); halo.position.z = -0.35;
      const haze = new THREE.Mesh(new THREE.RingGeometry(1.2, layout.discRadius, 64), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); haze.rotation.copy(disc.rotation);
      haze.renderOrder = 0;
      hole.add(haze, halo, disc, rimLight, black);
      const orbit = new THREE.Group(); orbit.position.copy(hole.position);
      const station = new THREE.Group(); station.position.set(layout.orbitRadius, 0.4, 0); station.rotation.x = 0.45;
      const metal = mat('#bcc0bf', { metalness: 0.5 }), dark = mat('#353a40');
      station.add(mesh(new THREE.TorusGeometry(0.55, 0.035, 5, 24), dark));
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, module = mesh(new THREE.BoxGeometry(0.19, 0.25, 0.17), metal); module.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0); module.rotation.z = a; station.add(module); }
      orbit.add(station);
      const robot = new Robot('#ffb347', 1); robot.root.userData.key = 'interstellar'; robot.rig.visible = false;
      robot.root.position.set(layout.waypoints[0].x, 0.12, layout.waypoints[0].z); robot.root.rotation.y = 0.3;
      const body = new THREE.Group(); robot.root.add(body);
      const slabs = [];
      for (let i = 0; i < 4; i++) { const pivot = new THREE.Group(); pivot.position.set((i - 1.5) * 0.245, 0.035, 0); body.add(pivot); slabs.push(pivot);
        const slab = mesh(new THREE.BoxGeometry(0.22, 1.65, 0.32), metal); slab.position.y = 0.825; pivot.add(slab);
        const seam = mesh(new THREE.BoxGeometry(0.19, 0.025, 0.012), dark); seam.position.set(0, 0.22, 0.166); slab.add(seam); }
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.016), mat('#ffbd62', { emissive: '#ffad42', emissiveIntensity: 0.8 })); screen.position.set(0, 0.48, 0.17); slabs[1].children[0].add(screen);
      // A floating crown on Gargantua's side, using Bella's band and five points.
      const gold = mat('#ffc42b', { metalness: 0.45, emissive: '#ffb521', emissiveIntensity: 0.12 });
      const crown = new THREE.Group(); crown.position.set(-1.15, 2.25, 0); crown.scale.setScalar(1.12);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.35, 0.14, 10, 1, true), gold);
      band.material.side = THREE.DoubleSide; crown.add(band);
      for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2, spike = mesh(new THREE.ConeGeometry(0.08, 0.23, 5), gold); spike.position.set(Math.sin(a) * 0.27, 0.18, Math.cos(a) * 0.27); crown.add(spike); }
      // Keep the sign above the inner side, clear of the hole and outer name chips.
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      g.fillStyle = '#d88928'; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill(); g.lineWidth = 8; g.strokeStyle = '#ffcf5a'; g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 76px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('I', 64, 70);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true })); sign.scale.set(1.5, 1.5, 1); sign.position.set(0, 4.0, 0); sign.renderOrder = 10;
      const r = rnd(71), rockM = mat('#5d5146');
      for (let i = 0; i < 14; i++) { const a = r() * 6.283, rock = mesh(new THREE.DodecahedronGeometry(0.1 + r() * 0.16, 0), rockM); rock.position.set(Math.sin(a) * (3.6 + r()), 0.08, Math.cos(a) * (3.6 + r())); rock.scale.y = 0.5; plot.inner.add(rock); }
      const sp = new Float32Array(96 * 3); for (let i = 0; i < 96; i++) sp.set([(r() - 0.5) * 8, 0.5 + r() * 4.5, (r() - 0.5) * 8], i * 3);
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffe4bc', size: 2, sizeAttenuation: false, transparent: true, opacity: 0.65 }));
      robot.root.add(crown, sign);
      plot.inner.add(hole, orbit, robot.root, stars);
      this.interstellarItem = { hole, core: black, disc, orbit, robot, body, slabs, screen, crown, sign, stars, glowM, layout, waypoint: this.interstellar.status === 'working' ? 0 : 1, pause: 0, gait: 0, position: new THREE.Vector3() };
    }
    plot.dying = false; this.interstellarItem.robot.setStatus(this.interstellar.status);
  }
  tickInterstellar(t, dt) {
    const it = this.interstellarItem; if (!it || !this.interstellar) return;
    const busy = this.interstellar.status === 'working', motion = this.reducedMotion.matches ? 0 : 1;
    it.disc.rotation.z += dt * (busy ? 0.8 : 0.12) * motion; it.orbit.rotation.y += dt * 0.12 * motion; it.stars.rotation.y += dt * 0.025 * motion;
    it.glowM.emissiveIntensity = busy ? 3.3 : 1.7;
    if (!motion) {
      it.screen.material.emissiveIntensity = 0.8 + Math.sin(t * 1.3) * 0.18;
      return;
    }
    // Follow the polygon edges even when returning to the work stop; never cut
    // across the hole. Only the work stop (waypoint zero) parks a busy TARS.
    let walking = false;
    if (motion) {
      it.pause = Math.max(0, it.pause - dt);
      const p = it.robot.root.position, target = it.layout.waypoints[it.waypoint];
      const dx = target.x - p.x, dz = target.z - p.z, distance = Math.hypot(dx, dz);
      if (distance > 0.0001 && (busy || !it.pause)) {
        const travel = Math.min(distance, dt * 0.32);
        p.x += dx / distance * travel; p.z += dz / distance * travel;
        walking = true; it.gait += travel * 15;
      } else if (distance <= 0.0001 && !(busy && it.waypoint === 0)) {
        it.waypoint = (it.waypoint + 1) % it.layout.waypoints.length;
        it.pause = busy ? 0 : 2.8;
      }
    }
    const wave = !busy && it.pause > 0 && motion;
    it.robot.mode = busy ? 'hammer' : wave ? 'wave' : 'idle';
    const k = 1 - Math.exp(-dt * 10), step = Math.sin(busy ? t * 11 : it.gait);
    it.body.position.y += (((busy || walking) ? Math.abs(step) * 0.06 : Math.sin(t * 2) * 0.018) * motion - it.body.position.y) * k;
    it.body.rotation.z += ((wave ? -0.14 : (busy || walking) ? step * 0.07 : 0) * motion - it.body.rotation.z) * k;
    it.robot.root.getWorldPosition(it.position);
    const face = wave ? Math.atan2(this.camera.position.x - it.position.x, this.camera.position.z - it.position.z) : walking ? Math.atan2(it.layout.waypoints[it.waypoint].x - it.robot.root.position.x, it.layout.waypoints[it.waypoint].z - it.robot.root.position.z) : it.robot.root.rotation.y;
    it.robot.root.rotation.y += angDiff(motion ? face : 0.3, it.robot.root.rotation.y) * k;
    for (let i = 0; i < 4; i++) {
      const slab = it.slabs[i], stride = i % 2 ? step : -step;
      const lift = (busy || walking) ? Math.max(0, stride) * 0.22 : wave && i === 3 ? 0.42 : 0;
      slab.position.y += (0.035 + lift * motion - slab.position.y) * k;
      slab.rotation.x += (((busy || walking) ? stride * 0.24 : 0) * motion - slab.rotation.x) * k;
      slab.rotation.z += ((wave && i === 3 ? -0.5 + Math.sin(t * 14) * 0.18 : 0) * motion - slab.rotation.z) * k;
    }
    // Two brief screen blinks during each greeting, independent of frame rate.
    const phase = ((t * 0.45) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const blink = wave && ((phase > 1.1 && phase < 1.18) || (phase > 1.38 && phase < 1.46));
    it.screen.scale.y = blink ? 0.12 : 1;
    it.screen.material.emissiveIntensity = blink ? 0.05 : 0.8 + Math.sin(t * (busy && motion ? 11 : 1.3)) * 0.18 + (busy && motion ? 1.1 : 0);
    it.crown.position.y = 2.25 + Math.sin(t * 1.2) * 0.08 * motion;
    it.crown.rotation.y += dt * 0.25 * motion;
    it.sign.position.y = 4.0 + Math.sin(t * 1.8) * 0.12 * motion;
  }
  interstellarWorldPos() { const it = this.interstellarItem; return it && this.interstellar && it.robot.root.getWorldPosition(it.position); }

  /* ---------- Research Lab: its own block, an observatory with a robot scholar ---------- */
  setLab(l) { this.lab = l; this.syncLab(); }
  syncLab() {
    if (!this.lab) return;
    let plot = this.plots.get('__lab__');
    if (!plot) {
      plot = this.makePlot('__lab__', 'Research Lab', 0); plot.isLab = true; this.plots.set('__lab__', plot);
      const [top, rim] = plot.inner.children;
      top.material.color.set('#2a3566'); rim.material.color.set('#4fd1e8');                    // deep indigo ground, cyan edge
      plot.el.classList.add('lab'); const nm = plot.el.firstChild; nm.innerHTML = icon('research', 15); nm.append(' Research Lab');
      const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.65, ...o });
      const mesh = (g, m) => { const x = new THREE.Mesh(g, m); x.castShadow = x.receiveShadow = true; return x; };
      const obs = new THREE.Group(); obs.userData.key = 'lab'; obs.position.set(0, 0, -0.9);
      const base = mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.35, 12), mat('#3a4a85')); base.position.y = 0.17;
      const tower = mesh(new THREE.CylinderGeometry(1.35, 1.6, 2.4, 12), mat('#5568a8')); tower.position.y = 1.55;
      const band = mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.18, 12), mat('#4fd1e8', { emissive: '#4fd1e8', emissiveIntensity: 0.35 })); band.position.y = 2.6;
      const domeMat = mat('#dfe8ff', { metalness: 0.35, roughness: 0.35 });
      const dome = mesh(new THREE.SphereGeometry(1.45, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMat); dome.position.y = 2.72;
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.5, 0.12), new THREE.MeshBasicMaterial({ color: '#7be8ff' })); slit.position.set(0, 3.45, 1.12); slit.rotation.x = -0.62;
      const scope = new THREE.Group(); scope.position.set(0, 3.3, 0.3);
      const tube = mesh(new THREE.CylinderGeometry(0.2, 0.28, 1.9, 10), mat('#c4a24a', { metalness: 0.4 })); tube.rotation.x = Math.PI / 2 - 0.7; tube.position.set(0, 0.35, 0.55); scope.add(tube);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.18, 12), new THREE.MeshBasicMaterial({ color: '#9ff3ff' })); lens.position.set(0, 0.95, 1.15); lens.rotation.x = -0.7; scope.add(lens);
      const winM = new THREE.MeshStandardMaterial({ color: '#102a4a', emissive: '#7be8ff', emissiveIntensity: 0.5 });
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; const wn = mesh(new THREE.BoxGeometry(0.3, 0.5, 0.06), winM); wn.position.set(Math.sin(a) * 1.5, 1.6, Math.cos(a) * 1.5); wn.rotation.y = a; obs.add(wn); }
      const door = mesh(new THREE.BoxGeometry(0.5, 0.8, 0.07), mat('#1c2750')); door.position.set(0, 0.75, 1.62);
      // glowing sign above the dome: a magnifying glass
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      g.fillStyle = '#143055'; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill(); g.lineWidth = 8; g.strokeStyle = '#4fd1e8'; g.stroke();
      g.lineWidth = 9; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.beginPath(); g.arc(58, 58, 24, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(76, 76); g.lineTo(98, 98); g.stroke();
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true })); sign.scale.set(1.4, 1.4, 1); sign.position.y = 5.4; sign.renderOrder = 10;
      obs.add(base, tower, band, dome, slit, scope, door, sign);
      // papers and books orbiting the tower: the lab is "reading"
      const papers = new THREE.Group(); papers.position.y = 2.6;
      for (let i = 0; i < 7; i++) { const p = mesh(new THREE.BoxGeometry(0.5, 0.04, 0.38), mat(i % 2 ? '#fff6dc' : '#bde9f3')); const a = i / 7 * Math.PI * 2; p.position.set(Math.sin(a) * 3.1, Math.sin(i * 1.7) * 0.5, Math.cos(a) * 3.1); p.rotation.set(0.3 * i, a, 0.4); p.userData.ph = i; papers.add(p); }
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.7, 3.88, 56), new THREE.MeshBasicMaterial({ color: '#4fd1e8', transparent: true, opacity: 0.7, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
      const sp = new Float32Array(44 * 3); for (let i = 0; i < 44; i++) { const a = Math.random() * 6.283, r = 1.8 + Math.random() * 3.6; sp.set([Math.sin(a) * r, 0.4 + Math.random() * 4.2, Math.cos(a) * r], i * 3); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      const sparkles = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#8ff0ff', size: 4, sizeAttenuation: false, transparent: true, opacity: 0.85 })); sparkles.frustumCulled = false;
      // the scholar: cyan robot with round gold glasses and a scroll
      const robot = new Robot('#4fd1e8', 1.1); robot.root.userData.key = 'lab'; robot.phase = 2.1;
      const gold = mat('#e8c46b', { metalness: 0.4 });
      for (const x of [-0.1, 0.1]) { const lensR = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.017, 6, 14), gold); lensR.position.set(x, 0.01, 0.215); robot.head.add(lensR); }
      const bridge = mesh(new THREE.BoxGeometry(0.06, 0.016, 0.016), gold); bridge.position.set(0, 0.015, 0.215); robot.head.add(bridge);
      const scroll = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 8), mat('#fff3d2')); scroll.rotation.z = Math.PI / 2; scroll.position.set(-0.28, 0.5, 0.2); robot.rig.add(scroll);
      robot.root.position.set(0.5, 0.1, 2.6); robot.root.rotation.y = 0.4;
      plot.inner.add(obs, papers, ring, sparkles, robot.root);
      this.labItem = { obs, papers, ring, sparkles, robot, sign, winM, slit, scope };
    }
    plot.dying = false; this.labItem.robot.setStatus(this.lab.status === 'working' ? 'working' : 'idle');
  }
  tickLab(t, dt) {
    const it = this.labItem; if (!it || !this.lab) return;
    const busy = this.lab.status === 'working', k = busy ? 1 : 0.35;
    it.robot.mode = busy ? 'hammer' : Math.sin(t * 0.3) > 0.85 ? 'wave' : 'idle'; it.robot.update(t, dt);
    it.papers.rotation.y += dt * (busy ? 0.55 : 0.12);
    for (const p of it.papers.children) { p.position.y = Math.sin(t * 1.3 + p.userData.ph * 1.7) * 0.5; p.rotation.x += dt * 0.6 * k; }
    it.scope.rotation.y = Math.sin(t * (busy ? 0.9 : 0.25)) * 0.5; it.scope.rotation.x = busy ? Math.sin(t * 1.5) * 0.06 : 0;
    it.ring.rotation.z -= dt * 0.2; it.ring.material.opacity = 0.5 + Math.sin(t * 2) * 0.2 + (busy ? 0.15 : 0);
    it.sign.position.y = 5.4 + Math.sin(t * 1.6) * 0.12; it.sparkles.rotation.y -= dt * 0.12; it.sparkles.material.opacity = 0.55 + Math.sin(t * 4) * 0.3;
    it.winM.emissiveIntensity = 0.45 + this.night * 1.8 + (busy ? 0.9 + Math.sin(t * 6) * 0.3 : 0);
    it.slit.material.color.set(busy ? '#d9fbff' : '#7be8ff');
  }
  labWorldPos() { return this.labItem && this.labItem.robot.root.getWorldPosition(new THREE.Vector3()); }

  /* ---------- agent guild: one pedestal + robot per agent file in ~/.claude/agents ---------- */
  setAgents(list) { this.agents = list; this.syncGuild(); }
  syncGuild() {
    if (!this.agents.length) return;
    let plot = this.plots.get('__guild__');
    if (!plot) {
      plot = this.makePlot('__guild__', 'Agent Guild', 0); plot.isGuild = true; this.plots.set('__guild__', plot);
    }
    plot.dying = false;
    const names = new Set(this.agents.map(a => a.name));
    for (const [n, it] of this.guildItems) if (!names.has(n)) { plot.inner.remove(it.ped, it.robot.root); it.robot.dispose(); it.el.remove(); this.guildItems.delete(n); }
    const total = this.agents.length;
    this.agents.forEach((a, i) => {
      let it = this.guildItems.get(a.name);
      if (!it) {
        const key = 'agent:' + a.name;
        const ped = new THREE.Group(); ped.userData.key = key;
        const mat = new THREE.MeshStandardMaterial({ color: a.color, flatShading: true, emissive: a.color, emissiveIntensity: 0 });
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.35, 8), mat); base.position.y = 0.17; base.castShadow = base.receiveShadow = true;
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.12, 8), new THREE.MeshStandardMaterial({ color: '#f2efe8', flatShading: true })); top.position.y = 0.41; top.receiveShadow = true;
        ped.add(base, top);
        const el = document.createElement('div'); el.className = 'agent-label'; el.innerHTML = icon(a.name, 13, a.color); el.append(' ' + a.name);
        const label = new CSS2DObject(el); label.position.set(0, 2.6, 0); ped.add(label);
        const robot = new Robot(a.color, 0.9); robot.root.userData.key = key; robot.root.position.y = 0.47; robot.phase = i * 1.7;
        plot.inner.add(ped, robot.root);
        it = { ped, robot, mat, el, a, key }; this.guildItems.set(a.name, it);
      }
      it.a = a; it.angle = (i / total) * Math.PI * 2 + 0.4; it.r = total > 1 ? 2.9 : 0;
      it.ped.position.set(Math.sin(it.angle) * it.r, 0, Math.cos(it.angle) * it.r);
      it.robot.root.position.x = it.ped.position.x; it.robot.root.position.z = it.ped.position.z;
      it.robot.root.rotation.y = it.angle + Math.PI;
      it.robot.setStatus(a.status);
    });
  }
  tickGuild(t, dt) {
    const gp = this.plots.get('__guild__'), far = gp ? this.camera.position.distanceTo(gp.group.position) > 48 : false;
    for (const it of this.guildItems.values()) {
      const st = it.a.status;
      it.robot.mode = st === 'working' ? 'hammer' : st === 'needs' ? 'wave' : 'idle';
      it.mat.emissiveIntensity += ((st === 'working' ? 0.55 + Math.sin(t * 6) * 0.2 : st === 'needs' ? 0.3 : 0) - it.mat.emissiveIntensity) * Math.min(1, dt * 8);
      it.robot.update(t, dt);
      it.el.style.opacity = far ? '0' : '1';   // names only when you are close enough to read them
    }
  }
  agentWorldPos(key) { const it = this.guildItems.get(key.slice(6)); return it && it.ped.getWorldPosition(new THREE.Vector3()); }

  applyStatus(a, s) {
    const look = lookOf(s), family = familyOf(s);
    a.status = s.status; a.main.setStatus(s.status);
    const ids = new Set();
    for (const h of s.helpers) {
      ids.add(h.id);
      let r = a.helperBots.get(h.id);
      if (!r) {
        r = new Robot(family === 'other' ? look.accent : look.color, 0.48, family); r.root.userData.key = s.key; r.root.position.copy(a.main.root.position); a.plot.inner.add(r.root);
        a.helperBots.set(h.id, r);
      }
      r.active = h.active; r.setStatus(h.active ? 'working' : 'idle');
    }
    for (const [id, r] of a.helperBots) if (!ids.has(id)) { a.plot.inner.remove(r.root); r.dispose(); a.helperBots.delete(id); }
  }

  makeAgent(s, plot) {
    const look = lookOf(s), family = familyOf(s);
    const theme = plot.isInterstellar ? { ...this.theme, roof: 'gable', walls: ['#b89970', '#c4a777'], roofs: ['#8b6038', '#a87942', '#735036'] } : this.theme;
    const bld = new Building(theme, s);
    const a = { key: s.key, bld, session: s, plot, dying: false, grow: 0, foldT: 0, scale: 1, target: new THREE.Vector3(), pos: new THREE.Vector3(), angle: Math.random() * 6.28, hammer: Math.random() * 10, helperBots: new Map(), status: s.status };
    a.main = new Robot(look.color, 0.8, family); a.main.root.userData.key = s.key;
    plot.inner.add(bld.group, a.main.root);
    bld.group.scale.set(0.001, 0.001, 0.001);
    this.buildings.set(s.key, a);
    return a;
  }

  /* ---------- lighting / time ---------- */
  hourNow() { if (this.timeOverride != null) return this.timeOverride; const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
  updateLighting() {
    const h = this.hourNow(), th = this.theme, moonWorld = th.id === 'moon';
    const isDay = h >= 6 && h < 18, dayAng = ((h - 6) / 12) * Math.PI;
    const nightAng = (((h + 6) % 24) / 12) * Math.PI;               // moon arc 18 -> 6
    const e = isDay ? Math.sin(dayAng) : -0.35 * Math.sin(nightAng) - 0.1;
    const dayW = smooth(0.12, 0.5, e), nightW = smooth(0.06, -0.2, e), duskW = Math.max(0, 1 - dayW - nightW);
    this.night = nightW;
    const mix = (d, u, n) => C(d).multiplyScalar(dayW).add(C(u).multiplyScalar(duskW)).add(C(n).multiplyScalar(nightW));
    const top = mix(th.sky.day[0], th.sky.dusk[0], th.sky.night[0]), bot = mix(th.sky.day[1], th.sky.dusk[1], th.sky.night[1]);
    this.skyMat.uniforms.top.value.copy(top); this.skyMat.uniforms.bot.value.copy(bot); this.scene.fog.color.copy(bot);
    this.sun.color.copy(mix(th.light.day, th.light.dusk, th.light.night));
    const la = isDay ? dayAng : nightAng;
    const dir = new THREE.Vector3(-Math.cos(la), Math.max(0.3, Math.sin(la)), 0.5).normalize();
    this.sun.position.copy(dir.multiplyScalar(100));
    this.sun.intensity = (moonWorld ? 3.2 : 2.6) * dayW + 2.3 * duskW + 1.0 * nightW;
    this.hemi.color.copy(top).lerp(C('#ffffff'), 0.4); this.hemi.groundColor.set(th.hemiGround);
    this.hemi.intensity = 0.95 * dayW + 1.0 * duskW + (moonWorld ? 1.2 : 0.95) * nightW + (moonWorld ? 0.2 : 0);
    const sc = this.sun.shadow.camera, ext = this.extent + 12;
    if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 300; sc.updateProjectionMatrix(); }
    const cp = this.camera.position;
    this.sky.position.copy(cp); this.stars.position.copy(cp);
    this.stars.material.opacity = th.stars === 'always' ? 1 : nightW; this.stars.visible = th.stars === 'always' || nightW > 0.02;
    const bodyPos = (a, z) => new THREE.Vector3(-Math.cos(a), Math.sin(a) * 0.85 + 0.1, z).normalize().multiplyScalar(780).add(cp);
    this.sunMesh.position.copy(bodyPos(Math.min(Math.max(dayAng, -0.2), Math.PI + 0.2), -0.4)); this.sunMesh.visible = e > -0.12 || isDay;
    this.sunMesh.material.color.copy(C('#fff4c8').lerp(C('#ff8a4a'), duskW)); this.sunMesh.scale.setScalar(moonWorld ? 0.45 : 1);
    this.moonMesh.position.copy(bodyPos(nightAng, -0.4)); this.moonMesh.visible = !isDay && !moonWorld;
    if (moonWorld) { this.earth.position.set(-260, 170, -560).add(cp); this.earth.rotation.y += 0.0005; }
    if (this.cloudMat) { this.cloudMat.color.copy(C('#ffffff').lerp(C('#ffb59a'), duskW * 0.8).lerp(C('#5b577f'), nightW)); this.cloudMat.emissive.copy(C('#ffd0c0').lerp(C('#220a30'), nightW)); }
    if (this.fireflies) this.fireflies.material.opacity = nightW * 0.9;
  }

  /* ---------- per-frame ---------- */
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05); this.t += dt; const t = this.t;
    let maxR = 0; for (const p of this.plots.values()) maxR = Math.max(maxR, p.target.length() + S); this.extent = Math.max(maxR, 14);
    this.updateLighting();
    let pr = 0; for (const p of this.plots.values()) if (!p.isGuild && !p.isBella && !p.isLab && !p.isInterstellar) pr = Math.max(pr, p.target.length() + S);   // the special blocks must not influence where they are placed
    const gp = this.plots.get('__guild__'); if (gp) gp.target.set(-(pr + S * 1.2), 0, 0);
    const ip = this.plots.get('__interstellar__'), bp = this.plots.get('__bella__');
    const lp = this.plots.get('__lab__'); if (lp) lp.target.set(-(pr + S * 1.2) - S * 1.04 * Math.sqrt(3) / 2, 0, S * 1.04 * 1.5);   // the Lab stays below the Guild
    this.syncFamily(pr);
    for (const [path, p] of this.plots) {
      if ((p.isGuild || p.isBella || p.isLab || p.isInterstellar) && p.grow < 0.05) p.group.position.copy(p.target);   // special blocks start at their spot, they don't slide in
      p.grow += ((p.dying ? 0 : 1) - p.grow) * (1 - Math.exp(-dt * 4));
      p.group.scale.setScalar(Math.max(0.001, p.grow));
      const k = 1 - Math.exp(-dt * 3);
      p.group.position.x += (p.target.x - p.group.position.x) * k; p.group.position.z += (p.target.z - p.group.position.z) * k;
      p.group.position.y = this.theme.floating ? ((p.isBella || p.isInterstellar) && this.reducedMotion.matches ? 0 : Math.sin(t * 0.6 + ((p.isBella || p.isInterstellar) ? 0 : p.phase)) * 0.35) : 0;
      p.el.style.opacity = Math.min(1, p.grow);
      if (p.dying && p.grow < 0.03) { this.disposePlot(p); this.plots.delete(path); }
    }
    if (this.family && bp && ip) {
      // Keep the seam closed throughout growth and relocation.
      ip.group.position.copy(bp.group.position); ip.group.position.x += S * Math.sqrt(3);
      bp.group.scale.setScalar(1); ip.group.scale.setScalar(1);
      this.family.group.position.copy(bp.group.position); this.family.group.position.x += S * Math.sqrt(3) / 2;
      this.family.group.visible = bp.group.visible && ip.group.visible;
      for (let i = 1; i < bp.foundation.length; i++) bp.foundation[i].visible = !this.family.group.visible;
      for (let i = 1; i < ip.foundation.length; i++) ip.foundation[i].visible = !this.family.group.visible;
    }
    for (const a of this.buildings.values()) this.tickAgent(a, t, dt);
    this.tickGuild(t, dt); this.tickBella(t, dt); this.tickLab(t, dt); this.tickInterstellar(t, dt);
    for (const a of [...this.dying]) {
      a.foldT += dt * 2.2; const k = Math.max(0, 1 - a.foldT);
      a.bld.group.scale.set(a.scale * (1 + (1 - k) * 0.2), Math.max(0.001, a.scale * k * k), a.scale * (1 + (1 - k) * 0.2));
      a.main.root.scale.setScalar(Math.max(0.001, 0.8 * k)); for (const r of a.helperBots.values()) r.root.scale.setScalar(Math.max(0.001, 0.48 * k));
      if (a.foldT >= 1) {
        a.plot.inner.remove(a.main.root, a.bld.group); a.main.dispose(); for (const r of a.helperBots.values()) { a.plot.inner.remove(r.root); r.dispose(); }
        a.bld.dispose(); this.dying.splice(this.dying.indexOf(a), 1);
      }
    }
    for (const c of this.clouds) { c.position.x += c.userData.speed * dt; if (c.position.x > 230) c.position.x = -230; }
    if (this.fireflies) { const p = this.fireflies.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, 0.8 + 1.8 * (Math.sin(t * 0.7 + i) * 0.5 + 0.5) + (i % 5) * 0.4); p.needsUpdate = true; }
    this.stepFly(dt);
    const gsel = this.selected && (this.selected === 'interstellar' ? this.interstellarWorldPos() : this.selected === 'bella' ? this.bellaWorldPos() : this.selected === 'lab' ? this.labWorldPos() : this.selected.startsWith('agent:') && this.agentWorldPos(this.selected));
    if (gsel) { this.ring.visible = true; this.ring.position.set(gsel.x, gsel.y + 0.12, gsel.z); this.ring.scale.setScalar(1.0 + Math.sin(t * 4) * 0.05); }
    const sel = !gsel && this.selected && this.buildings.get(this.selected);
    if (!gsel && !sel) this.ring.visible = false;
    if (sel) { const wp = sel.bld.group.getWorldPosition(new THREE.Vector3()); this.ring.visible = true; this.ring.position.set(wp.x, wp.y + 0.12, wp.z); this.ring.scale.setScalar(1.35 * sel.scale + Math.sin(t * 4) * 0.05); }
    // ambient life: swaying trees, spinning crystals
    for (const p of this.plots.values()) if (p.decor) for (const ch of p.decor.children) {
      const u = ch.userData;
      if (u.crystal) u.crystal.rotation.y += dt * 0.9;
      if (u.sway) { ch.rotation.z = Math.sin(t * 0.9 + u.ph) * 0.035; ch.rotation.x = Math.cos(t * 0.7 + u.ph) * 0.03; }
    }
    // miniature blur fades as you zoom in; bloom grows at night
    const dist = this.camera.position.distanceTo(this.controls.target), dpr = this.renderer.getPixelRatio();
    this.grade.uniforms.amount.value = this.lite ? 0 : Math.min(1, Math.max(0, (dist - 14) / 45)) * 5.5 * dpr;
    if (this.bloom) this.bloom.strength = 0.22 + 0.5 * this.night;
    // gentle drift when you leave it alone
    this.controls.autoRotateSpeed = 0.35;
    this.controls.autoRotate = !this.interacting && !this.selected && !this.fly && performance.now() - this.idleAt > 15000;
    this.controls.update();
    this.composer.render(); this.labels.render(this.scene, this.camera);
  }

  tickAgent(a, t, dt) {
    a.bld.group.visible = a.main.root.visible = !a.hidden;
    for (const r of a.helperBots.values()) r.root.visible = !a.hidden;
    if (a.hidden) return;
    const bg = a.bld.group, hv = this.hover === a.key ? 1.06 : 1;
    a.grow = Math.min(1, a.grow + dt / 0.9);
    const e = a.grow < 1 ? easeOutBack(a.grow) : 1, xz = Math.max(0.001, a.scale * (0.7 + 0.3 * e) * hv);
    bg.scale.set(xz, Math.max(0.001, a.scale * e * hv), xz);
    a.pos.lerp(a.target, 1 - Math.exp(-dt * 3)); bg.position.copy(a.pos);
    a.bld.setStatus(a.status, this.night);
    a.bld.beacon.scale.setScalar(a.status === 'needs' ? 1 + Math.sin(t * 7) * 0.35 : a.status === 'working' ? 1 + Math.sin(t * 3) * 0.12 : 1);
    if (a.bld.flag) a.bld.flag.rotation.y = Math.sin(t * 3 + a.angle) * 0.4;
    a.bld.bodyMat.emissive.setScalar(this.hover === a.key ? 0.14 : 0);

    const rr = (a.bld.w * 0.5 + 0.7) * a.scale + 0.25, m = a.main;
    let mode = 'idle', pa = a.angle;
    if (a.status === 'working') {
      a.hammer += dt;
      if (Math.sin(a.hammer * 0.5) > 0.3) mode = 'hammer'; else { mode = 'walk'; a.angle += dt * 0.9; pa = a.angle; }
    } else if (a.status === 'needs') { mode = 'wave'; pa = 0.35; }
    else if (a.status === 'sleeping') { mode = 'sleep'; pa = 0.9; }
    else pa = 0.9;
    if (a.status !== 'working') a.angle += angDiff(pa, a.angle) * (1 - Math.exp(-dt * 2));
    const px = a.pos.x + Math.sin(pa) * rr, pz = a.pos.z + Math.cos(pa) * rr;
    m.root.visible = a.grow > 0.4;
    const px0 = m.root.position.x, pz0 = m.root.position.z, kk = 1 - Math.exp(-dt * (mode === 'walk' ? 10 : 4));
    m.root.position.x += (px - px0) * kk; m.root.position.z += (pz - pz0) * kk;
    const moving = Math.hypot(m.root.position.x - px0, m.root.position.z - pz0) / Math.max(dt, 1e-4);
    if (mode === 'idle' && moving > 0.6) mode = 'walk';
    let face = Math.atan2(a.pos.x - m.root.position.x, a.pos.z - m.root.position.z);   // toward the building
    if (mode === 'walk') face += Math.PI / 2;                                            // walk along the circle
    else if (mode === 'wave') face = pa;                                                 // face the viewer-side
    m.root.rotation.y += angDiff(face, m.root.rotation.y) * (1 - Math.exp(-dt * 8));
    m.mode = mode; m.update(t, dt);

    let i = 0;
    for (const r of a.helperBots.values()) {
      const ha = pa + 1.2 + i * 1.3 + Math.sin(t * 0.5 + i) * 0.25, hr = rr + 0.5 + i * 0.12;
      const tx = a.pos.x + Math.sin(ha) * hr, tz = a.pos.z + Math.cos(ha) * hr, x0 = r.root.position.x, z0 = r.root.position.z, hk = 1 - Math.exp(-dt * 3);
      r.root.position.x += (tx - x0) * hk; r.root.position.z += (tz - z0) * hk;
      const mv = Math.hypot(r.root.position.x - x0, r.root.position.z - z0) / Math.max(dt, 1e-4);
      r.mode = mv > 0.4 ? 'walk' : r.active ? 'hammer' : 'idle';
      const hf = r.mode === 'walk' ? Math.atan2(tx - x0, tz - z0) : Math.atan2(a.pos.x - r.root.position.x, a.pos.z - r.root.position.z);
      r.root.rotation.y += angDiff(hf, r.root.rotation.y) * (1 - Math.exp(-dt * 8));
      r.root.visible = a.grow > 0.4; r.update(t, dt); i++;
    }
  }

  /* ---------- picking / camera ---------- */
  pick(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const objs = []; for (const a of this.buildings.values()) objs.push(a.bld.group, a.main.root, ...[...a.helperBots.values()].map(r => r.root));
    for (const it of this.guildItems.values()) objs.push(it.ped, it.robot.root);
    if (this.interstellarItem && this.interstellar) objs.push(this.interstellarItem.hole, this.interstellarItem.robot.root);
    if (this.bellaItem) objs.push(this.bellaItem.hq, this.bellaItem.robot.root);
    if (this.labItem) objs.push(this.labItem.obs, this.labItem.robot.root);
    const hit = this.raycaster.intersectObjects(objs, true).find(h => h.object.isMesh);
    if (!hit) return null;
    let o = hit.object; while (o && !o.userData.key) o = o.parent;
    return o?.userData.key ?? null;
  }
  setSelected(key) { this.selected = key; if (!key) this.ring.visible = false; }
  screenPos(key) {
    if (key === 'interstellar') { const w = this.interstellarWorldPos(); if (!w) return null; w.y += 3.2; w.project(this.camera); return { x: (w.x * 0.5 + 0.5) * this.host.clientWidth, y: (-w.y * 0.5 + 0.5) * this.host.clientHeight, behind: w.z > 1 }; }
    if (key === 'lab') { const w = this.labWorldPos(); if (!w) return null; w.y += 3.2; w.project(this.camera); return { x: (w.x * 0.5 + 0.5) * this.host.clientWidth, y: (-w.y * 0.5 + 0.5) * this.host.clientHeight, behind: w.z > 1 }; }
    if (key === 'bella') { const w = this.bellaWorldPos(); if (!w) return null; w.y += 3.2; w.project(this.camera); return { x: (w.x * 0.5 + 0.5) * this.host.clientWidth, y: (-w.y * 0.5 + 0.5) * this.host.clientHeight, behind: w.z > 1 }; }
    if (key.startsWith('agent:')) {
      const w = this.agentWorldPos(key); if (!w) return null; w.y += 2.6; w.project(this.camera);
      return { x: (w.x * 0.5 + 0.5) * this.host.clientWidth, y: (-w.y * 0.5 + 0.5) * this.host.clientHeight, behind: w.z > 1 };
    }
    const a = this.buildings.get(key); if (!a) return null;
    const v = a.bld.group.getWorldPosition(new THREE.Vector3()); v.y += a.bld.top * a.scale + 0.3; v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.host.clientWidth, y: (-v.y * 0.5 + 0.5) * this.host.clientHeight, behind: v.z > 1 };
  }
  flyTo(target, dist, keepAngle = true) {
    this.idleAt = performance.now();
    this.scene.fog.near = 80; this.scene.fog.far = 380;
    const off = this.camera.position.clone().sub(this.controls.target);
    if (keepAngle) { off.setLength(dist); if (off.y < dist * 0.45) { off.y = dist * 0.55; off.setLength(dist); } } else off.set(0.4, 0.58, 0.85).setLength(dist);
    this.fly = { t: 0, dur: 1.15, fromT: this.controls.target.clone(), fromP: this.camera.position.clone(), toT: target.clone(), toP: target.clone().add(off) };
  }
  flyToSession(key) {
    if (key === 'interstellar') { const w = this.interstellarWorldPos(); if (w) this.flyTo(w.add(new THREE.Vector3(0, 1.2, -1.5)), 17); return; }
    if (key === 'lab') { const w = this.labWorldPos(); if (w) this.flyTo(w.add(new THREE.Vector3(0, 1.2, -1.5)), 17); return; }
    if (key === 'bella') { const w = this.bellaWorldPos(); if (w) this.flyTo(w.add(new THREE.Vector3(0, 1.2, -1.5)), 17); return; }
    if (key.startsWith('agent:')) { const w = this.agentWorldPos(key); if (w) this.flyTo(w.add(new THREE.Vector3(0, 0.8, 0)), 13); return; }
    const a = this.buildings.get(key); if (!a) return;
    this.flyTo(a.bld.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.8, 0)), 15);
  }
  home() {
    const ps = [...this.plots.values()].filter(p => !p.dying && p.group.visible); if (!ps.length) return;
    const bounds = new THREE.Box3();
    for (const p of ps) {
      bounds.expandByPoint(p.target.clone().add(new THREE.Vector3(-S, -9, -S)));
      bounds.expandByPoint(p.target.clone().add(new THREE.Vector3(S, 7, S)));
    }
    const c = bounds.getCenter(new THREE.Vector3()), r = bounds.getSize(new THREE.Vector3()).length() / 2;
    const back = new THREE.Vector3(0.4, 0.58, 0.85).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
    const up = new THREE.Vector3().crossVectors(back, right);
    const points = [], project = v => {
      const offset = v.clone().sub(c);
      return { x: offset.dot(right), y: offset.dot(up), z: offset.dot(back) };
    };
    for (const p of ps) {
      for (const x of [-S, S]) for (const y of [-9, 7]) for (const z of [-S, S]) points.push(project(p.target.clone().add(new THREE.Vector3(x, y, z))));
      const chip = p.el.getBoundingClientRect(), center = p.label.center;
      points.push({ ...project(p.target.clone().add(p.label.position)), left: chip.width * center.x, right: chip.width * (1 - center.x), top: chip.height * (1 - center.y), bottom: chip.height * center.y });
    }
    const distance = overviewDistance(points, this.camera.fov, this.host.clientWidth, this.host.clientHeight);
    this.controls.maxDistance = Math.max(160, distance * 1.1);
    this.flyTo(c, distance, false);
    // A portrait Overview can be farther away than the normal atmospheric range.
    this.camera.far = Math.max(2000, distance + r + 100); this.camera.updateProjectionMatrix();
    this.scene.fog.near = Math.max(80, distance + r);
    this.scene.fog.far = Math.max(380, distance + r * 2);
  }
  stepFly(dt) {
    const f = this.fly; if (!f) return;
    f.t += dt / f.dur; const k = Math.min(1, f.t), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    this.controls.target.lerpVectors(f.fromT, f.toT, e); this.camera.position.lerpVectors(f.fromP, f.toP, e);
    if (k >= 1) this.fly = null;
  }
}
