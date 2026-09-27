// packages/ui/soul3d/card.js - renders a Soul rig into a square "card": the studio scene of the phone reveal (the same
// environment reflections, light rig, glow light, AgX tone mapping and exposure) seen through cardCamera(), i.e. the
// phone camera's perspective framed so the resting figure fills the card like the flat Soul fills its viewBox. The
// public Galaxy uses one card stage on an offscreen renderer (transparent, preserveDrawingBuffer) for its Float
// entrance frames and to bake settled Souls into atlas impostors; the phone never needs it. No glow sprite and no
// halo style here: the Galaxy draws its own halo behind every sticker, and the card must keep a clean alpha edge.
import { applySoulToneMapping, makeStudioEnvironment, addStudioLights, addGlowLight, cardCamera } from './studio.js';

/**
 * createSoulCardStage(THREE, renderer, { envSize }) -> { scene, camera, render(rig, rect, pose), dispose() }.
 * `renderer` must draw to a canvas with alpha (clear colour transparent); the stage sets its tone mapping.
 */
export function createSoulCardStage(THREE, renderer, { envSize = 64 } = {}) {
  applySoulToneMapping(THREE, renderer);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const env = makeStudioEnvironment(THREE, renderer, { size: envSize });
  scene.environment = env.texture;
  addStudioLights(THREE, scene);
  const glowLight = addGlowLight(THREE, scene, 0xffffff, 0);
  const cam = cardCamera();
  const camera = new THREE.PerspectiveCamera(cam.fov, 1, 0.1, 30);
  camera.position.fromArray(cam.eye);
  camera.lookAt(new THREE.Vector3().fromArray(cam.target));
  const holder = new THREE.Group();   // the rig's soul group goes in here for one render
  scene.add(holder);

  return {
    scene, camera,
    /**
     * Draws `rig` into rect { x, y, size } (drawing-buffer pixels, GL origin bottom left), clearing only that square.
     * pose (optional): { yaw (added to the rest yaw), lift (scene units), scale, tilt (radians about z), outline }.
     */
    render(rig, rect, pose = null) {
      glowLight.color.set(rig.colors.glow);
      const soul = rig.soul;
      const restYaw = rig.turn.userData.restYaw ?? (rig.turn.userData.restYaw = rig.turn.rotation.y);
      rig.turn.rotation.y = restYaw + (pose && pose.yaw ? pose.yaw : 0);
      soul.position.set(0, pose && pose.lift ? pose.lift : 0, 0);
      soul.scale.setScalar(pose && pose.scale ? pose.scale : 1);
      soul.rotation.z = pose && pose.tilt ? pose.tilt : 0;
      if (pose && Number.isFinite(pose.outline)) rig.figure.setOutline(pose.outline);
      holder.add(soul);
      renderer.setViewport(rect.x, rect.y, rect.size, rect.size);
      renderer.setScissor(rect.x, rect.y, rect.size, rect.size);
      renderer.setScissorTest(true);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      renderer.setScissorTest(false);
      holder.remove(soul);
    },
    dispose() { env.dispose(); scene.environment = null; },
  };
}
