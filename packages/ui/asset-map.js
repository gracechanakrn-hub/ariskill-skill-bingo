// GENERATED FILE - do not hand-edit. Regenerate with: node tools/assets/build-asset-map.js
// Source of truth: assets/manifest/assets.yaml + assets/manifest/audio.json (+ scene-config.json for built-in defaults).
// Typed, frozen asset map for the four static clients. Importable in Node (no window/document access) and in browsers.
// Contract: every URL is absolute under the /assets static mount; sha256 values are hex without the "sha256:" prefix.

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}

/** @type {Readonly<typeof ASSETS_DATA>} */
const ASSETS_DATA = {
  "generator": "tools/assets/build-asset-map.js",
  "generatedAt": null,
  "manifestVersion": "1.0.0",
  "audioManifestVersion": "1.0.0",
  "audioManifestId": "ariskill-skill-bingo/assets/manifest/audio",
  "license": "internal-original",
  "sha256OfManifests": {
    "assets/manifest/assets.yaml": "bbe8761ddc06d17f0e30d3a23a36be6e1caa039e34ff2d6559d831b5b0e16046",
    "assets/manifest/audio.yaml": "029d35157a1aa2fe7f7fdf6ac4ce8f29825fd80d935786e7dcf961c98f7c1aa1",
    "assets/manifest/audio.json": "d5a0b96fe5b41e503d63dc00bbf0bdf977e0dbd950eaae430a4bce4f2e57b732",
    "combined": "a755ab451cba5bed1692b1d42a946b54325ac8962ee4db23fa8ee36b6e614a2d"
  },
  "baseUrl": "/assets",
  "manifests": {
    "assets": "/assets/manifest/assets.yaml",
    "audio": "/assets/manifest/audio.json"
  },
  "budgets": {
    "assetsBytes": 6291456,
    "audioBytes": 1638400,
    "singleFileBytes": 1258291,
    "soulSvgBytes": 6144,
    "sceneDataBytes": 122880,
    "appBundleBytes": 614400,
    "audioOneshotBytes": 122880,
    "maxConcurrentVoices": 4
  },
  "fallbackRules": {
    "soulSprite": "full -> simple -> dot (dot is a 24 px static disc that always renders); never omit a Soul",
    "audio": "silent + caption (every play() emits its caption; no error is shown to employees)",
    "sceneJson": "ASSETS.scene.defaults (embedded copy of scene-config.json); starfield/orbit files optional, nebula optional"
  },
  "scene": {
    "config": "/assets/scene/scene-config.json",
    "nebula": "/assets/scene/nebula.svg",
    "starfield": [
      "/assets/scene/starfield-layer-1.json",
      "/assets/scene/starfield-layer-2.json",
      "/assets/scene/starfield-layer-3.json"
    ],
    "orbitRings": "/assets/scene/orbit-rings.json",
    "sha256": {
      "config": "2190ca66c99b67b4f4451bfdbfb20af7c352c07e0156ef98fc97f13626c0cb0e",
      "nebula": "f61889d54fc0861619c9611d987ac7a540f0db6c5fb681d38e014330bba91e78",
      "orbitRings": "3432bf65e2760e464d25a064e98247db272a1ffdf36425487ded219628109bef",
      "starfield": [
        "e355485aa3a7f11694233f61efb48f8a8ca5a1383cbd13ec4d21eff8b06e5965",
        "4faaf256aa5b928212ffe6d60cb692cf1417c2a9363d9aa9ec1a5a05c41f3704",
        "de87cb8e9ab98b4a76efb40871d7b2f04575a0eec6f63b93ea2497f028b8edc1"
      ]
    },
    "defaults": {
      "version": "1.0.0",
      "generator": "tools/assets/build-scene.js",
      "background": "#0B0F1F",
      "canvas": {
        "width": 1920,
        "height": 1080,
        "note": "OD-14 assumption: 1920x1080 public display; renderers scale by viewport height"
      },
      "safeZone": {
        "galaxyFraction": 0.7,
        "panelFraction": 0.3,
        "innerMarginPx": 32,
        "note": "Right 30 % is the information panel (D-52; 35 % before); effects are clipped to the Galaxy viewport",
        "galaxyWidthPx": 1344,
        "panelX": 1344,
        "panelWidthPx": 576,
        "rule": "No glow, particle, Soul, nebula or ring pixel may be drawn at x >= panelX. Renderers clip the Galaxy viewport to [0, galaxyWidthPx)."
      },
      "camera": {
        "type": "fixed-orthographic",
        "driftRadiusFraction": 0.015,
        "driftPeriodSeconds": 40,
        "maxAngularSpeedDegPerSec": 0.5,
        "shake": "forbidden",
        "zoom": "fixed"
      },
      "entrance": {
        "defaultEdge": "bottom",
        "edges": [
          "left",
          "right",
          "top",
          "bottom"
        ],
        "arcDurationMs": 2200,
        "pulseDurationMs": 600,
        "settleDurationMs": 1200,
        "maxConcurrent": 6,
        "queueOverflow": "settle-instantly"
      },
      "lod": {
        "fullBelowCount": 120,
        "simpleBelowCount": 300,
        "dotAbove": 300,
        "fullMinPx": 56,
        "simpleMinPx": 24,
        "clusterAbove": 300,
        "clusterGridPx": 96
      },
      "performance": {
        "high": {
          "maxSouls": 600,
          "starLayers": 3,
          "nebula": true,
          "orbitRings": true,
          "glowFilters": true,
          "twinkle": true,
          "entranceTrail": true,
          "targetFps": 60
        },
        "medium": {
          "maxSouls": 450,
          "starLayers": 2,
          "nebula": true,
          "orbitRings": true,
          "glowFilters": false,
          "twinkle": true,
          "entranceTrail": false,
          "targetFps": 60
        },
        "low": {
          "maxSouls": 300,
          "starLayers": 1,
          "nebula": true,
          "orbitRings": false,
          "glowFilters": false,
          "twinkle": false,
          "entranceTrail": false,
          "targetFps": 30
        },
        "autoDowngrade": {
          "belowFps": 45,
          "sampleSeconds": 5,
          "cooldownSeconds": 30
        }
      },
      "reducedMotion": {
        "orbit": "static",
        "parallax": "off",
        "twinkle": "off",
        "entrance": "fade-in 400 ms at final slot",
        "glowPulse": "off",
        "camera": "static"
      },
      "fallback": {
        "order": [
          "webgl2",
          "canvas2d",
          "static"
        ],
        "static": "nebula.svg + starfield-layer-1 + Souls at simple detail, no animation"
      },
      "budgets": {
        "frameTimeMs": 16.7,
        "minFps": 30,
        "soakMinutes": 30,
        "soakSouls": 450,
        "textureMemoryMB": 64,
        "bundleKB": 350,
        "sceneDataKB": 120,
        "soulSvgBytes": 6144
      },
      "soulPalettes": [
        "aurora",
        "lagoon",
        "sunset",
        "orchid",
        "mint",
        "coral",
        "sky",
        "lilac"
      ],
      "orbit": {
        "file": "assets/scene/orbit-rings.json",
        "totalCapacity": 588,
        "clusterAbove": 300
      },
      "starfield": [
        {
          "file": "assets/scene/starfield-layer-1.json",
          "parallax": 0.15,
          "count": 420
        },
        {
          "file": "assets/scene/starfield-layer-2.json",
          "parallax": 0.35,
          "count": 220
        },
        {
          "file": "assets/scene/starfield-layer-3.json",
          "parallax": 0.6,
          "count": 90
        }
      ]
    }
  },
  "souls": {
    "cohort": "/assets/souls/cohort.json",
    "cohortSha256": "929afb3907cf17c3677c001595fff57337df684823d8b4ade3825bba650c891c",
    "cohortDir": "/assets/souls/cohort/",
    "thumbnailDir": "/assets/souls/thumbnails/",
    "fallbackDir": "/assets/souls/fallback/",
    "suffix": {
      "full": ".svg",
      "simple": "-simple.svg",
      "dot": "-dot.svg",
      "thumbnail": "-64.svg"
    },
    "count": 24,
    "seeds": [
      "140e6ebb0fff0f",
      "0e7c71a4f4779e",
      "185edf81266a86",
      "0c8fda8ffef1d5",
      "0e39e2f5047a44",
      "1a094e030d5e89",
      "045e48e3566287",
      "1ef9240343b1a0",
      "0f1be17ca9df8f",
      "0539dc0c10513f",
      "1d2e20987152b0",
      "064b5af3ba69c3",
      "1cdc2b005f78f8",
      "08ff91eabc6d43",
      "01a5bc0af65924",
      "1ec3a1b6539cad",
      "0cf1c4f541ecc5",
      "10e619a585d80a",
      "12ce33f272ee40",
      "0406b542e700a1",
      "19c576aacf1ebd",
      "06f6f233f18448",
      "15b36949ab1524",
      "0bc49cd4fd7217"
    ],
    "maxSpriteBytes": 5496,
    "baseline": {
      "format": "glb",
      "hero": "/assets/souls/baseline/soul-baseline-hero.glb",
      "lite": "/assets/souls/baseline/soul-baseline-lite.glb",
      "sha256": {
        "hero": "ef698a388bffb9c0b9a19f07c05655a8b6ead0b8cd479eaaad0423fe212df22a",
        "lite": "d2607c3a49f678ae873fc0d86782956eef5dc05610557ff9a4fec2dfea6e5161"
      },
      "bytes": {
        "hero": 338168,
        "lite": 86152
      },
      "triangles": {
        "hero": 24000,
        "lite": 6000
      }
    }
  },
  "audio": {
    "ambient_galaxy": {
      "url": "/assets/audio/ambient_galaxy.wav",
      "bytes": 308744,
      "durationS": 7,
      "kind": "audio-loop",
      "loop": {
        "startSample": 0,
        "endSample": 154350,
        "sampleRate": 22050
      },
      "priority": 0,
      "rateLimitMs": 0,
      "duck": null,
      "audiences": [
        "public",
        "stage"
      ],
      "preload": {
        "participant": false,
        "admin": false,
        "public": true,
        "stage": true
      },
      "caption": "Galaxy ambience playing",
      "copyKey": null,
      "sha256": "226b0964617be009a26aff3894bcc11783a29db75913b0fdd5912ca19746f4e1"
    },
    "registration_ready": {
      "url": "/assets/audio/registration_ready.wav",
      "bytes": 26504,
      "durationS": 0.6,
      "kind": "audio-oneshot",
      "loop": null,
      "priority": 2,
      "rateLimitMs": 1000,
      "duck": null,
      "audiences": [
        "participant"
      ],
      "preload": {
        "participant": false,
        "admin": false,
        "public": false,
        "stage": false
      },
      "caption": "Your Skill Bingo is ready!",
      "copyKey": "board.complete",
      "sha256": "1f0c7ecec61b82dd3496aaf52a79d1cf326078300dfdb524309175c8ed88cede"
    },
    "draw_leadin": {
      "url": "/assets/audio/draw_leadin.wav",
      "bytes": 17684,
      "durationS": 0.4,
      "kind": "audio-oneshot",
      "loop": null,
      "priority": 1,
      "rateLimitMs": 1000,
      "duck": null,
      "audiences": [
        "admin",
        "public"
      ],
      "preload": {
        "participant": false,
        "admin": false,
        "public": true,
        "stage": false
      },
      "caption": "Drawing the next skill",
      "copyKey": "admin.nextSkillPending",
      "sha256": "4878b72a84b98c77aab6368b98f7f12faa8663266b88475ee18824049d2c4478"
    },
    "draw_reveal": {
      "url": "/assets/audio/draw_reveal.wav",
      "bytes": 35324,
      "durationS": 0.8,
      "kind": "audio-oneshot",
      "loop": null,
      "priority": 2,
      "rateLimitMs": 800,
      "duck": null,
      "audiences": [
        "participant",
        "public",
        "stage",
        "admin"
      ],
      "preload": {
        "participant": true,
        "admin": true,
        "public": true,
        "stage": true
      },
      "caption": "Skill drawn",
      "copyKey": "play.draw",
      "sha256": "55d5c8685c8b329a9dee518e3b484b561a894ff4efd2edc4b32b0bd0916e0370"
    },
    "cell_match": {
      "url": "/assets/audio/cell_match.wav",
      "bytes": 5336,
      "durationS": 0.12,
      "kind": "audio-oneshot",
      "loop": null,
      "priority": 1,
      "rateLimitMs": 250,
      "duck": null,
      "audiences": [
        "participant"
      ],
      "preload": {
        "participant": true,
        "admin": false,
        "public": false,
        "stage": false
      },
      "caption": "Matched on your board",
      "copyKey": "play.matched",
      "sha256": "301b754687fc4d4d9ee2a00729a40cc4c058af638a337dba6ea7989416053684"
    },
    "draw5_unlock": {
      "url": "/assets/audio/draw5_unlock.wav",
      "bytes": 44144,
      "durationS": 1,
      "kind": "audio-oneshot",
      "loop": null,
      "priority": 2,
      "rateLimitMs": 5000,
      "duck": null,
      "audiences": [
        "participant",
        "public",
        "stage"
      ],
      "preload": {
        "participant": true,
        "admin": false,
        "public": true,
        "stage": false
      },
      "caption": "Bingo is live",
      "copyKey": "play.evaluationActive",
      "sha256": "79012030e4751c92cfa1511fc8f883bd70866c23f58c6ed219457a5b4d203a35"
    },
    "bingo": {
      "url": "/assets/audio/bingo.wav",
      "bytes": 66194,
      "durationS": 1.5,
      "kind": "audio-oneshot",
      "loop": null,
      "priority": 3,
      "rateLimitMs": 3000,
      "duck": {
        "db": 8,
        "ms": 2000
      },
      "audiences": [
        "participant",
        "public",
        "stage",
        "admin"
      ],
      "preload": {
        "participant": true,
        "admin": true,
        "public": true,
        "stage": true
      },
      "caption": "Bingo detected",
      "copyKey": "result.bingo",
      "sha256": "b8f46c5f3a55b37dd589c928af994ac565b708e3fec2b1755e3a1f88a29cb9e2"
    },
    "soul_reveal": {
      "url": "/assets/audio/soul_reveal.wav",
      "bytes": 83834,
      "durationS": 1.9,
      "kind": "audio-oneshot",
      "loop": null,
      "priority": 2,
      "rateLimitMs": 5000,
      "duck": null,
      "audiences": [
        "participant"
      ],
      "preload": {
        "participant": false,
        "admin": false,
        "public": false,
        "stage": false
      },
      "caption": "Your Soul is ready to join Arise.",
      "copyKey": "soul.ready",
      "sha256": "72fe93be2fc465ad66448d0076605b407e429d5049faaf29ec353fbc5e14b9d0"
    },
    "float_countdown": {
      "url": "/assets/audio/float_countdown.wav",
      "bytes": 7982,
      "durationS": 0.18,
      "kind": "audio-oneshot",
      "loop": null,
      "priority": 1,
      "rateLimitMs": 300,
      "duck": null,
      "audiences": [
        "participant"
      ],
      "preload": {
        "participant": true,
        "admin": false,
        "public": false,
        "stage": false
      },
      "caption": "3 -> 2 -> 1 -> FLOAT",
      "copyKey": "soul.countdown",
      "sha256": "d10fa331caf69836b7d503f3d450d5102c20f419165a80349b8abae776d33860"
    },
    "float_launch": {
      "url": "/assets/audio/float_launch.wav",
      "bytes": 52964,
      "durationS": 1.2,
      "kind": "audio-oneshot",
      "loop": null,
      "priority": 3,
      "rateLimitMs": 600,
      "duck": {
        "db": 4,
        "ms": 1200
      },
      "audiences": [
        "participant",
        "public",
        "stage"
      ],
      "preload": {
        "participant": true,
        "admin": false,
        "public": true,
        "stage": true
      },
      "caption": "Your Soul is in the Galaxy",
      "copyKey": "soul.floated",
      "sha256": "dbde8084c24f6e0ad783b7918eff7ec85d0dc64bf249237799f190a5ce6cb667"
    },
    "error_soft": {
      "url": "/assets/audio/error_soft.wav",
      "bytes": 17684,
      "durationS": 0.4,
      "kind": "audio-oneshot",
      "loop": null,
      "priority": 0,
      "rateLimitMs": 1500,
      "duck": null,
      "audiences": [
        "participant",
        "admin",
        "public",
        "stage"
      ],
      "preload": {
        "participant": false,
        "admin": false,
        "public": false,
        "stage": false
      },
      "caption": "Notice: see message",
      "copyKey": null,
      "sha256": "b14e073cd7bd3263526734e7df80fd41fa5bf89a458e1a7f426515fb7ea0730a"
    },
    "reconnect": {
      "url": "/assets/audio/reconnect.wav",
      "bytes": 22094,
      "durationS": 0.5,
      "kind": "audio-oneshot",
      "loop": null,
      "priority": 0,
      "rateLimitMs": 10000,
      "duck": null,
      "audiences": [
        "public",
        "stage",
        "admin"
      ],
      "preload": {
        "participant": false,
        "admin": false,
        "public": false,
        "stage": false
      },
      "caption": "Reconnecting to the Skill Galaxy...",
      "copyKey": "reconnect",
      "sha256": "74d8dec03b5c371da77f64145598fadfd25c7a1ec8c980b38396118746d32f80"
    }
  },
  "entries": {
    "scene_config": {
      "kind": "data",
      "url": "/assets/scene/scene-config.json",
      "format": "json",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "2190ca66c99b67b4f4451bfdbfb20af7c352c07e0156ef98fc97f13626c0cb0e",
      "bytes": 3290,
      "lods": []
    },
    "scene_doodads": {
      "kind": "sprite",
      "url": "/assets/scene/doodads.svg",
      "format": "svg",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "b5dada56e1458a53629f2f3bd106955ddf2a16b575799b3d84c2f7b20eb076c8",
      "bytes": 4800,
      "lods": []
    },
    "scene_nebula": {
      "kind": "sprite",
      "url": "/assets/scene/nebula.svg",
      "format": "svg",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "f61889d54fc0861619c9611d987ac7a540f0db6c5fb681d38e014330bba91e78",
      "bytes": 2947,
      "lods": []
    },
    "scene_orbit_rings": {
      "kind": "data",
      "url": "/assets/scene/orbit-rings.json",
      "format": "json",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "3432bf65e2760e464d25a064e98247db272a1ffdf36425487ded219628109bef",
      "bytes": 1424,
      "lods": []
    },
    "scene_starfield_layer_1": {
      "kind": "data",
      "url": "/assets/scene/starfield-layer-1.json",
      "format": "json",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "e355485aa3a7f11694233f61efb48f8a8ca5a1383cbd13ec4d21eff8b06e5965",
      "bytes": 21866,
      "lods": []
    },
    "scene_starfield_layer_2": {
      "kind": "data",
      "url": "/assets/scene/starfield-layer-2.json",
      "format": "json",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "4faaf256aa5b928212ffe6d60cb692cf1417c2a9363d9aa9ec1a5a05c41f3704",
      "bytes": 11580,
      "lods": []
    },
    "scene_starfield_layer_3": {
      "kind": "data",
      "url": "/assets/scene/starfield-layer-3.json",
      "format": "json",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "de87cb8e9ab98b4a76efb40871d7b2f04575a0eec6f63b93ea2497f028b8edc1",
      "bytes": 4873,
      "lods": []
    },
    "soul_baseline_hero": {
      "kind": "model",
      "url": "/assets/souls/baseline/soul-baseline-hero.glb",
      "format": "glb",
      "fallbackUrl": "/assets/souls/baseline/soul-baseline-lite.glb",
      "fallbackFormat": "glb",
      "sha256": "ef698a388bffb9c0b9a19f07c05655a8b6ead0b8cd479eaaad0423fe212df22a",
      "bytes": 338168,
      "lods": [
        "/assets/souls/baseline/soul-baseline-hero.glb",
        "/assets/souls/baseline/soul-baseline-lite.glb"
      ]
    },
    "soul_baseline_lite": {
      "kind": "model",
      "url": "/assets/souls/baseline/soul-baseline-lite.glb",
      "format": "glb",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "d2607c3a49f678ae873fc0d86782956eef5dc05610557ff9a4fec2dfea6e5161",
      "bytes": 86152,
      "lods": [
        "/assets/souls/baseline/soul-baseline-lite.glb"
      ]
    },
    "soul_cohort_01_140e6ebb0fff0f": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/140e6ebb0fff0f.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/140e6ebb0fff0f-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "36559eb5f1ef8590c432a29d5be0027ca7efeb6c068beba342d4c4330ef9ce4a",
      "bytes": 4994,
      "lods": [
        "/assets/souls/cohort/140e6ebb0fff0f.svg",
        "/assets/souls/fallback/140e6ebb0fff0f-simple.svg",
        "/assets/souls/fallback/140e6ebb0fff0f-dot.svg",
        "/assets/souls/thumbnails/140e6ebb0fff0f-64.svg"
      ]
    },
    "soul_cohort_02_0e7c71a4f4779e": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/0e7c71a4f4779e.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/0e7c71a4f4779e-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "6271fd53b5d22dca8701da9c8a7e929a340c4c8009df040ee9e54aaa3591878b",
      "bytes": 4875,
      "lods": [
        "/assets/souls/cohort/0e7c71a4f4779e.svg",
        "/assets/souls/fallback/0e7c71a4f4779e-simple.svg",
        "/assets/souls/fallback/0e7c71a4f4779e-dot.svg",
        "/assets/souls/thumbnails/0e7c71a4f4779e-64.svg"
      ]
    },
    "soul_cohort_03_185edf81266a86": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/185edf81266a86.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/185edf81266a86-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "82c80f62bad8b1a0b641b87ea7f886dabb958bedd55017aa97153123eec0c35d",
      "bytes": 5390,
      "lods": [
        "/assets/souls/cohort/185edf81266a86.svg",
        "/assets/souls/fallback/185edf81266a86-simple.svg",
        "/assets/souls/fallback/185edf81266a86-dot.svg",
        "/assets/souls/thumbnails/185edf81266a86-64.svg"
      ]
    },
    "soul_cohort_04_0c8fda8ffef1d5": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/0c8fda8ffef1d5.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/0c8fda8ffef1d5-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "b3c85355ec3d17b66f435b5f8e4d0d0a5514b7adcdf64d1bef68dc2e41a84b86",
      "bytes": 4993,
      "lods": [
        "/assets/souls/cohort/0c8fda8ffef1d5.svg",
        "/assets/souls/fallback/0c8fda8ffef1d5-simple.svg",
        "/assets/souls/fallback/0c8fda8ffef1d5-dot.svg",
        "/assets/souls/thumbnails/0c8fda8ffef1d5-64.svg"
      ]
    },
    "soul_cohort_05_0e39e2f5047a44": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/0e39e2f5047a44.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/0e39e2f5047a44-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "9074d5d6353c534180136cdf731e2c6f6401dfb7e7a3e01ae281ed7d23662594",
      "bytes": 4980,
      "lods": [
        "/assets/souls/cohort/0e39e2f5047a44.svg",
        "/assets/souls/fallback/0e39e2f5047a44-simple.svg",
        "/assets/souls/fallback/0e39e2f5047a44-dot.svg",
        "/assets/souls/thumbnails/0e39e2f5047a44-64.svg"
      ]
    },
    "soul_cohort_06_1a094e030d5e89": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/1a094e030d5e89.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/1a094e030d5e89-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "a92c1a4d44a5f908dec6f1694ac91c075207f9defdc2c41770d944fbe04fa5aa",
      "bytes": 4977,
      "lods": [
        "/assets/souls/cohort/1a094e030d5e89.svg",
        "/assets/souls/fallback/1a094e030d5e89-simple.svg",
        "/assets/souls/fallback/1a094e030d5e89-dot.svg",
        "/assets/souls/thumbnails/1a094e030d5e89-64.svg"
      ]
    },
    "soul_cohort_07_045e48e3566287": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/045e48e3566287.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/045e48e3566287-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "6315477100d2a9e42b78d5c6b1a46a37f5a41fd591ad1a167e9500962b3c6cc0",
      "bytes": 4979,
      "lods": [
        "/assets/souls/cohort/045e48e3566287.svg",
        "/assets/souls/fallback/045e48e3566287-simple.svg",
        "/assets/souls/fallback/045e48e3566287-dot.svg",
        "/assets/souls/thumbnails/045e48e3566287-64.svg"
      ]
    },
    "soul_cohort_08_1ef9240343b1a0": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/1ef9240343b1a0.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/1ef9240343b1a0-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "1ec7e8995752e9300e7b768cd297670f79809e65dbfa5619bcbb4e20b46c9d8f",
      "bytes": 4875,
      "lods": [
        "/assets/souls/cohort/1ef9240343b1a0.svg",
        "/assets/souls/fallback/1ef9240343b1a0-simple.svg",
        "/assets/souls/fallback/1ef9240343b1a0-dot.svg",
        "/assets/souls/thumbnails/1ef9240343b1a0-64.svg"
      ]
    },
    "soul_cohort_09_0f1be17ca9df8f": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/0f1be17ca9df8f.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/0f1be17ca9df8f-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "de863e5ec0b34169385d7411207c9ed4e33f9a64fb380171a4b60b7b1bed27f6",
      "bytes": 4979,
      "lods": [
        "/assets/souls/cohort/0f1be17ca9df8f.svg",
        "/assets/souls/fallback/0f1be17ca9df8f-simple.svg",
        "/assets/souls/fallback/0f1be17ca9df8f-dot.svg",
        "/assets/souls/thumbnails/0f1be17ca9df8f-64.svg"
      ]
    },
    "soul_cohort_10_0539dc0c10513f": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/0539dc0c10513f.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/0539dc0c10513f-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "e9d1b0d1a18867e50ff338911d250ed6d686abc81f3085148bc0fd756539b0d3",
      "bytes": 4978,
      "lods": [
        "/assets/souls/cohort/0539dc0c10513f.svg",
        "/assets/souls/fallback/0539dc0c10513f-simple.svg",
        "/assets/souls/fallback/0539dc0c10513f-dot.svg",
        "/assets/souls/thumbnails/0539dc0c10513f-64.svg"
      ]
    },
    "soul_cohort_11_1d2e20987152b0": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/1d2e20987152b0.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/1d2e20987152b0-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "4812ea2cadafb535e415de3ce1f3b60022f9c7aef8170cb5654b0b3d568fcde4",
      "bytes": 5496,
      "lods": [
        "/assets/souls/cohort/1d2e20987152b0.svg",
        "/assets/souls/fallback/1d2e20987152b0-simple.svg",
        "/assets/souls/fallback/1d2e20987152b0-dot.svg",
        "/assets/souls/thumbnails/1d2e20987152b0-64.svg"
      ]
    },
    "soul_cohort_12_064b5af3ba69c3": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/064b5af3ba69c3.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/064b5af3ba69c3-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "965b290af1d99626b3766c6520e0dff26c6daa3eacea36cdf7cb4896cf0dbf24",
      "bytes": 4875,
      "lods": [
        "/assets/souls/cohort/064b5af3ba69c3.svg",
        "/assets/souls/fallback/064b5af3ba69c3-simple.svg",
        "/assets/souls/fallback/064b5af3ba69c3-dot.svg",
        "/assets/souls/thumbnails/064b5af3ba69c3-64.svg"
      ]
    },
    "soul_cohort_13_1cdc2b005f78f8": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/1cdc2b005f78f8.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/1cdc2b005f78f8-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "0a8d4ff8cdab83807bc3202f9cf2410c4ec5daa63c054b6c568f58d3e7529927",
      "bytes": 4978,
      "lods": [
        "/assets/souls/cohort/1cdc2b005f78f8.svg",
        "/assets/souls/fallback/1cdc2b005f78f8-simple.svg",
        "/assets/souls/fallback/1cdc2b005f78f8-dot.svg",
        "/assets/souls/thumbnails/1cdc2b005f78f8-64.svg"
      ]
    },
    "soul_cohort_14_08ff91eabc6d43": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/08ff91eabc6d43.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/08ff91eabc6d43-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "59337f207c811c4ccececc34989a72f55d53b08b5d8fd8ca6b1f1cc7ef848acd",
      "bytes": 4874,
      "lods": [
        "/assets/souls/cohort/08ff91eabc6d43.svg",
        "/assets/souls/fallback/08ff91eabc6d43-simple.svg",
        "/assets/souls/fallback/08ff91eabc6d43-dot.svg",
        "/assets/souls/thumbnails/08ff91eabc6d43-64.svg"
      ]
    },
    "soul_cohort_15_01a5bc0af65924": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/01a5bc0af65924.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/01a5bc0af65924-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "cc0a3e9ec7d784b9a79f2e12b2da1cf2bda2db37cb7a2a47d92c09de57f95198",
      "bytes": 4995,
      "lods": [
        "/assets/souls/cohort/01a5bc0af65924.svg",
        "/assets/souls/fallback/01a5bc0af65924-simple.svg",
        "/assets/souls/fallback/01a5bc0af65924-dot.svg",
        "/assets/souls/thumbnails/01a5bc0af65924-64.svg"
      ]
    },
    "soul_cohort_16_1ec3a1b6539cad": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/1ec3a1b6539cad.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/1ec3a1b6539cad-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "f73227821ac9bee731cff6692f3b7c99a3e667d73738478c4afb7594da6194e9",
      "bytes": 4977,
      "lods": [
        "/assets/souls/cohort/1ec3a1b6539cad.svg",
        "/assets/souls/fallback/1ec3a1b6539cad-simple.svg",
        "/assets/souls/fallback/1ec3a1b6539cad-dot.svg",
        "/assets/souls/thumbnails/1ec3a1b6539cad-64.svg"
      ]
    },
    "soul_cohort_17_0cf1c4f541ecc5": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/0cf1c4f541ecc5.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/0cf1c4f541ecc5-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "882f7cd20b941f870c8d0bac6b957017799d25dff975649accbcf29a85d660a8",
      "bytes": 4993,
      "lods": [
        "/assets/souls/cohort/0cf1c4f541ecc5.svg",
        "/assets/souls/fallback/0cf1c4f541ecc5-simple.svg",
        "/assets/souls/fallback/0cf1c4f541ecc5-dot.svg",
        "/assets/souls/thumbnails/0cf1c4f541ecc5-64.svg"
      ]
    },
    "soul_cohort_18_10e619a585d80a": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/10e619a585d80a.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/10e619a585d80a-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "9db5f12d9219c5d4ad4adb4fc64b90408757e2532fa8c7fdf67736b081e08e86",
      "bytes": 4992,
      "lods": [
        "/assets/souls/cohort/10e619a585d80a.svg",
        "/assets/souls/fallback/10e619a585d80a-simple.svg",
        "/assets/souls/fallback/10e619a585d80a-dot.svg",
        "/assets/souls/thumbnails/10e619a585d80a-64.svg"
      ]
    },
    "soul_cohort_19_12ce33f272ee40": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/12ce33f272ee40.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/12ce33f272ee40-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "86a9d2ebb27dd6493ae51f09926e322d0e6edb508b98d347aea07d52681b2493",
      "bytes": 5388,
      "lods": [
        "/assets/souls/cohort/12ce33f272ee40.svg",
        "/assets/souls/fallback/12ce33f272ee40-simple.svg",
        "/assets/souls/fallback/12ce33f272ee40-dot.svg",
        "/assets/souls/thumbnails/12ce33f272ee40-64.svg"
      ]
    },
    "soul_cohort_20_0406b542e700a1": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/0406b542e700a1.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/0406b542e700a1-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "98a602abcd557cc55ebdc913d0a0da167d9cd6c4b89d62e7970735f7075e0700",
      "bytes": 4978,
      "lods": [
        "/assets/souls/cohort/0406b542e700a1.svg",
        "/assets/souls/fallback/0406b542e700a1-simple.svg",
        "/assets/souls/fallback/0406b542e700a1-dot.svg",
        "/assets/souls/thumbnails/0406b542e700a1-64.svg"
      ]
    },
    "soul_cohort_21_19c576aacf1ebd": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/19c576aacf1ebd.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/19c576aacf1ebd-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "19247667bc384ce4ba60391cf956285d3102ee719e1a2d35fd45a05255baf127",
      "bytes": 4873,
      "lods": [
        "/assets/souls/cohort/19c576aacf1ebd.svg",
        "/assets/souls/fallback/19c576aacf1ebd-simple.svg",
        "/assets/souls/fallback/19c576aacf1ebd-dot.svg",
        "/assets/souls/thumbnails/19c576aacf1ebd-64.svg"
      ]
    },
    "soul_cohort_22_06f6f233f18448": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/06f6f233f18448.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/06f6f233f18448-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "e640405d0ae40ea6df0e031e6881e4cfe9d19e2c53ef9d386f67a0ba4e0bb5d0",
      "bytes": 4979,
      "lods": [
        "/assets/souls/cohort/06f6f233f18448.svg",
        "/assets/souls/fallback/06f6f233f18448-simple.svg",
        "/assets/souls/fallback/06f6f233f18448-dot.svg",
        "/assets/souls/thumbnails/06f6f233f18448-64.svg"
      ]
    },
    "soul_cohort_23_15b36949ab1524": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/15b36949ab1524.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/15b36949ab1524-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "5c2d647b9f89f6545cb9e3c8117621a2a710e9ed10509dcc114736c76037416f",
      "bytes": 4995,
      "lods": [
        "/assets/souls/cohort/15b36949ab1524.svg",
        "/assets/souls/fallback/15b36949ab1524-simple.svg",
        "/assets/souls/fallback/15b36949ab1524-dot.svg",
        "/assets/souls/thumbnails/15b36949ab1524-64.svg"
      ]
    },
    "soul_cohort_24_0bc49cd4fd7217": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/0bc49cd4fd7217.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/0bc49cd4fd7217-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "9959237297210574d4609d44e43e2a78db524c2ed7221491c6b398ca58d0cc98",
      "bytes": 4875,
      "lods": [
        "/assets/souls/cohort/0bc49cd4fd7217.svg",
        "/assets/souls/fallback/0bc49cd4fd7217-simple.svg",
        "/assets/souls/fallback/0bc49cd4fd7217-dot.svg",
        "/assets/souls/thumbnails/0bc49cd4fd7217-64.svg"
      ]
    },
    "soul_cohort_index": {
      "kind": "data",
      "url": "/assets/souls/cohort.json",
      "format": "json",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "929afb3907cf17c3677c001595fff57337df684823d8b4ade3825bba650c891c",
      "bytes": 18842,
      "lods": []
    },
    "soul_cohort_sheet": {
      "kind": "review-page",
      "url": "/assets/souls/sheet.html",
      "format": "html",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "242e3927ae65c830d80b156b90a7a1ed5b12cee8b880852cb57a76b9f6aa57ce",
      "bytes": 324005,
      "lods": []
    },
    "soul_winner_crown": {
      "kind": "model",
      "url": "/assets/souls/winner/crown.glb",
      "format": "glb",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "e615e37b5c97dd4b375f31bfc4e657736acb201c3df69db942c3c82b29ecb59b",
      "bytes": 33620,
      "lods": [
        "/assets/souls/winner/crown.glb"
      ]
    },
    "space_backdrop": {
      "kind": "texture",
      "url": "/assets/space/backdrop.jpg",
      "format": "jpeg",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "fcb866a7ac3c3bbeacfc40f94ac2486b64ebdd6969bdb7a39a6007d068679fd6",
      "bytes": 239939,
      "lods": []
    },
    "space_config": {
      "kind": "data",
      "url": "/assets/space/space.json",
      "format": "json",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "8e065227565f2e9e3ce86a5ce4a8e85725a35f8e80f519547c0088a7877bedd6",
      "bytes": 5166,
      "lods": []
    },
    "space_constellations": {
      "kind": "texture",
      "url": "/assets/space/constellations.webp",
      "format": "webp",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "4f95a4aa99dc80abf675de4f3b6debcfeecdd1cbc612aa2b01070e2d0d5f1a0a",
      "bytes": 54544,
      "lods": []
    },
    "space_falling_star": {
      "kind": "texture",
      "url": "/assets/space/falling-star.webp",
      "format": "webp",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "eb1e3c7d23d0c22e657c7fb600d041f3719f3c76b83ff0515cf24aec82a6df21",
      "bytes": 2528,
      "lods": []
    },
    "space_meteor_1": {
      "kind": "texture",
      "url": "/assets/space/meteor-1.webp",
      "format": "webp",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "9fd088ccf3847b63af9fcb6edf0e300cdf9ee989b29b3f453cb781445174aa4f",
      "bytes": 18262,
      "lods": []
    },
    "space_meteor_2": {
      "kind": "texture",
      "url": "/assets/space/meteor-2.webp",
      "format": "webp",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "0821044d75bb18d3c2ae437ce6ab74220a695c98b374ba113ce554b566ba4e85",
      "bytes": 14906,
      "lods": []
    },
    "space_meteor_3": {
      "kind": "texture",
      "url": "/assets/space/meteor-3.webp",
      "format": "webp",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "66c705fb34fbc95dafe3dcfe1cc07b7418637ebdd348d28ae44c4c124f248e94",
      "bytes": 19576,
      "lods": []
    },
    "space_meteor_4": {
      "kind": "texture",
      "url": "/assets/space/meteor-4.webp",
      "format": "webp",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "e8a75fb2ebb12b95735af4c7455d231cc4f397740b9d6be491a19d8ccab42efb",
      "bytes": 17630,
      "lods": []
    },
    "space_meteor_5": {
      "kind": "texture",
      "url": "/assets/space/meteor-5.webp",
      "format": "webp",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "ba3ee02c50d16ad5d301fe3abce90df04b1fa50ac300303462e038c26b281b14",
      "bytes": 16320,
      "lods": []
    }
  }
};

