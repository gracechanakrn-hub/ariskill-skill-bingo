// GENERATED FILE - do not hand-edit. Regenerate with: npm run ai:soul-face (tools/ai/blender/soul_face.py --mode data).
// Stage 13 (D-31, docs/art/soul-faces.md): the v3 body, the 10 face plates, the 10 eye designs, the refitted face kits,
// the antenna-charm slot and the v3 2D outline. Frozen data, no imports: Node and browsers. Every URL carries
// ?v=<sha256 prefix> of its file. Plates, eyes and kits are model-space GLBs placed at identity; their sprites are drawn
// at rect [x, y, w, h] of the 200 viewBox. topper is a charm slot: charmPlacement(topper, SOUL_DECOR.charm.thickness)
// in 3D, the charm PNG 2 r wide centred on topper.front2d in 2D. shape.silhouette is the v3 body outline (MAPPING of
// soul-baseline-shape.js).

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}

export const SOUL_FACE = deepFreeze({
  "stub": false,
  "version": 1,
  "catalogVersion": 2,
  "generator": "tools/ai/blender/soul_face.py --mode data (npm run ai:soul-face)",
  "frame": "glTF model space of the baseline GLBs: +Y up, +Z front, model units, feet at y = floor",
  "floor": -0.02189,
  "height": 2.29087,
  "body": {
    "hero": "/assets/souls/v3/body-hero.glb?v=91a5884245",
    "lite": "/assets/souls/v3/body-lite.glb?v=5a81b6c221"
  },
  "plates": {
    "crack": {
      "glb": "/assets/souls/v3/plate-crack.glb?v=aa6ee8424d",
      "sprite": "/assets/souls/v3/plate-crack.png?v=e346c3be08",
      "rect": [
        79.0,
        76.5,
        42.0,
        40.25
      ]
    },
    "bean": {
      "glb": "/assets/souls/v3/plate-bean.glb?v=a959eb143e",
      "sprite": "/assets/souls/v3/plate-bean.png?v=395e0abe44",
      "rect": [
        79.0,
        83.25,
        42.0,
        29.0
      ]
    },
    "notch": {
      "glb": "/assets/souls/v3/plate-notch.glb?v=e0a4a1ed69",
      "sprite": "/assets/souls/v3/plate-notch.png?v=57a4102252",
      "rect": [
        79.0,
        77.0,
        42.0,
        35.25
      ]
    },
    "skull-x": {
      "glb": "/assets/souls/v3/plate-skull-x.glb?v=7edbb5eea3",
      "sprite": "/assets/souls/v3/plate-skull-x.png?v=9807e8166e",
      "rect": [
        79.25,
        77.0,
        41.5,
        39.75
      ]
    },
    "bow": {
      "glb": "/assets/souls/v3/plate-bow.glb?v=8baaede8ee",
      "sprite": "/assets/souls/v3/plate-bow.png?v=0d07eec2ae",
      "rect": [
        79.0,
        83.75,
        42.0,
        26.75
      ]
    },
    "round": {
      "glb": "/assets/souls/v3/plate-round.glb?v=94f36de40f",
      "sprite": "/assets/souls/v3/plate-round.png?v=f039e7a828",
      "rect": [
        79.0,
        76.0,
        42.0,
        40.75
      ]
    },
    "bat": {
      "glb": "/assets/souls/v3/plate-bat.glb?v=cd84fefdd7",
      "sprite": "/assets/souls/v3/plate-bat.png?v=a1a14468d8",
      "rect": [
        79.0,
        78.75,
        42.0,
        33.5
      ]
    },
    "dome": {
      "glb": "/assets/souls/v3/plate-dome.glb?v=dde77cd1ee",
      "sprite": "/assets/souls/v3/plate-dome.png?v=3e527d348a",
      "rect": [
        79.0,
        78.0,
        42.0,
        34.0
      ]
    },
    "skull": {
      "glb": "/assets/souls/v3/plate-skull.glb?v=27d8dda5ce",
      "sprite": "/assets/souls/v3/plate-skull.png?v=ed3a3f90c6",
      "rect": [
        79.0,
        76.75,
        42.0,
        40.0
      ]
    },
    "cracked-bow": {
      "glb": "/assets/souls/v3/plate-cracked-bow.glb?v=e5826811fa",
      "sprite": "/assets/souls/v3/plate-cracked-bow.png?v=69a6901ff2",
      "rect": [
        79.0,
        83.5,
        42.0,
        26.5
      ]
    }
  },
  "eyes": {
    "button": {
      "glb": "/assets/souls/v3/eyes-button.glb?v=f0895f84f9",
      "sprite": "/assets/souls/v3/eyes-button.png?v=7e02b4fe38",
      "rect": [
        82.25,
        89.5,
        35.5,
        13.5
      ]
    },
    "lashes": {
      "glb": "/assets/souls/v3/eyes-lashes.glb?v=0e8d3efbdd",
      "sprite": "/assets/souls/v3/eyes-lashes.png?v=bb70d857e1",
      "rect": [
        83.0,
        94.5,
        34.0,
        6.5
      ]
    },
    "hearts": {
      "glb": "/assets/souls/v3/eyes-hearts.glb?v=a620750b87",
      "sprite": "/assets/souls/v3/eyes-hearts.png?v=a03d065a8c",
      "rect": [
        82.25,
        89.5,
        35.5,
        13.5
      ]
    },
    "sleepy": {
      "glb": "/assets/souls/v3/eyes-sleepy.glb?v=c70f88fde4",
      "sprite": "/assets/souls/v3/eyes-sleepy.png?v=7f1127a0e8",
      "rect": [
        82.25,
        94.0,
        35.5,
        9.0
      ]
    },
    "wink": {
      "glb": "/assets/souls/v3/eyes-wink.glb?v=9682055cad",
      "sprite": "/assets/souls/v3/eyes-wink.png?v=71be621bc7",
      "rect": [
        82.25,
        89.5,
        35.25,
        13.5
      ]
    },
    "sparkle": {
      "glb": "/assets/souls/v3/eyes-sparkle.glb?v=a2bfc2a53b",
      "sprite": "/assets/souls/v3/eyes-sparkle.png?v=ae72b69a07",
      "rect": [
        82.25,
        89.5,
        35.5,
        13.5
      ]
    },
    "fierce": {
      "glb": "/assets/souls/v3/eyes-fierce.glb?v=d32b8031fb",
      "sprite": "/assets/souls/v3/eyes-fierce.png?v=e3640dca01",
      "rect": [
        81.5,
        93.25,
        37.0,
        9.75
      ]
    },
    "fierce-red": {
      "glb": "/assets/souls/v3/eyes-fierce-red.glb?v=d22478224c",
      "sprite": "/assets/souls/v3/eyes-fierce-red.png?v=ebeb571b79",
      "rect": [
        81.5,
        93.25,
        37.0,
        9.75
      ]
    },
    "bead": {
      "glb": "/assets/souls/v3/eyes-bead.glb?v=372a41ad9f",
      "sprite": "/assets/souls/v3/eyes-bead.png?v=4f451cc3e0",
      "rect": [
        82.25,
        89.5,
        35.5,
        13.5
      ]
    },
    "happy": {
      "glb": "/assets/souls/v3/eyes-happy.glb?v=7d16ecdcf9",
      "sprite": "/assets/souls/v3/eyes-happy.png?v=795a27ff9f",
      "rect": [
        82.25,
        89.5,
        35.5,
        11.75
      ]
    }
  },
  "faces": {
    "nerdy": {
      "glb": "/assets/souls/v3/face-nerdy.glb?v=b28918d774",
      "sprite": "/assets/souls/v3/face-nerdy.png?v=fb7cd851bb",
      "rect": [
        69.25,
        86.25,
        61.75,
        20.5
      ]
    },
    "pirate": {
      "glb": "/assets/souls/v3/face-pirate.glb?v=a5e63c6c59",
      "sprite": "/assets/souls/v3/face-pirate.png?v=a66b242a34",
      "rect": [
        66.25,
        67.25,
        65.0,
        38.25
      ]
    },
    "angel": {
      "glb": "/assets/souls/v3/face-angel.glb?v=717414e9dd",
      "sprite": "/assets/souls/v3/face-angel.png?v=45f2c4491e",
      "rect": [
        83.0,
        36.5,
        48.0,
        26.5
      ]
    }
  },
  "topper": {
    "centre": [
      0.1027,
      2.1,
      -0.07893
    ],
    "normal": [
      0.0,
      0.0,
      1.0
    ],
    "up": [
      0.0,
      1.0,
      0.0
    ],
    "size": 0.36,
    "sink": 0.0,
    "front2d": {
      "x": 107.19,
      "y": 31.6,
      "r": 12.6
    }
  },
  "shape": {
    "silhouette": "M92.2 180.1c-13.4 0-9.1-5.7-10.3-8.8c-1.7-4.2-3.4-3.2-4-9.5c-.2-2.1-.9-12.1-2.5-11.9c-.4 0-1.3 5.2-1.1 6.3c.2 1.1 1.2 2 1.5 3.1c1.8 7.3-2.3 7.9-2.8 9.5c-.3 1.2 .4 2.2-.6 3.4c-1.5 1.8-3.1 3.8-5.2 5.1c-6.8 4-15.6 .2-17.6-7.4c-1.4-5.2 1.7-9.8 3.8-14.3c4.5-9.3 9.2-18.5 13.4-28c7.5-17.2 .5-40.3 8.8-54c6.3-10.4 14.7-10.7 23.2-17.1c3-2.2 6.1-6.7 5.7-10.6c-.1-.9-.9-1.6-.9-2.5c0-.6 1.1-3.9 1.3-5.4c.2-1.2 .9-6.4 2.9-5.4c1.2 .6 1.7 6.5 1.8 7.7c.2 1.1 1.2 2 1.2 3.1c0 .9-.8 1.6-1 2.5c-.6 3.7 1.1 8.9 3.2 12c7.3 11.2 10 7.5 15 24.1c.7 2.2 1.4 27.6 2.2 34.2c1.2 9.5 6 17.8 10.1 26.3c2.7 5.7 9.7 17.5 10.4 23.2c.4 3.4-.8 6.9-3.1 9.4c-5.2 5.7-15.3 4.9-19-2.1c-2.1-3.8-2.2-9-2.5-13.2c-.2-2.9 0-6.7-1.2-9.5c-.1-.1-.1-.4-.3-.4c-1.2-.1-1.8 5.6-1.9 6.6c-.2 2.9-.4 6.1-1.2 8.9c-.3 1.3-1.4 2.6-1.5 4c-.2 2.8 1.7 5.3-.1 8.1c-1.3 2-3 .7-4.8 1.4c-5.6 2.3-16.6 1.2-22.9 1.2z"
  },
  "source": {
    "generator": "tools/ai/blender/soul_face.py",
    "sha256": {
      "tools/ai/blender/soul_face.py": "facb06ea8b58262fdea318951705b8da9e4cec73ddc4d460ff610f9f50fe9888",
      "tools/ai/blender/soul_decor.py": "fcad0afb23a81163bffe6371e814a1c0229effff936a7df8738e947d94c463c8",
      "tools/ai/blender/soul_baseline.py": "ccfa0907831bd15790ddc54d4d90d2a5414a0aff6537546d38b2d9b4c4be28ae",
      "tools/ai/blender/soul_baseline_splats.json": "ec4f5e6223fb9b987a0dd6df20c246a5d3e6afa869eeb285677a9c97482a1dff",
      "packages/game-rules/src/soul-catalog.js": "f0d8326dc8ec739a6c2e07dcb3ae92ccf4791ad2ca521d86ed918c588c27392f",
      "assets-src/soul-face/plates.json": "069f24b5d100fb95cfc73fea760d397e90bd17baa29c8f9631b7a906ea051455",
      "tools/assets/build-soul-shape.py": "ed1cdbd6cb32abaa905693b05a5a015d923a010a4f42f55140c019423959cc52"
    }
  }
});

export default SOUL_FACE;
