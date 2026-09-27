// apps/employee-mobile/src/landing/landing-scene.js - the landing mascot (D-41) played live with the vendored Three.js:
// the Blender model and animation (tools/ai/blender/landing_soul3d.py -> art/soul-hi.glb) fly in from the distance,
// land in front of the player and wave, then loop an idle bob. Three.js adds what the GLB cannot carry: a soft glow on
// the antenna orb, a sparkle trail while flying and a puff of star dust on touchdown. createLandingScene() resolves
// null when WebGL or the modules are unavailable; the caller keeps the still image then.
import { loadThree } from '../scene/loader.js';

const GLB = '/play/art/soul-hi.glb';
const FPS = 24;
const INTRO_END = 104 / FPS;       // fly in + land + wave
const IDLE = [104 / FPS, 152 / FPS];
const TOUCHDOWN = 46 / FPS;

function glowTexture(THREE, inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner); grad.addColorStop(0.35, outer); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Mounts the scene in `host` (a sized element). Options: { reduced, onLanded } - reduced motion skips the flight and
 * shows the final pose without looping; onLanded fires once at touchdown (the landing screen reveals its copy then).
 * Resolves { dispose } or null.
 */
export async function createLandingScene(host, { reduced = false, onLanded = () => {} } = {}) {
  let THREE, addons;
  try { ({ THREE, addons } = await loadThree()); } catch { return null; }
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return null;

  let gltf;
  try { gltf = await new addons.GLTFLoader().loadAsync(GLB); } catch { return null; }
  if (!host.isConnected) return null;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'landing__canvas';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  camera.position.set(0, 1.25, 7.2); camera.lookAt(0, 1.1, 0);   // the Blender camera, Y-up
  scene.add(new THREE.HemisphereLight(0xcfc4ff, 0x1a1045, 1.1));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.2); key.position.set(-2.5, 4, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7cf5c8, 2.0); rim.position.set(1.5, 3, -3.5); scene.add(rim);
  const violet = new THREE.DirectionalLight(0x8b4fe8, 1.2); violet.position.set(-3, 1, -2); scene.add(violet);

  const model = gltf.scene; scene.add(model);
  const root = model.getObjectByName('ariseSoulHi') || model;
  const orb = model.getObjectByName('orb');
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, 'rgba(255,245,210,1)', 'rgba(255,200,110,0.55)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(1.1, 1.1, 1);
  if (orb) orb.add(glow);

  const mixer = new THREE.AnimationMixer(model);
  const clip = gltf.animations[0];
  const intro = clip ? mixer.clipAction(clip) : null;
  const idleClip = clip ? THREE.AnimationUtils.subclip(clip, 'idle', IDLE[0] * FPS, IDLE[1] * FPS, FPS) : null;
  const idle = idleClip ? mixer.clipAction(idleClip) : null;
  if (intro) { intro.setLoop(THREE.LoopOnce, 1); intro.clampWhenFinished = true; intro.play(); }

  // sparkle trail + touchdown dust: pooled additive sprites
  const sparkTex = glowTexture(THREE, 'rgba(255,255,255,1)', 'rgba(185,168,255,0.6)');
  const pool = Array.from({ length: 48 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    s.visible = false; scene.add(s); return { s, life: 0, max: 1, v: new THREE.Vector3() };
  });
  let next = 0;
  function emit(pos, v, size, life, color) {
    const p = pool[next++ % pool.length];
    p.s.position.copy(pos); p.v.copy(v); p.life = p.max = life; p.s.visible = true;
    p.s.scale.setScalar(size); p.s.material.color.set(color);
  }
  const tmp = new THREE.Vector3();

  let w = 0, h = 0;
  function resize() {
    const r = host.getBoundingClientRect();
    if (r.width === w && r.height === h) return;
    w = r.width; h = r.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  let lastNow = performance.now(), elapsed = 0;
  const tick = () => { const now = performance.now(); const dt = (now - lastNow) / 1000; lastNow = now; elapsed += dt; return dt; };
  let raf = 0, landed = false, idleOn = false, disposed = false, lastEmit = 0;
  if (reduced && intro) { intro.time = INTRO_END; mixer.update(0); landed = true; onLanded(); }

  function frame() {
    raf = 0;
    if (disposed) return;
    const dt = Math.min(0.05, tick());
    const t = intro ? intro.time : INTRO_END;
    if (!reduced) {
      mixer.update(dt);
      if (!idleOn && intro && t >= INTRO_END - 0.01 && idle) { idle.reset().setLoop(THREE.LoopRepeat, Infinity).play(); intro.crossFadeTo(idle, 0.25, false); idleOn = true; }
      root.getWorldPosition(tmp);
      if (t < TOUCHDOWN && t - lastEmit > 0.03) {                      // trail while flying
        lastEmit = t; tmp.y += 1.1;
        emit(tmp, new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.2) * 0.3, (Math.random() - 0.5) * 0.3), 0.18 + Math.random() * 0.2, 0.7, Math.random() < 0.5 ? 0xb9a8ff : 0x7cf5c8);
      }
      if (!landed && t >= TOUCHDOWN) {                                  // touchdown: a ring of star dust
        landed = true; onLanded();
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          emit(new THREE.Vector3(0, 0.08, 0), new THREE.Vector3(Math.cos(a) * 1.4, 0.25 + Math.random() * 0.3, Math.sin(a) * 0.7), 0.22, 0.9, i % 3 ? 0xe6e0ff : 0xf6c453);
        }
      }
      for (const p of pool) {
        if (!p.s.visible) continue;
        p.life -= dt;
        if (p.life <= 0) { p.s.visible = false; continue; }
        p.s.position.addScaledVector(p.v, dt); p.v.multiplyScalar(0.96);
        p.s.material.opacity = Math.min(1, p.life / p.max * 1.4);
      }
      if (orb) glow.material.opacity = 0.75 + 0.25 * Math.sin(elapsed * 2.4);
    }
    renderer.render(scene, camera);
    if (!reduced && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const onVisible = () => { if (!document.hidden && !raf && !disposed && !reduced) { tick(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVisible);
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      mixer.stopAllAction();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { for (const m of [].concat(o.material)) { if (m.map) m.map.dispose(); m.dispose(); } } });
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