export const ASSETS = deepFreeze(ASSETS_DATA);
export const APPS = Object.freeze(['participant', 'admin', 'public', 'stage']);
export const ASSET_MAP_VERSION = ASSETS.manifestVersion;

/** URL for a manifest id (assets.yaml entry id or audio cue id); null when unknown. */
export function assetUrl(id) {
  const e = ASSETS.entries[id]; if (e) return e.url;
  const a = ASSETS.audio[id]; if (a) return a.url;
  return null;
}

/** Fallback URL for a manifest id (assets.yaml fallback_file); null when none is declared. */
export function fallbackUrl(id) {
  const e = ASSETS.entries[id]; return e ? e.fallbackUrl : null;
}

/** Sprite URLs for a Soul seed (14-hex id): { full, simple, dot, thumbnail }. Works for any seed, not only the cohort. */
export function soulSpriteUrls(seed) {
  const s = String(seed || '').replace(/[^0-9a-z]/gi, '');
  const { cohortDir, fallbackDir, thumbnailDir, suffix } = ASSETS.souls;
  return { full: cohortDir + s + suffix.full, simple: fallbackDir + s + suffix.simple, dot: fallbackDir + s + suffix.dot, thumbnail: thumbnailDir + s + suffix.thumbnail };
}

/** URL of the baseline Soul model (D-27) for a level of detail ('hero' | 'lite'); null when the tree has none. */
export function soulModelUrl(lod = 'hero') {
  const b = ASSETS.souls.baseline; if (!b) return null;
  return (lod === 'lite' ? b.lite : b.hero) || null;
}

