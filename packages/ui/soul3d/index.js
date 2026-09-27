// packages/ui/soul3d - one code path for every 3D Soul (D-29 docs/art/soul-decorations.md and D-31
// docs/art/soul-faces.md "Rendering: one Soul everywhere"): the phone reveal / Float (apps/employee-mobile/src/scene)
// and the public Galaxy's Float entrance and atlas impostors (apps/public-galaxy/src/renderer) build their Souls from
// these modules. Three.js is always passed in
// (mods = { THREE, addons: { GLTFLoader } }), so nothing here imports the vendored library and the pure parts
// (tint, placement, framing, decor plans) run under node --test.
export * from './tint.js';
export * from './studio.js';
export * from './placement.js';
export * from './model.js';
export * from './decor.js';
export * from './badge.js';
export * from './figure.js';
export * from './rig.js';
export * from './card.js';
