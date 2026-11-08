import * as THREE from 'three';
import { orientationToQuat, applyDrag, GazeFuse, sanitizeSettings, validateScenes, SCENES } from './vr-core.js';

const $ = id => document.getElementById(id);
const KEY = 'cardbord.settings.v1';
const problems = validateScenes(SCENES);
if (problems.length) console.error('장면 데이터 오류', problems);

// ---------------------------------------------------------------- 설정
let settings = sanitizeSettings((() => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } })());
const saveSettings = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* 저장 불가 환경 */ } };
for (const [k, unit, fmt] of [['ipd', 'mm', v => (v * 1000).toFixed(0)], ['fov', '°', v => v], ['fuse', '초', v => (+v).toFixed(1)]]) {
  const input = $(k), out = $(k + 'Out');
  input.value = settings[k];
  out.textContent = fmt(settings[k]) + unit;
  input.addEventListener('input', () => {
    settings = sanitizeSettings({ ...settings, [k]: input.value });
    out.textContent = fmt(settings[k]) + unit;
    saveSettings();
    applySettings();
  });
}

// ---------------------------------------------------------------- 렌더러·카메라
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const player = new THREE.Group();                 // 이동은 player, 회전은 camera
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 500);
camera.position.y = 1.6;
camera.rotation.order = 'YXZ';
player.add(camera);
scene.add(player);
const stereo = new THREE.StereoCamera();
let world = new THREE.Group();
scene.add(world);

// 시선 표시(가운데 점 + 진행 고리)와 설명 자막은 카메라에 붙여 어느 모드에서도 보이게 함
const reticle = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.02, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
const progressRing = new THREE.Mesh(new THREE.RingGeometry(0.026, 0.034, 48, 1, 0, 0.0001), new THREE.MeshBasicMaterial({ color: 0x4fc3ff, depthTest: false }));
for (const m of [reticle, progressRing]) { m.position.z = -1; m.renderOrder = 999; camera.add(m); }
const caption = makeCaption();
camera.add(caption.sprite);

function makeCaption() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 192;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.2, 0.225, 1); sprite.position.set(0, -0.32, -1); sprite.renderOrder = 998; sprite.visible = false;
  let timer = 0;
  return {
    sprite, text: '',
    show(text, seconds = 5) {
      const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = 'rgba(0,0,0,0.72)'; g.beginPath(); g.roundRect(0, 0, cv.width, cv.height, 36); g.fill();
      g.fillStyle = '#fff'; g.font = '600 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      wrap(g, text, cv.width - 80).forEach((line, i, all) => g.fillText(line, cv.width / 2, cv.height / 2 + (i - (all.length - 1) / 2) * 54));
      tex.needsUpdate = true; sprite.visible = true; this.text = text; timer = seconds;
    },
    tick(dt) { if (timer > 0 && (timer -= dt) <= 0) { sprite.visible = false; this.text = ''; } },
  };
}
function wrap(g, text, max) {
  const out = []; let line = '';
  for (const ch of text) { if (g.measureText(line + ch).width > max) { out.push(line); line = ch; } else line += ch; }
  return [...out, line].slice(0, 3);
}

// ---------------------------------------------------------------- 장면 만들기 (외부 모델 없이 도형으로)
const hotspots = [];
const animated = [];
let current = null;

function mat(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }); }

function buildScene(id) {
  const def = SCENES.find(s => s.id === id) || SCENES[0];
  scene.remove(world);
  world.traverse(o => { o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.dispose?.()); });
  world = new THREE.Group(); scene.add(world);
  hotspots.length = 0; animated.length = 0;
  scene.background = new THREE.Color(def.sky);
  scene.fog = def.id === 'forest' ? new THREE.Fog(def.sky, 12, 45) : null;
  player.position.set(0, 0, 0);
  world.add(new THREE.HemisphereLight(0xffffff, 0x334455, def.id === 'space' ? 0.35 : 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, def.id === 'space' ? 2.2 : 1.4); sun.position.set(5, 10, 4); world.add(sun);
  ({ space: buildSpace, forest: buildForest, factory: buildFactory })[def.id]();
  def.hotspots.forEach((h, i) => addHotspot(h, `${def.id}-${i}`));
  current = def;
  $('sceneTitle').textContent = def.title;
  caption.show(def.title + ' — 빛나는 구슬을 바라보세요', 4);
}

function buildSpace() {
  const pts = new Float32Array(3000 * 3);
  for (let i = 0; i < pts.length; i += 3) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(120 + Math.random() * 60);
    pts.set([v.x, v.y, v.z], i);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  world.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true })));
  const planet = new THREE.Mesh(new THREE.SphereGeometry(3, 48, 32), mat(0xd9a066));
  planet.position.set(0, 4, -18);
  const ring = new THREE.Mesh(new THREE.RingGeometry(4, 6.2, 96), mat(0xe8d3a0, { side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
  ring.rotation.x = Math.PI / 2.4; planet.add(ring);
  world.add(planet); animated.push(dt => { planet.rotation.y += dt * 0.08; });
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.2, 48), mat(0x3a4250, { metalness: 0.4 }));
  deck.position.y = -0.1; world.add(deck);
}

