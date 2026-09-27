// GENERATED FILE - do not hand-edit. Regenerate with: npm run ai:soul-decor (tools/ai/blender/soul_decor.py --mode produce).
// Decoration geometry and files for the baseline Soul (D-29, docs/art/soul-decorations.md): the 10 charm slots (model space
// + 2D viewBox), charm and face-kit file URLs, and the 2D sprite mapping. Frozen data, no imports: Node and browsers.
// charm.files lists only the charms whose GLB and PNG exist; charm.missing names the rest (the renderer skips them).
// Every URL carries ?v=<sha256 prefix> of its file. A charm GLB loads its texture as the relative URI <id>.png (sRGB,
// glTF UV orientation); a loader that keeps the query string can map that URI to files[id].png.
// A charm PNG (128 px) is also its flat 2D sprite: the outline circle is the image's inscribed circle, so it is drawn
// 2 r wide centred on slots[i].front2d. slots[i].sink seats each charm (fraction of charm.thickness x size).

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}

export const SOUL_DECOR = deepFreeze({
  "stub": false,
  "version": 1,
  "catalogVersion": 2,
  "generator": "tools/ai/blender/soul_decor.py --mode produce (npm run ai:soul-decor)",
  "frame": "glTF model space of assets/souls/baseline/soul-baseline-*.glb: +Y up, +Z front, model units, feet at y = floor",
  "floor": -0.02189,
  "height": 2.29087,
  "gradientSpan": {
    "top": 1.9,
    "bottom": 0
  },
  "charm": {
    "thickness": 0.3,
    "files": {
      "core-classic-lemon": {
        "glb": "/assets/souls/charms/core-classic-lemon.glb?v=2fcf59196c",
        "png": "/assets/souls/charms/core-classic-lemon.png?v=c63f1d0710"
      },
      "core-classic-peach": {
        "glb": "/assets/souls/charms/core-classic-peach.glb?v=d536f421ae",
        "png": "/assets/souls/charms/core-classic-peach.png?v=c8dd26a6de"
      },
      "core-classic-mint": {
        "glb": "/assets/souls/charms/core-classic-mint.glb?v=7fbb69bdde",
        "png": "/assets/souls/charms/core-classic-mint.png?v=2d016795af"
      },
      "core-classic-sky": {
        "glb": "/assets/souls/charms/core-classic-sky.glb?v=b1ac14687d",
        "png": "/assets/souls/charms/core-classic-sky.png?v=e9e1ea1c75"
      },
      "core-classic-lilac": {
        "glb": "/assets/souls/charms/core-classic-lilac.glb?v=d4bfdd24b4",
        "png": "/assets/souls/charms/core-classic-lilac.png?v=1c1730e2fc"
      },
      "core-chubby-lemon": {
        "glb": "/assets/souls/charms/core-chubby-lemon.glb?v=09ac745c22",
        "png": "/assets/souls/charms/core-chubby-lemon.png?v=c96cbff1d6"
      },
      "core-chubby-peach": {
        "glb": "/assets/souls/charms/core-chubby-peach.glb?v=8a69ddd17b",
        "png": "/assets/souls/charms/core-chubby-peach.png?v=2b3789de64"
      },
      "core-chubby-mint": {
        "glb": "/assets/souls/charms/core-chubby-mint.glb?v=383387dad9",
        "png": "/assets/souls/charms/core-chubby-mint.png?v=6997090d54"
      },
      "core-chubby-sky": {
        "glb": "/assets/souls/charms/core-chubby-sky.glb?v=b487df1960",
        "png": "/assets/souls/charms/core-chubby-sky.png?v=bc8044487a"
      },
      "core-chubby-lilac": {
        "glb": "/assets/souls/charms/core-chubby-lilac.glb?v=6af81440aa",
        "png": "/assets/souls/charms/core-chubby-lilac.png?v=35339d6227"
      },
      "core-sparkle-lemon": {
        "glb": "/assets/souls/charms/core-sparkle-lemon.glb?v=046fc8dc19",
        "png": "/assets/souls/charms/core-sparkle-lemon.png?v=34df2735ec"
      },
      "core-sparkle-peach": {
        "glb": "/assets/souls/charms/core-sparkle-peach.glb?v=a6c1630aab",
        "png": "/assets/souls/charms/core-sparkle-peach.png?v=a6cb422316"
      },
      "core-sparkle-mint": {
        "glb": "/assets/souls/charms/core-sparkle-mint.glb?v=691066afe3",
        "png": "/assets/souls/charms/core-sparkle-mint.png?v=ac899d428e"
      },
      "core-sparkle-sky": {
        "glb": "/assets/souls/charms/core-sparkle-sky.glb?v=d06082be19",
        "png": "/assets/souls/charms/core-sparkle-sky.png?v=782eb15aa1"
      },
      "core-sparkle-lilac": {
        "glb": "/assets/souls/charms/core-sparkle-lilac.glb?v=250be0c1bc",
        "png": "/assets/souls/charms/core-sparkle-lilac.png?v=6c3ff45d11"
      },
      "core-six-lemon": {
        "glb": "/assets/souls/charms/core-six-lemon.glb?v=70bb4da1a3",
        "png": "/assets/souls/charms/core-six-lemon.png?v=d673361467"
      },
      "core-six-peach": {
        "glb": "/assets/souls/charms/core-six-peach.glb?v=450db65efd",
        "png": "/assets/souls/charms/core-six-peach.png?v=a6235792f4"
      },
      "core-six-mint": {
        "glb": "/assets/souls/charms/core-six-mint.glb?v=08fe30cdd8",
        "png": "/assets/souls/charms/core-six-mint.png?v=125b3f6ebb"
      },
      "core-six-sky": {
        "glb": "/assets/souls/charms/core-six-sky.glb?v=139f0b6bb3",
        "png": "/assets/souls/charms/core-six-sky.png?v=0397873acd"
      },
      "core-six-lilac": {
        "glb": "/assets/souls/charms/core-six-lilac.glb?v=826ccc44fc",
        "png": "/assets/souls/charms/core-six-lilac.png?v=652604ed86"
      },
      "core-burst-lemon": {
        "glb": "/assets/souls/charms/core-burst-lemon.glb?v=76947c751b",
        "png": "/assets/souls/charms/core-burst-lemon.png?v=deb7aacea1"
      },
      "core-burst-peach": {
        "glb": "/assets/souls/charms/core-burst-peach.glb?v=04c10c9bae",
        "png": "/assets/souls/charms/core-burst-peach.png?v=b5407a7964"
      },
      "core-burst-mint": {
        "glb": "/assets/souls/charms/core-burst-mint.glb?v=9c56657ac0",
        "png": "/assets/souls/charms/core-burst-mint.png?v=b18c580c44"
      },
      "core-burst-sky": {
        "glb": "/assets/souls/charms/core-burst-sky.glb?v=0af5e7717f",
        "png": "/assets/souls/charms/core-burst-sky.png?v=4a33691e7e"
      },
      "core-burst-lilac": {
        "glb": "/assets/souls/charms/core-burst-lilac.glb?v=7fce388e88",
        "png": "/assets/souls/charms/core-burst-lilac.png?v=bb2a7ba6fa"
      },
      "core-shooting-lemon": {
        "glb": "/assets/souls/charms/core-shooting-lemon.glb?v=baa50b7a14",
        "png": "/assets/souls/charms/core-shooting-lemon.png?v=b967b78dcb"
      },
      "core-shooting-peach": {
        "glb": "/assets/souls/charms/core-shooting-peach.glb?v=957d11fecd",
        "png": "/assets/souls/charms/core-shooting-peach.png?v=46a259cf0f"
      },
      "core-shooting-mint": {
        "glb": "/assets/souls/charms/core-shooting-mint.glb?v=e41b44bcfd",
        "png": "/assets/souls/charms/core-shooting-mint.png?v=7c989a2561"
      },
      "core-shooting-sky": {
        "glb": "/assets/souls/charms/core-shooting-sky.glb?v=e4f7a52079",
        "png": "/assets/souls/charms/core-shooting-sky.png?v=889b562ac8"
      },
      "core-shooting-lilac": {
        "glb": "/assets/souls/charms/core-shooting-lilac.glb?v=8619c88b73",
        "png": "/assets/souls/charms/core-shooting-lilac.png?v=58283ab10d"
      },
      "core-ringed-lemon": {
        "glb": "/assets/souls/charms/core-ringed-lemon.glb?v=411cb4111a",
        "png": "/assets/souls/charms/core-ringed-lemon.png?v=bfe907d880"
      },
      "core-ringed-peach": {
        "glb": "/assets/souls/charms/core-ringed-peach.glb?v=963eaef428",
        "png": "/assets/souls/charms/core-ringed-peach.png?v=ac7ad1ffff"
      },
      "core-ringed-mint": {
        "glb": "/assets/souls/charms/core-ringed-mint.glb?v=b6e42991c6",
        "png": "/assets/souls/charms/core-ringed-mint.png?v=203e78f0f3"
      },
      "core-ringed-sky": {
        "glb": "/assets/souls/charms/core-ringed-sky.glb?v=1e292c5eb5",
        "png": "/assets/souls/charms/core-ringed-sky.png?v=c18da476ce"
      },
      "core-ringed-lilac": {
        "glb": "/assets/souls/charms/core-ringed-lilac.glb?v=1ba84f33b1",
        "png": "/assets/souls/charms/core-ringed-lilac.png?v=14df9e0eb1"
      },
      "core-twin-lemon": {
        "glb": "/assets/souls/charms/core-twin-lemon.glb?v=08059a9d04",
        "png": "/assets/souls/charms/core-twin-lemon.png?v=d2abbe8193"
      },
      "core-twin-peach": {
        "glb": "/assets/souls/charms/core-twin-peach.glb?v=423e7bcdfc",
        "png": "/assets/souls/charms/core-twin-peach.png?v=36c1623d19"
      },
      "core-twin-mint": {
        "glb": "/assets/souls/charms/core-twin-mint.glb?v=f404b9e828",
        "png": "/assets/souls/charms/core-twin-mint.png?v=2669afbbe5"
      },
      "core-twin-sky": {
        "glb": "/assets/souls/charms/core-twin-sky.glb?v=5ef985ac74",
        "png": "/assets/souls/charms/core-twin-sky.png?v=aaed4beda5"
      },
      "core-twin-lilac": {
        "glb": "/assets/souls/charms/core-twin-lilac.glb?v=81a87af458",
        "png": "/assets/souls/charms/core-twin-lilac.png?v=8663b84c95"
      },
      "core-pinwheel-lemon": {
        "glb": "/assets/souls/charms/core-pinwheel-lemon.glb?v=73cf12ee84",
        "png": "/assets/souls/charms/core-pinwheel-lemon.png?v=171fe239e5"
      },
      "core-pinwheel-peach": {
        "glb": "/assets/souls/charms/core-pinwheel-peach.glb?v=316a341b38",
        "png": "/assets/souls/charms/core-pinwheel-peach.png?v=836c6ff3a3"
      },
      "core-pinwheel-mint": {
        "glb": "/assets/souls/charms/core-pinwheel-mint.glb?v=02fba1eb94",
        "png": "/assets/souls/charms/core-pinwheel-mint.png?v=f1a9948811"
      },
      "core-pinwheel-sky": {
        "glb": "/assets/souls/charms/core-pinwheel-sky.glb?v=796c67199b",
        "png": "/assets/souls/charms/core-pinwheel-sky.png?v=c3973a0aa6"
      },
      "core-pinwheel-lilac": {
        "glb": "/assets/souls/charms/core-pinwheel-lilac.glb?v=d4e8ee7151",
        "png": "/assets/souls/charms/core-pinwheel-lilac.png?v=e3eff44f05"
      },
      "core-soft7-lemon": {
        "glb": "/assets/souls/charms/core-soft7-lemon.glb?v=2f5570702d",
        "png": "/assets/souls/charms/core-soft7-lemon.png?v=5522a444d9"
      },
      "core-soft7-peach": {
        "glb": "/assets/souls/charms/core-soft7-peach.glb?v=2ef89145d1",
        "png": "/assets/souls/charms/core-soft7-peach.png?v=14e0d9e106"
      },
      "core-soft7-mint": {
        "glb": "/assets/souls/charms/core-soft7-mint.glb?v=b15a8e58b3",
        "png": "/assets/souls/charms/core-soft7-mint.png?v=adff6fa207"
      },
      "core-soft7-sky": {
        "glb": "/assets/souls/charms/core-soft7-sky.glb?v=3ee50cfc76",
        "png": "/assets/souls/charms/core-soft7-sky.png?v=40f0dd08a2"
      },
      "core-soft7-lilac": {
        "glb": "/assets/souls/charms/core-soft7-lilac.glb?v=ae8e484284",
        "png": "/assets/souls/charms/core-soft7-lilac.png?v=3a70a55b94"
      },
      "tech-hammer": {
        "glb": "/assets/souls/charms/tech-hammer.glb?v=34d78791e3",
        "png": "/assets/souls/charms/tech-hammer.png?v=6d930a7b0e"
      },
      "tech-laptop": {
        "glb": "/assets/souls/charms/tech-laptop.glb?v=5158caff6e",
        "png": "/assets/souls/charms/tech-laptop.png?v=8203863a2e"
      },
      "tech-book": {
        "glb": "/assets/souls/charms/tech-book.glb?v=399f44b037",
        "png": "/assets/souls/charms/tech-book.png?v=a358df79ff"
      },
      "tech-pen": {
        "glb": "/assets/souls/charms/tech-pen.glb?v=40641e4f4f",
        "png": "/assets/souls/charms/tech-pen.png?v=0f4f104fc7"
      },
      "tech-wrench": {
        "glb": "/assets/souls/charms/tech-wrench.glb?v=709c689b51",
        "png": "/assets/souls/charms/tech-wrench.png?v=dd9b71c902"
      },
      "tech-screwdriver": {
        "glb": "/assets/souls/charms/tech-screwdriver.glb?v=9dc45fa69e",
        "png": "/assets/souls/charms/tech-screwdriver.png?v=174ee2adeb"
      },
      "tech-gear": {
        "glb": "/assets/souls/charms/tech-gear.glb?v=992d008d0a",
        "png": "/assets/souls/charms/tech-gear.png?v=2a663f46a6"
      },
      "tech-magnifier": {
        "glb": "/assets/souls/charms/tech-magnifier.glb?v=9fe7b6850a",
        "png": "/assets/souls/charms/tech-magnifier.png?v=d89de76674"
      },
      "tech-ruler": {
        "glb": "/assets/souls/charms/tech-ruler.glb?v=1c392b1ab4",
        "png": "/assets/souls/charms/tech-ruler.png?v=128b70f44f"
      },
      "tech-pencil": {
        "glb": "/assets/souls/charms/tech-pencil.glb?v=4372957127",
        "png": "/assets/souls/charms/tech-pencil.png?v=2c7791a268"
      },
      "tech-calculator": {
        "glb": "/assets/souls/charms/tech-calculator.glb?v=78600e2871",
        "png": "/assets/souls/charms/tech-calculator.png?v=1ffed5dc50"
      },
      "tech-keyboard": {
        "glb": "/assets/souls/charms/tech-keyboard.glb?v=1f75f1cf14",
        "png": "/assets/souls/charms/tech-keyboard.png?v=03716814f0"
      },
      "tech-mouse": {
        "glb": "/assets/souls/charms/tech-mouse.glb?v=4b4ff1bc49",
        "png": "/assets/souls/charms/tech-mouse.png?v=2e97419a01"
      },
      "tech-monitor": {
        "glb": "/assets/souls/charms/tech-monitor.glb?v=87cb12f034",
        "png": "/assets/souls/charms/tech-monitor.png?v=705022cb10"
      },
      "tech-smartphone": {
        "glb": "/assets/souls/charms/tech-smartphone.glb?v=dc9f758396",
        "png": "/assets/souls/charms/tech-smartphone.png?v=ca4ce32f9f"
      },
      "tech-tablet": {
        "glb": "/assets/souls/charms/tech-tablet.glb?v=380185b035",
        "png": "/assets/souls/charms/tech-tablet.png?v=cf4032d670"
      },
      "tech-microchip": {
        "glb": "/assets/souls/charms/tech-microchip.glb?v=65fa2e7439",
        "png": "/assets/souls/charms/tech-microchip.png?v=6d3f4913bb"
      },
      "tech-circuit": {
        "glb": "/assets/souls/charms/tech-circuit.glb?v=1488d6d6b7",
        "png": "/assets/souls/charms/tech-circuit.png?v=ee2339cdb2"
      },
      "tech-server": {
        "glb": "/assets/souls/charms/tech-server.glb?v=ae3f37b013",
        "png": "/assets/souls/charms/tech-server.png?v=df97ac7cf3"
      },
      "tech-database": {
        "glb": "/assets/souls/charms/tech-database.glb?v=8514519ee3",
        "png": "/assets/souls/charms/tech-database.png?v=359b7e1bbf"
      },
      "tech-cloud-upload": {
        "glb": "/assets/souls/charms/tech-cloud-upload.glb?v=6fc345a2b7",
        "png": "/assets/souls/charms/tech-cloud-upload.png?v=ca12d0f88e"
      },
      "tech-robot": {
        "glb": "/assets/souls/charms/tech-robot.glb?v=81788fbc0e",
        "png": "/assets/souls/charms/tech-robot.png?v=918c68d3d5"
      },
      "tech-rocket": {
        "glb": "/assets/souls/charms/tech-rocket.glb?v=7852075691",
        "png": "/assets/souls/charms/tech-rocket.png?v=8568450bc3"
      },
      "tech-lightbulb": {
        "glb": "/assets/souls/charms/tech-lightbulb.glb?v=082953c09e",
        "png": "/assets/souls/charms/tech-lightbulb.png?v=662c431277"
      },
      "tech-paintbrush": {
        "glb": "/assets/souls/charms/tech-paintbrush.glb?v=111519193e",
        "png": "/assets/souls/charms/tech-paintbrush.png?v=05698ec416"
      },
      "tech-palette": {
        "glb": "/assets/souls/charms/tech-palette.glb?v=035645f0e8",
        "png": "/assets/souls/charms/tech-palette.png?v=0e7086e159"
      },
      "tech-compass": {
        "glb": "/assets/souls/charms/tech-compass.glb?v=e39f1b5985",
        "png": "/assets/souls/charms/tech-compass.png?v=eea0be589d"
      },
      "tech-set-square": {
        "glb": "/assets/souls/charms/tech-set-square.glb?v=9cde05a604",
        "png": "/assets/souls/charms/tech-set-square.png?v=fcb7c1a252"
      },
      "tech-tape-measure": {
        "glb": "/assets/souls/charms/tech-tape-measure.glb?v=21e516987c",
        "png": "/assets/souls/charms/tech-tape-measure.png?v=9932695834"
      },
      "tech-pliers": {
        "glb": "/assets/souls/charms/tech-pliers.glb?v=8177f01b15",
        "png": "/assets/souls/charms/tech-pliers.png?v=aca6d42da9"
      },
      "tech-toolbox": {
        "glb": "/assets/souls/charms/tech-toolbox.glb?v=6e09e3923c",
        "png": "/assets/souls/charms/tech-toolbox.png?v=f4cc105728"
      },
      "tech-usb": {
        "glb": "/assets/souls/charms/tech-usb.glb?v=1cfb688421",
        "png": "/assets/souls/charms/tech-usb.png?v=b34cd5c70f"
      },
      "tech-battery": {
        "glb": "/assets/souls/charms/tech-battery.glb?v=7b9dc6bcca",
        "png": "/assets/souls/charms/tech-battery.png?v=c0eff2a865"
      },
      "tech-plug": {
        "glb": "/assets/souls/charms/tech-plug.glb?v=b57f903091",
        "png": "/assets/souls/charms/tech-plug.png?v=3208f88ea5"
      },
      "tech-magnet": {
        "glb": "/assets/souls/charms/tech-magnet.glb?v=81ae0686a2",
        "png": "/assets/souls/charms/tech-magnet.png?v=6de67dd986"
      },
      "tech-microscope": {
        "glb": "/assets/souls/charms/tech-microscope.glb?v=6d5120fac1",
        "png": "/assets/souls/charms/tech-microscope.png?v=f5037dafb0"
      },
      "tech-flask": {
        "glb": "/assets/souls/charms/tech-flask.glb?v=e6424c812f",
        "png": "/assets/souls/charms/tech-flask.png?v=57c5a41def"
      },
      "tech-telescope": {
        "glb": "/assets/souls/charms/tech-telescope.glb?v=5203f1684b",
        "png": "/assets/souls/charms/tech-telescope.png?v=0a457e3d71"
      },
      "tech-satellite": {
        "glb": "/assets/souls/charms/tech-satellite.glb?v=56840729f2",
        "png": "/assets/souls/charms/tech-satellite.png?v=55a5867ccb"
      },
      "tech-drone": {
        "glb": "/assets/souls/charms/tech-drone.glb?v=169c2f2486",
        "png": "/assets/souls/charms/tech-drone.png?v=4582383253"
      },
      "tech-printer-3d": {
        "glb": "/assets/souls/charms/tech-printer-3d.glb?v=c6c242ce2e",
        "png": "/assets/souls/charms/tech-printer-3d.png?v=c1897d3a2a"
      },
      "tech-camera": {
        "glb": "/assets/souls/charms/tech-camera.glb?v=170cff2cc4",
        "png": "/assets/souls/charms/tech-camera.png?v=ed5517a394"
      },
      "tech-floppy": {
        "glb": "/assets/souls/charms/tech-floppy.glb?v=a57c04566a",
        "png": "/assets/souls/charms/tech-floppy.png?v=a64d331bcd"
      },
      "tech-hard-hat": {
        "glb": "/assets/souls/charms/tech-hard-hat.glb?v=350952d8f2",
        "png": "/assets/souls/charms/tech-hard-hat.png?v=4a197fbecf"
      },
      "tech-padlock": {
        "glb": "/assets/souls/charms/tech-padlock.glb?v=a9450db1bf",
        "png": "/assets/souls/charms/tech-padlock.png?v=48e94fc4e1"
      },
      "tech-key": {
        "glb": "/assets/souls/charms/tech-key.glb?v=a127240b60",
        "png": "/assets/souls/charms/tech-key.png?v=5cda0f4477"
      },
      "tech-headset": {
        "glb": "/assets/souls/charms/tech-headset.glb?v=8f7cc2c2ae",
        "png": "/assets/souls/charms/tech-headset.png?v=5533b15cad"
      },
      "tech-bar-chart": {
        "glb": "/assets/souls/charms/tech-bar-chart.glb?v=9a60bb36ed",
        "png": "/assets/souls/charms/tech-bar-chart.png?v=f5f0264e5a"
      },
      "tech-clipboard": {
        "glb": "/assets/souls/charms/tech-clipboard.glb?v=34a1692b4f",
        "png": "/assets/souls/charms/tech-clipboard.png?v=03ea15fd46"
      },
      "tech-stopwatch": {
        "glb": "/assets/souls/charms/tech-stopwatch.glb?v=57d3efa5c5",
        "png": "/assets/souls/charms/tech-stopwatch.png?v=dd78e9186a"
      },
      "soft-earphones": {
        "glb": "/assets/souls/charms/soft-earphones.glb?v=c6cf5296b1",
        "png": "/assets/souls/charms/soft-earphones.png?v=6f505d356f"
      },
      "soft-daisy": {
        "glb": "/assets/souls/charms/soft-daisy.glb?v=514854542f",
        "png": "/assets/souls/charms/soft-daisy.png?v=75547221bd"
      },
      "soft-tulip": {
        "glb": "/assets/souls/charms/soft-tulip.glb?v=755e0e6f6e",
        "png": "/assets/souls/charms/soft-tulip.png?v=2db80ebf69"
      },
      "soft-sunflower": {
        "glb": "/assets/souls/charms/soft-sunflower.glb?v=cb7b756570",
        "png": "/assets/souls/charms/soft-sunflower.png?v=fc65815707"
      },
      "soft-rose": {
        "glb": "/assets/souls/charms/soft-rose.glb?v=ccfb40ae9e",
        "png": "/assets/souls/charms/soft-rose.png?v=a8a110bca6"
      },
      "soft-cherry-blossom": {
        "glb": "/assets/souls/charms/soft-cherry-blossom.glb?v=d3603c7619",
        "png": "/assets/souls/charms/soft-cherry-blossom.png?v=7c8cf855c7"
      },
      "soft-lavender": {
        "glb": "/assets/souls/charms/soft-lavender.glb?v=fef51a716b",
        "png": "/assets/souls/charms/soft-lavender.png?v=32549b47fa"
      },
      "soft-bouquet": {
        "glb": "/assets/souls/charms/soft-bouquet.glb?v=75921004fc",
        "png": "/assets/souls/charms/soft-bouquet.png?v=2df828ac6f"
      },
      "soft-potted-plant": {
        "glb": "/assets/souls/charms/soft-potted-plant.glb?v=39d62d3060",
        "png": "/assets/souls/charms/soft-potted-plant.png?v=108d6d76ec"
      },
      "soft-cactus": {
        "glb": "/assets/souls/charms/soft-cactus.glb?v=2dd3e4c236",
        "png": "/assets/souls/charms/soft-cactus.png?v=ef2e86c4bc"
      },
      "soft-sprout": {
        "glb": "/assets/souls/charms/soft-sprout.glb?v=d62c0e3d75",
        "png": "/assets/souls/charms/soft-sprout.png?v=0027c47911"
      },
      "soft-clover": {
        "glb": "/assets/souls/charms/soft-clover.glb?v=20e1ea59e4",
        "png": "/assets/souls/charms/soft-clover.png?v=ce5983567f"
      },
      "soft-tea-cup": {
        "glb": "/assets/souls/charms/soft-tea-cup.glb?v=5b38943c6a",
        "png": "/assets/souls/charms/soft-tea-cup.png?v=c7127a466d"
      },
      "soft-mug": {
        "glb": "/assets/souls/charms/soft-mug.glb?v=f41713641c",
        "png": "/assets/souls/charms/soft-mug.png?v=924c364f4b"
      },
      "soft-teapot": {
        "glb": "/assets/souls/charms/soft-teapot.glb?v=304502e372",
        "png": "/assets/souls/charms/soft-teapot.png?v=c2299c1167"
      },
      "soft-water-bottle": {
        "glb": "/assets/souls/charms/soft-water-bottle.glb?v=16a0a35ef6",
        "png": "/assets/souls/charms/soft-water-bottle.png?v=e2c66a1534"
      },
      "soft-juice": {
        "glb": "/assets/souls/charms/soft-juice.glb?v=ff131ab991",
        "png": "/assets/souls/charms/soft-juice.png?v=4e984911a8"
      },
      "soft-cookie": {
        "glb": "/assets/souls/charms/soft-cookie.glb?v=f1ba82182a",
        "png": "/assets/souls/charms/soft-cookie.png?v=eb0fac4dec"
      },
      "soft-cupcake": {
        "glb": "/assets/souls/charms/soft-cupcake.glb?v=ec766e8ad5",
        "png": "/assets/souls/charms/soft-cupcake.png?v=c89dc6779e"
      },
      "soft-strawberry": {
        "glb": "/assets/souls/charms/soft-strawberry.glb?v=b50f7ef12f",
        "png": "/assets/souls/charms/soft-strawberry.png?v=933aa59e17"
      },
      "soft-apple": {
        "glb": "/assets/souls/charms/soft-apple.glb?v=55d6f575fc",
        "png": "/assets/souls/charms/soft-apple.png?v=6bb8c9b7d0"
      },
      "soft-ice-cream": {
        "glb": "/assets/souls/charms/soft-ice-cream.glb?v=ac5305c553",
        "png": "/assets/souls/charms/soft-ice-cream.png?v=2e64e7f830"
      },
      "soft-donut": {
        "glb": "/assets/souls/charms/soft-donut.glb?v=f701a8fa10",
        "png": "/assets/souls/charms/soft-donut.png?v=2d878cb919"
      },
      "soft-candle": {
        "glb": "/assets/souls/charms/soft-candle.glb?v=cc4dafb4ba",
        "png": "/assets/souls/charms/soft-candle.png?v=4b7b3c3a48"
      },
      "soft-rubber-duck": {
        "glb": "/assets/souls/charms/soft-rubber-duck.glb?v=e4241b7e25",
        "png": "/assets/souls/charms/soft-rubber-duck.png?v=022e60033b"
      },
      "soft-pillow": {
        "glb": "/assets/souls/charms/soft-pillow.glb?v=0c397b982e",
        "png": "/assets/souls/charms/soft-pillow.png?v=b663cd9b40"
      },
      "soft-sleep-mask": {
        "glb": "/assets/souls/charms/soft-sleep-mask.glb?v=283e78126f",
        "png": "/assets/souls/charms/soft-sleep-mask.png?v=19c93cb0e4"
      },
      "soft-sun": {
        "glb": "/assets/souls/charms/soft-sun.glb?v=83f665b1cb",
        "png": "/assets/souls/charms/soft-sun.png?v=f98b9b8d3b"
      },
      "soft-rainbow": {
        "glb": "/assets/souls/charms/soft-rainbow.glb?v=6ed8e1ef0b",
        "png": "/assets/souls/charms/soft-rainbow.png?v=7bfeb885fd"
      },
      "soft-umbrella": {
        "glb": "/assets/souls/charms/soft-umbrella.glb?v=cc31258990",
        "png": "/assets/souls/charms/soft-umbrella.png?v=f0b104fbff"
      },
      "soft-hot-air-balloon": {
        "glb": "/assets/souls/charms/soft-hot-air-balloon.glb?v=c99f8b36aa",
        "png": "/assets/souls/charms/soft-hot-air-balloon.png?v=0b7e7fc042"
      },
      "soft-kite": {
        "glb": "/assets/souls/charms/soft-kite.glb?v=2d9cc16ebd",
        "png": "/assets/souls/charms/soft-kite.png?v=dba583e3a1"
      },
      "soft-paper-plane": {
        "glb": "/assets/souls/charms/soft-paper-plane.glb?v=94f66fca3f",
        "png": "/assets/souls/charms/soft-paper-plane.png?v=6a469d38b8"
      },
      "soft-balloon": {
        "glb": "/assets/souls/charms/soft-balloon.glb?v=43f374f698",
        "png": "/assets/souls/charms/soft-balloon.png?v=03f56790c8"
      },
      "soft-gift": {
        "glb": "/assets/souls/charms/soft-gift.glb?v=a862db9f1c",
        "png": "/assets/souls/charms/soft-gift.png?v=fa1594f41c"
      },
      "soft-music-note": {
        "glb": "/assets/souls/charms/soft-music-note.glb?v=991b6859f5",
        "png": "/assets/souls/charms/soft-music-note.png?v=d8f856e013"
      },
      "soft-guitar": {
        "glb": "/assets/souls/charms/soft-guitar.glb?v=d1e55dc262",
        "png": "/assets/souls/charms/soft-guitar.png?v=6cb1fe2d60"
      },
      "soft-vinyl": {
        "glb": "/assets/souls/charms/soft-vinyl.glb?v=8fbfaa33a5",
        "png": "/assets/souls/charms/soft-vinyl.png?v=5c8f3ee06e"
      },
      "soft-yarn": {
        "glb": "/assets/souls/charms/soft-yarn.glb?v=fc043288c2",
        "png": "/assets/souls/charms/soft-yarn.png?v=2ef31e9d83"
      },
      "soft-yoga-mat": {
        "glb": "/assets/souls/charms/soft-yoga-mat.glb?v=910f3f5f00",
        "png": "/assets/souls/charms/soft-yoga-mat.png?v=d84b4a7ee6"
      },
      "soft-dumbbell": {
        "glb": "/assets/souls/charms/soft-dumbbell.glb?v=e8d5133f54",
        "png": "/assets/souls/charms/soft-dumbbell.png?v=a03d1f4ed3"
      },
      "soft-running-shoe": {
        "glb": "/assets/souls/charms/soft-running-shoe.glb?v=959c445ec9",
        "png": "/assets/souls/charms/soft-running-shoe.png?v=a9709eb295"
      },
      "soft-bicycle": {
        "glb": "/assets/souls/charms/soft-bicycle.glb?v=1abf01f664",
        "png": "/assets/souls/charms/soft-bicycle.png?v=20e512c196"
      },
      "soft-football": {
        "glb": "/assets/souls/charms/soft-football.glb?v=cf80f051de",
        "png": "/assets/souls/charms/soft-football.png?v=9a791ac2f9"
      },
      "soft-watering-can": {
        "glb": "/assets/souls/charms/soft-watering-can.glb?v=e8aa4c5f14",
        "png": "/assets/souls/charms/soft-watering-can.png?v=26e243a724"
      },
      "soft-heart": {
        "glb": "/assets/souls/charms/soft-heart.glb?v=1bebc1996d",
        "png": "/assets/souls/charms/soft-heart.png?v=2777881b7f"
      },
      "soft-seashell": {
        "glb": "/assets/souls/charms/soft-seashell.glb?v=3f44f226b0",
        "png": "/assets/souls/charms/soft-seashell.png?v=6f7db3e474"
      },
      "soft-speech-bubble": {
        "glb": "/assets/souls/charms/soft-speech-bubble.glb?v=790b10cd6e",
        "png": "/assets/souls/charms/soft-speech-bubble.png?v=f424adb0d5"
      },
      "soft-butterfly": {
        "glb": "/assets/souls/charms/soft-butterfly.glb?v=41eab1bad6",
        "png": "/assets/souls/charms/soft-butterfly.png?v=3d2368ba73"
      },
      "soft-feather": {
        "glb": "/assets/souls/charms/soft-feather.glb?v=4fb3f133b1",
        "png": "/assets/souls/charms/soft-feather.png?v=e404e3a03b"
      }
    },
    "missing": []
  },
  "slots": [
    {
      "index": 0,
      "centre": [
        -0.04,
        0.76,
        0.36619
      ],
      "normal": [
        -0.11222,
        0.46272,
        0.87937
      ],
      "up": [
        0.05857,
        0.8865,
        -0.459
      ],
      "size": 0.2,
      "sink": 0.35,
      "front2d": {
        "x": 96.9,
        "y": 124.1,
        "r": 7.0
      }
    },
    {
      "index": 1,
      "centre": [
        0.26,
        0.74,
        0.24898
      ],
      "normal": [
        0.6539,
        0.32497,
        0.68324
      ],
      "up": [
        -0.22469,
        0.94573,
        -0.23477
      ],
      "size": 0.2,
      "sink": 0.35,
      "front2d": {
        "x": 120.0,
        "y": 125.9,
        "r": 7.0
      }
    },
    {
      "index": 2,
      "centre": [
        -0.44,
        0.62,
        0.14289
      ],
      "normal": [
        -0.5614,
        0.31013,
        0.76724
      ],
      "up": [
        0.18314,
        0.95069,
        -0.25028
      ],
      "size": 0.2,
      "sink": 0.35,
      "front2d": {
        "x": 67.7,
        "y": 134.4,
        "r": 7.0
      }
    },
    {
      "index": 3,
      "centre": [
        0.14,
        0.64,
        0.39475
      ],
      "normal": [
        0.37107,
        0.30334,
        0.87766
      ],
      "up": [
        -0.11813,
        0.95288,
        -0.27939
      ],
      "size": 0.2,
      "sink": 0.35,
      "front2d": {
        "x": 110.8,
        "y": 133.0,
        "r": 7.0
      }
    },
    {
      "index": 4,
      "centre": [
        0.44,
        0.58,
        0.15559
      ],
      "normal": [
        0.51319,
        0.28223,
        0.81055
      ],
      "up": [
        -0.15097,
        0.95935,
        -0.23845
      ],
      "size": 0.2,
      "sink": 0.35,
      "front2d": {
        "x": 132.2,
        "y": 137.2,
        "r": 7.0
      }
    },
    {
      "index": 5,
      "centre": [
        -0.14,
        0.48,
        0.42363
      ],
      "normal": [
        -0.36087,
        0.03274,
        0.93204
      ],
      "up": [
        0.01182,
        0.99946,
        -0.03053
      ],
      "size": 0.2,
      "sink": 0.35,
      "front2d": {
        "x": 89.2,
        "y": 144.9,
        "r": 7.0
      }
    },
    {
      "index": 6,
      "centre": [
        0.08,
        0.44,
        0.44138
      ],
      "normal": [
        0.20576,
        -0.03266,
        0.97806
      ],
      "up": [
        0.00672,
        0.99947,
        0.03196
      ],
      "size": 0.2,
      "sink": 0.35,
      "front2d": {
        "x": 106.2,
        "y": 147.9,
        "r": 7.0
      }
    },
    {
      "index": 7,
      "centre": [
        -0.2,
        0.28,
        0.36236
      ],
      "normal": [
        -0.53198,
        -0.30448,
        0.79012
      ],
      "up": [
        -0.17005,
        0.95252,
        0.25257
      ],
      "size": 0.2,
      "sink": 0.35,
      "front2d": {
        "x": 84.5,
        "y": 159.8,
        "r": 7.0
      }
    },
    {
      "index": 8,
      "centre": [
        0.0,
        0.22,
        0.40043
      ],
      "normal": [
        0.0,
        -0.41274,
        0.91085
      ],
      "up": [
        0.0,
        0.91085,
        0.41274
      ],
      "size": 0.2,
      "sink": 0.35,
      "front2d": {
        "x": 100.0,
        "y": 164.3,
        "r": 7.0
      }
    },
    {
      "index": 9,
      "centre": [
        0.2,
        0.28,
        0.36236
      ],
      "normal": [
        0.53198,
        -0.30448,
        0.79012
      ],
      "up": [
        0.17005,
        0.95252,
        0.25257
      ],
      "size": 0.2,
      "sink": 0.35,
      "front2d": {
        "x": 115.5,
        "y": 159.8,
        "r": 7.0
      }
    }
  ],
  "faces": {
    "nerdy": {
      "glb": "/assets/souls/faces/face-nerdy.glb?v=7835438466",
      "sprite": "/assets/souls/faces/face-nerdy-front.png?v=ebed0cecd5"
    },
    "pirate": {
      "glb": "/assets/souls/faces/face-pirate.glb?v=1ebdb76249",
      "sprite": "/assets/souls/faces/face-pirate-front.png?v=1b0a9b8c97"
    },
    "angel": {
      "glb": "/assets/souls/faces/face-angel.glb?v=f0710b8d4c",
      "sprite": "/assets/souls/faces/face-angel-front.png?v=a381143b15"
    }
  },
  "sprite2d": {
    "viewBox": 200,
    "size": 800,
    "map": {
      "x0": 100,
      "sx": 70,
      "y0": 178.6,
      "sy": -70
    }
  },
  "source": {
    "generator": "tools/ai/blender/soul_decor.py",
    "sha256": {
      "tools/ai/blender/soul_decor.py": "fcad0afb23a81163bffe6371e814a1c0229effff936a7df8738e947d94c463c8",
      "tools/ai/blender/soul_baseline.py": "ccfa0907831bd15790ddc54d4d90d2a5414a0aff6537546d38b2d9b4c4be28ae",
      "packages/game-rules/src/soul-catalog.js": "f0d8326dc8ec739a6c2e07dcb3ae92ccf4791ad2ca521d86ed918c588c27392f"
    },
    "slots": "assets-src/generated/soul-decor/v1/slots.json"
  }
});

export default SOUL_DECOR;