/** Cue ids an app should preload right after createAudioManager(): priority descending, then manifest order. */
export function preloadListFor(app) {
  const ids = Object.keys(ASSETS.audio).filter((id) => ASSETS.audio[id].preload && ASSETS.audio[id].preload[app] === true);
  return ids.map((id, i) => ({ id, i, p: ASSETS.audio[id].priority || 0 })).sort((a, b) => (b.p - a.p) || (a.i - b.i)).map((x) => x.id);
}

/**
 * Describe a primary/fallback pair. 'candidates' is the ordered list to try; 'onError(event)' swaps an <img>/<source>
 * (or any element with a 'src') to the fallback exactly once, so it can be attached directly as an error listener.
 */
export function withFallback(url, fallbackUrl) {
  const candidates = [url, fallbackUrl].filter((u) => typeof u === 'string' && u.length > 0);
  let swapped = false;
  return Object.freeze({
    url: candidates[0] || null, fallback: candidates[1] || null, candidates: Object.freeze(candidates),
    next(current) { const i = candidates.indexOf(current); return i >= 0 && i + 1 < candidates.length ? candidates[i + 1] : null; },
    onError(event) {
      try {
        if (swapped || candidates.length < 2) return false;
        const el = event && event.target; if (!el || typeof el !== 'object') return false;
        swapped = true; el.src = candidates[1]; return true;
      } catch (_) { return false; }
    },
  });
}

