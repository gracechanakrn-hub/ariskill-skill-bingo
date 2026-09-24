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
    "assets/manifest/assets.yaml": "48a75816777c85b27f1e793667efec597b2207b4cd42385a61378fec0b500c43",
    "assets/manifest/audio.yaml": "029d35157a1aa2fe7f7fdf6ac4ce8f29825fd80d935786e7dcf961c98f7c1aa1",
    "assets/manifest/audio.json": "d5a0b96fe5b41e503d63dc00bbf0bdf977e0dbd950eaae430a4bce4f2e57b732",
    "combined": "19f16976aa7a788cafe894179458583e7b5e0db245eed271eb5ee47e5484705d"
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
      "config": "47797eada0e6b79d207aa2e5128bd619e330504707ac7166172e0a013a248f53",
      "nebula": "60e5ccb51f907f75c2d721e0c451c4db7b28ad85623f8c8149636ece0f3c8abf",
      "orbitRings": "3e1511cf66d275a8dd0932f65350f3c30693808d6fa725739442cd83298b5489",
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
        "galaxyFraction": 0.65,
        "panelFraction": 0.35,
        "innerMarginPx": 32,
        "note": "Right 35 % is the information panel; effects are clipped to the Galaxy viewport",
        "galaxyWidthPx": 1248,
        "panelX": 1248,
        "panelWidthPx": 672,
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
    "cohortSha256": "c512939c7b76e0decba26e63447df17c57c9fbd43b560060029c23215c675df5",
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
    "maxSpriteBytes": 5577
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
      "sha256": "47797eada0e6b79d207aa2e5128bd619e330504707ac7166172e0a013a248f53",
      "bytes": 3272,
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
      "sha256": "60e5ccb51f907f75c2d721e0c451c4db7b28ad85623f8c8149636ece0f3c8abf",
      "bytes": 2947,
      "lods": []
    },
    "scene_orbit_rings": {
      "kind": "data",
      "url": "/assets/scene/orbit-rings.json",
      "format": "json",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "3e1511cf66d275a8dd0932f65350f3c30693808d6fa725739442cd83298b5489",
      "bytes": 1249,
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
    "soul_cohort_01_140e6ebb0fff0f": {
      "kind": "sprite",
      "url": "/assets/souls/cohort/140e6ebb0fff0f.svg",
      "format": "svg",
      "fallbackUrl": "/assets/souls/fallback/140e6ebb0fff0f-simple.svg",
      "fallbackFormat": "svg",
      "sha256": "724b1fe46b0ac50397b4e9f80018820a14c4754862189f57a0c27ead8c88e6d4",
      "bytes": 5014,
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
      "sha256": "16ff65528a5d45f4f102a0e3d9d443d2b233444446e65bd541f28f6e2f5d6adc",
      "bytes": 4886,
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
      "sha256": "bad92ea203ff29011965ab9fcfcb32c3c75f4a93a01b582f54f4f119f9775122",
      "bytes": 5577,
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
      "sha256": "bd5f94209888e7b1a2e93c3c427f66acad17bcbb7123924be2e8da41fde39932",
      "bytes": 4564,
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
      "sha256": "ea3c3c31d77634077a8ae9666ff3f84bd049f59449382b45543a6641124f7b70",
      "bytes": 4597,
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
      "sha256": "56f787d3b55cd83b0ff90013ae96852de291f29ea868737978de89f04c51631a",
      "bytes": 4404,
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
      "sha256": "aa3ac117fc87ec4b6abeef9d04a30bb03abc84c3a7300073bf62a8fd7e609f85",
      "bytes": 5096,
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
      "sha256": "c23cca4ee4f990702a03f12678ac51361d74cd59d8d95697d6097168dfa7a103",
      "bytes": 5081,
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
      "sha256": "0d2e1d51566fab983a3785c42716fb99bb0b6a1ddd8a4f426ec4ccc6c2268ac8",
      "bytes": 4838,
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
      "sha256": "7decaceee6f7a3984759870a4b9871f3c40dd1664bbe9e1ed79c5bce0ac22a95",
      "bytes": 5362,
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
      "sha256": "d3a4070e353cefd1bff3a7b09849f946f4f0d2574838b451317130ebfe0942a9",
      "bytes": 5168,
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
      "sha256": "123fe6aed207840fc848affd2215a045c36831260de81e540374e2f00f7dd421",
      "bytes": 5103,
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
      "sha256": "c82806f2d85255c38fb4ee45374d348dda6636c3e06c574f7aa527509db208e8",
      "bytes": 4878,
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
      "sha256": "97055862342e670831702554cf588282c4a09d6e87d3b69e3d95f083ec9a844c",
      "bytes": 4770,
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
      "sha256": "fd2fbbe3ca4c185f6d49117f416d2da4f1f211e837eb4e231e15aa35080d8303",
      "bytes": 4294,
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
      "sha256": "2dd1e2e70286d457df7c0e615690e81f90dffbc2358a33881c0d793950afffa7",
      "bytes": 5029,
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
      "sha256": "264b8e91d8e707f2bee2ed4b2eb6d26e877586d8633f83e102e8272593192b3c",
      "bytes": 4533,
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
      "sha256": "a3480b3d66a041eca4546b4370f83d8a694582a12c104fdd8f0d063a4633bfee",
      "bytes": 5387,
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
      "sha256": "6c6f770e8b913940e1780e62b369f58292dd7925d668f472a75e97b1ec26fa83",
      "bytes": 5025,
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
      "sha256": "8c19cad53d5095760c46cbd6ed48073627a35b868df18461a7083d1983913b12",
      "bytes": 4819,
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
      "sha256": "3652ed2bc91915f1198b59290275718ad1c05299d57abd73242bbd25d7be63c6",
      "bytes": 4674,
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
      "sha256": "dd4e80656e10f0fed1ed20b2c321ff10d2796d3156508091aec610d771f2a5c4",
      "bytes": 4911,
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
      "sha256": "e9d0898ace7188d41ff955b99f27767c69c0958f4ac243ff575d22d13efd6d29",
      "bytes": 4468,
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
      "sha256": "dcd2c82399e68f6508941bdbc37b0b74bb094988552a1b165d091d1d0dd76517",
      "bytes": 4485,
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
      "sha256": "c512939c7b76e0decba26e63447df17c57c9fbd43b560060029c23215c675df5",
      "bytes": 17999,
      "lods": []
    },
    "soul_cohort_sheet": {
      "kind": "review-page",
      "url": "/assets/souls/sheet.html",
      "format": "html",
      "fallbackUrl": null,
      "fallbackFormat": null,
      "sha256": "e2f6d41b6428805c78104ec66fbdfcfe0069d6dfd3b16fce33ff803105dd9bad",
      "bytes": 304543,
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