function buildForest() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(0x5d8f3c));
  ground.rotation.x = -Math.PI / 2; world.add(ground);
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.22, 1.6, 8), leafGeo = new THREE.ConeGeometry(1.1, 2.6, 10);
  const trunkMat = mat(0x6b4a2b), leafMat = mat(0x2f6b34);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) {
    const x = (rnd() - 0.5) * 70, z = (rnd() - 0.5) * 70;
    if (Math.hypot(x, z) < 3 || Math.abs(x) < 1.5 && z < 0 && z > -12) continue;   // 시작 위치와 길은 비움
    const s = 0.7 + rnd() * 0.8;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.y = 0.8;
    const leaf = new THREE.Mesh(leafGeo, leafMat); leaf.position.y = 2.6;
    tree.add(trunk, leaf); tree.position.set(x, 0, z); tree.scale.setScalar(s); world.add(tree);
  }
}

function buildFactory() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat(0x505760));
  floor.rotation.x = -Math.PI / 2; world.add(floor);
  const grid = new THREE.GridHelper(40, 40, 0x7a8594, 0x5d6672);
  grid.position.y = 0.01;
  world.add(grid);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(10, 0.15, 1), mat(0x22262c));
  belt.position.set(0, 0.8, -5); world.add(belt);
  const boxes = [];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), mat([0xf0b400, 0xc81e1e, 0x1e3cc8][i % 3]));
    b.position.set(-5 + i * 1.7, 1.03, -5); world.add(b); boxes.push(b);
  }
  animated.push(dt => boxes.forEach(b => { b.position.x += dt * 0.8; if (b.position.x > 5) b.position.x = -5; }));
  // 로봇팔: 받침 → 관절 → 팔 두 마디
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.4, 24), mat(0xff8c1a));
  base.position.set(-3, 0.2, -6.5); world.add(base);
  const shoulder = new THREE.Group(); shoulder.position.y = 0.3; base.add(shoulder);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.18), mat(0xff8c1a)); upper.position.y = 0.6; shoulder.add(upper);
  const elbow = new THREE.Group(); elbow.position.y = 1.2; shoulder.add(elbow);
  const fore = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), mat(0x333333)); fore.position.y = 0.45; elbow.add(fore);
  let t = 0;
  animated.push(dt => { t += dt; shoulder.rotation.y = Math.sin(t * 0.7) * 1.2; shoulder.rotation.z = 0.3 + Math.sin(t) * 0.2; elbow.rotation.z = 0.8 + Math.sin(t * 1.3) * 0.4; });
}

function addHotspot(h, id) {
  const color = { move: 0x4fc3ff, info: 0xffd34f, scene: 0xb57bff }[h.type];
  const orb = new THREE.Mesh(new THREE.SphereGeometry(h.type === 'move' ? 0.25 : 0.3, 24, 16), new THREE.MeshBasicMaterial({ color }));
  orb.position.fromArray(h.pos);
  orb.userData.hotspot = { ...h, id };
  world.add(orb); hotspots.push(orb);
  const base = orb.position.y;
  let t = Math.random() * 6;
  animated.push(dt => { t += dt; orb.position.y = base + Math.sin(t * 2) * 0.06; orb.scale.setScalar(1 + Math.sin(t * 3) * 0.05); });
}

// ---------------------------------------------------------------- 시선 선택
const raycaster = new THREE.Raycaster();
const fuse = new GazeFuse(settings.fuse);
let moveAnim = null;

function gazeTarget() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), cam);
  const hit = raycaster.intersectObjects(hotspots, false)[0];
  return hit ? hit.object : null;
}

function activate(orb) {
  const h = orb.userData.hotspot;
  if (h.type === 'info') caption.show(h.text, 6);
  else if (h.type === 'scene') buildScene(h.to);
  else if (h.type === 'move') moveAnim = { from: player.position.clone(), to: new THREE.Vector3(h.pos[0], 0, h.pos[2] + 1.2), t: 0 };
}

// ---------------------------------------------------------------- 입력: 드래그·자이로
let mode = 'view';
let view = { yaw: 0, pitch: 0 };
let deviceQ = null, lastOrientationAt = 0;
let drag = null;

canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  view = applyDrag(view, e.clientX - drag.x, e.clientY - drag.y);
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });

function screenAngle() {
  return (screen.orientation && screen.orientation.angle) || window.orientation || 0;
}
window.addEventListener('deviceorientation', e => {
  if (e.alpha == null && e.beta == null) return;
  deviceQ = orientationToQuat(e.alpha || 0, e.beta || 0, e.gamma || 0, screenAngle());
  lastOrientationAt = performance.now();
});

async function requestMotionPermission() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') {         // iOS 13+
    try { return (await D.requestPermission()) === 'granted'; } catch (e) { return false; }
  }
  return true;
}