/** Small sample of assets whose bytes are re-hashed by checkIntegrity(): always tiny files. */
export function integritySample() {
  const audioIds = Object.keys(ASSETS.audio).sort((a, b) => ASSETS.audio[a].bytes - ASSETS.audio[b].bytes);
  const sample = [
    { id: 'scene_config', url: ASSETS.scene.config, sha256: ASSETS.scene.sha256.config },
    { id: 'scene_orbit_rings', url: ASSETS.scene.orbitRings, sha256: ASSETS.scene.sha256.orbitRings },
    { id: 'soul_cohort_index', url: ASSETS.souls.cohort, sha256: ASSETS.souls.cohortSha256 },
  ];
  if (audioIds.length) sample.push({ id: audioIds[0], url: ASSETS.audio[audioIds[0]].url, sha256: ASSETS.audio[audioIds[0]].sha256 });
  const soul = Object.keys(ASSETS.entries).find((id) => /^soul_cohort_\d+_/.test(id));
  if (soul) sample.push({ id: soul, url: ASSETS.entries[soul].url, sha256: ASSETS.entries[soul].sha256 });
  return sample;
}

/**
 * Fetch a few small assets and compare their sha256 with the manifest (crypto.subtle when available).
 * Never throws. Returns { ok, checked, mismatches: [{ id, url, expected, actual }], errors: [{ id, url, error }], skipped }.
 */
export async function checkIntegrity(fetchFn) {
  const report = { ok: true, checked: 0, mismatches: [], errors: [], skipped: null };
  try {
    const f = fetchFn || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!f) { report.skipped = 'no fetch available'; return report; }
    if (!subtle || typeof subtle.digest !== 'function') { report.skipped = 'crypto.subtle unavailable'; return report; }
    for (const item of integritySample()) {
      try {
        const res = await f(item.url);
        if (!res || !res.ok) { report.errors.push({ id: item.id, url: item.url, error: 'HTTP ' + (res && res.status) }); continue; }
        const buf = await res.arrayBuffer();
        const digest = await subtle.digest('SHA-256', buf);
        const actual = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
        report.checked += 1;
        if (actual !== item.sha256) report.mismatches.push({ id: item.id, url: item.url, expected: item.sha256, actual });
      } catch (err) { report.errors.push({ id: item.id, url: item.url, error: String(err && err.message || err) }); }
    }
  } catch (err) { report.errors.push({ id: null, url: null, error: String(err && err.message || err) }); }
  report.ok = report.mismatches.length === 0 && report.errors.length === 0;
  return report;
}

export default ASSETS;