// ---------------------------------------------------------------- 시작·종료
const msg = t => { $('msg').textContent = t; };

async function start() {
  msg('');
  mode = document.querySelector('input[name=mode]:checked').value;
  const sceneId = document.querySelector('input[name=scene]:checked').value;
  buildScene(sceneId);
  view = { yaw: 0, pitch: 0 };

  if (mode === 'xr') {
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
      renderer.xr.enabled = true;
      await renderer.xr.setSession(session);
      session.addEventListener('end', stop);
    } catch (e) { msg('VR 헤드셋 세션을 시작하지 못했습니다: ' + e.message); return; }
  } else if (mode === 'gyro' || mode === 'cardboard') {
    const allowed = await requestMotionPermission();
    if (mode === 'cardboard') {
      try { await document.documentElement.requestFullscreen?.(); } catch (e) { /* 전체 화면 불가 */ }
      try { await screen.orientation?.lock?.('landscape'); } catch (e) { /* 방향 고정 미지원 */ }
    }
    setTimeout(() => {
      if (mode !== 'view' && !deviceQ) caption.show(allowed ? '방향 센서가 없어 드래그로 둘러봅니다' : '방향 권한이 거부되어 드래그로 둘러봅니다', 4);
    }, 1500);
  }
  $('menu').hidden = true;
  $('hud').hidden = false;
  resize();
}

function stop() {
  if (renderer.xr.isPresenting) renderer.xr.getSession()?.end();
  renderer.xr.enabled = false;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  try { screen.orientation?.unlock?.(); } catch (e) { /* 무시 */ }
  mode = 'view';
  $('menu').hidden = false;
  $('hud').hidden = true;
  resize();
}

$('startBtn').addEventListener('click', start);
$('exitBtn').addEventListener('click', stop);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('menu').hidden) stop(); });

// 장면 선택 목록
SCENES.forEach((s, i) => {
  const label = document.createElement('label');
  const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'scene', value: s.id, checked: i === 0 });
  label.append(input, ' ' + s.title);
  $('scenes').append(label);
});

// WebXR 지원 기기에서만 헤드셋 선택지 표시
navigator.xr?.isSessionSupported?.('immersive-vr').then(ok => { $('xrOption').hidden = !ok; }).catch(() => {});

function applySettings() {
  camera.fov = settings.fov; camera.updateProjectionMatrix();
  stereo.eyeSep = settings.ipd;
  fuse.duration = settings.fuse;
}
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = mode === 'cardboard' ? (innerWidth / 2) / innerHeight : innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
applySettings();

// ---------------------------------------------------------------- 루프
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const useDevice = (mode === 'gyro' || mode === 'cardboard') && deviceQ && performance.now() - lastOrientationAt < 1000;
  if (!renderer.xr.isPresenting) {
    if (useDevice) camera.quaternion.fromArray(deviceQ);
    else camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
  }
  animated.forEach(f => f(dt));
  caption.tick(dt);
  if (moveAnim) {
    moveAnim.t = Math.min(1, moveAnim.t + dt / 0.6);
    player.position.lerpVectors(moveAnim.from, moveAnim.to, moveAnim.t * (2 - moveAnim.t));
    if (moveAnim.t >= 1) moveAnim = null;
  }

  // 메뉴가 열려 있으면 선택하지 않음
  const target = $('menu').hidden ? gazeTarget() : null;
  const { progress, fire } = fuse.update(target ? target.userData.hotspot.id : null, dt);
  progressRing.geometry.dispose();
  progressRing.geometry = new THREE.RingGeometry(0.026, 0.034, 48, 1, Math.PI / 2, Math.max(0.0001, progress * Math.PI * 2));
  reticle.scale.setScalar(target ? 1.5 : 1);
  if (fire && target) activate(target);

  if (mode === 'cardboard' && !renderer.xr.isPresenting) {
    camera.updateMatrixWorld();
    stereo.update(camera);
    const w = innerWidth / 2, hgt = innerHeight;
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, w, hgt); renderer.setViewport(0, 0, w, hgt); renderer.render(scene, stereo.cameraL);
    renderer.setScissor(w, 0, w, hgt); renderer.setViewport(w, 0, w, hgt); renderer.render(scene, stereo.cameraR);
    renderer.setScissorTest(false);
  } else {
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    renderer.render(scene, camera);
  }
});

// 자동 점검용 상태 (화면 동작에는 영향 없음)
window.__cardbord = {
  state: () => ({ mode, scene: current?.id, player: player.position.toArray().map(v => +v.toFixed(2)), caption: caption.text, hotspots: hotspots.length, settings }),
  lookAt: id => {                         // 지정한 핫스팟 쪽으로 시선을 돌림
    const orb = hotspots.find(o => o.userData.hotspot.id === id);
    if (!orb) return false;
    const p = new THREE.Vector3(); orb.getWorldPosition(p);
    const c = new THREE.Vector3(); camera.getWorldPosition(c);
    const d = p.sub(c);
    view = { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
    return true;
  },
};
