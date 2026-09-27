// packages/game-rules/src/soul-catalog.js - the Soul decoration catalog (D-29, docs/art/soul-decorations.md).
// Pure data and lookups, no imports: the service (soul rules in soul.js), the apps (renderers) and the build tools
// (tools/ai/gemini-charms.js, tools/ai/blender/soul_decor.py, tools/ai/blender/soul_face.py) all read it, so there is one
// list of charms, faces, face plates, eyes and body gradients. The block between the markers is strict JSON so Python and the Gemini tool parse it without a JS
// engine. Ids are permanent: never rename, reuse or delete one (saved Souls refer to them); add new ones and bump version.
//
// Rules that use it (packages/game-rules/src/soul.js): a finished Soul has slotCount charms split across the three skill
// kinds in proportion to the 25 selected skills; its face comes from the kind with the most matched tiles (ties
// core > technical > soft); its body gradient and the charm variants are picked from the Soul's seed. Every gradient has
// the same mean brightness and every charm the same size (BR-17: no kind, face or colour reads as better or rarer).
// Catalog 2 (stage 13, D-31, docs/art/soul-faces.md) adds 10 face plates and 10 eye designs; a v3 Soul gets one of each
// and one antenna charm, all picked from its seed (never from its skills).
// BEGIN SOUL_CATALOG_JSON
const DATA = {
  "version": 2,
  "slotCount": 10,
  "kinds": [
    "core",
    "technical",
    "soft"
  ],
  "skillKind": {
    "Core Skill": "core",
    "Hard Skill": "technical",
    "Soft Skill": "soft"
  },
  "faces": {
    "core": "nerdy",
    "technical": "pirate",
    "soft": "angel"
  },
  "faceInfo": {
    "nerdy": {
      "name": "nerdy",
      "description": "round glasses over the button eyes"
    },
    "pirate": {
      "name": "pirate",
      "description": "an eye patch with a strap and a bandana"
    },
    "angel": {
      "name": "angel",
      "description": "a glowing halo above the head and soft blush"
    }
  },
  "plates": [
    {
      "id": "crack",
      "name": "lightning crack"
    },
    {
      "id": "bean",
      "name": "bean"
    },
    {
      "id": "notch",
      "name": "notched"
    },
    {
      "id": "skull-x",
      "name": "skull with a scar"
    },
    {
      "id": "bow",
      "name": "bow"
    },
    {
      "id": "round",
      "name": "round"
    },
    {
      "id": "bat",
      "name": "bat wing"
    },
    {
      "id": "dome",
      "name": "dome"
    },
    {
      "id": "skull",
      "name": "skull"
    },
    {
      "id": "cracked-bow",
      "name": "cracked bow"
    }
  ],
  "eyes": [
    {
      "id": "button",
      "name": "button eyes"
    },
    {
      "id": "lashes",
      "name": "closed eyes with lashes"
    },
    {
      "id": "hearts",
      "name": "heart eyes"
    },
    {
      "id": "sleepy",
      "name": "sleepy eyes"
    },
    {
      "id": "wink",
      "name": "a blue eye and a cross eye"
    },
    {
      "id": "sparkle",
      "name": "sparkle eyes"
    },
    {
      "id": "fierce",
      "name": "fierce cream eyes"
    },
    {
      "id": "fierce-red",
      "name": "fierce red eyes"
    },
    {
      "id": "bead",
      "name": "bead eyes"
    },
    {
      "id": "happy",
      "name": "happy squint eyes"
    }
  ],
  "gradientSpan": {
    "top": 1.9,
    "bottom": 0,
    "space": "srgb"
  },
  "gradients": [
    {
      "id": "aurora",
      "name": "Aurora",
      "top": "#9AECD9",
      "bottom": "#61BCD6",
      "highlight": "#E3FFF8",
      "outline": "#2A5AA6",
      "glow": "#72E8CF"
    },
    {
      "id": "lagoon",
      "name": "Lagoon",
      "top": "#B2E9FF",
      "bottom": "#75AAFF",
      "highlight": "#E9F6FF",
      "outline": "#2E4DB8",
      "glow": "#82D9FF"
    },
    {
      "id": "sunset",
      "name": "Sunset",
      "top": "#FBD097",
      "bottom": "#FB9CA3",
      "highlight": "#FFEBDD",
      "outline": "#A8436E",
      "glow": "#FFB07C"
    },
    {
      "id": "orchid",
      "name": "Orchid",
      "top": "#FFC7FF",
      "bottom": "#C3A5FF",
      "highlight": "#FAE8FF",
      "outline": "#6E3AB8",
      "glow": "#E69EFF"
    },
    {
      "id": "mint",
      "name": "Mint",
      "top": "#B8E49E",
      "bottom": "#6DC7A2",
      "highlight": "#EEFFEC",
      "outline": "#2C7F66",
      "glow": "#98F0A4"
    },
    {
      "id": "coral",
      "name": "Coral",
      "top": "#FFCCB8",
      "bottom": "#FF98B2",
      "highlight": "#FFE6E8",
      "outline": "#A3376A",
      "glow": "#FF9EB4"
    },
    {
      "id": "sky",
      "name": "Sky",
      "top": "#CDDDFF",
      "bottom": "#94ACFF",
      "highlight": "#EEF1FF",
      "outline": "#3A44A8",
      "glow": "#A9BEFF"
    },
    {
      "id": "lilac",
      "name": "Lilac",
      "top": "#E4D8FF",
      "bottom": "#B49FFF",
      "highlight": "#F4EEFF",
      "outline": "#5D3FA6",
      "glow": "#D0BCFF"
    },
    {
      "id": "dawn",
      "name": "Dawn",
      "top": "#ECC7A3",
      "bottom": "#90CEB9",
      "highlight": "#FFF6EC",
      "outline": "#3F7A6E",
      "glow": "#FFD1A6"
    },
    {
      "id": "berry",
      "name": "Berry",
      "top": "#FFCDF2",
      "bottom": "#BAA3FF",
      "highlight": "#FFE8F5",
      "outline": "#6A3AA8",
      "glow": "#FFA8DD"
    },
    {
      "id": "lemonade",
      "name": "Lemonade",
      "top": "#F6E38E",
      "bottom": "#78ADD3",
      "highlight": "#FFFBE3",
      "outline": "#2F5E9E",
      "glow": "#FFE58F"
    },
    {
      "id": "twilight",
      "name": "Twilight",
      "top": "#A5E8DF",
      "bottom": "#BDA3F7",
      "highlight": "#F0FFFD",
      "outline": "#4B4AA6",
      "glow": "#B8F5EC"
    }
  ],
  "starShapes": [
    {
      "id": "classic",
      "name": "classic star",
      "look": "classic five-point star with softly rounded tips"
    },
    {
      "id": "chubby",
      "name": "chubby star",
      "look": "chubby five-point star with short, fat, round arms"
    },
    {
      "id": "sparkle",
      "name": "sparkle",
      "look": "four-point sparkle with curved, pinched sides"
    },
    {
      "id": "six",
      "name": "six-point star",
      "look": "six-point star with rounded tips"
    },
    {
      "id": "burst",
      "name": "starburst",
      "look": "eight-point starburst with short rays"
    },
    {
      "id": "shooting",
      "name": "shooting star",
      "look": "five-point star trailing a short curved comet tail"
    },
    {
      "id": "ringed",
      "name": "ringed star",
      "look": "five-point star circled by a thin tilted orbit ring"
    },
    {
      "id": "twin",
      "name": "twin stars",
      "look": "two overlapping stars, one big and one small"
    },
    {
      "id": "pinwheel",
      "name": "pinwheel star",
      "look": "five-point pinwheel star with twisted, curved arms"
    },
    {
      "id": "soft7",
      "name": "seven-point star",
      "look": "seven-point star with soft, rounded tips"
    }
  ],
  "starShades": [
    {
      "id": "lemon",
      "name": "lemon",
      "fill": "#F4D975",
      "light": "#FFF7D1",
      "outline": "#B8702A"
    },
    {
      "id": "peach",
      "name": "peach",
      "fill": "#FFD2A2",
      "light": "#FFE6D8",
      "outline": "#B04F66"
    },
    {
      "id": "mint",
      "name": "mint",
      "fill": "#92ECC3",
      "light": "#E1FFF1",
      "outline": "#2B7C66"
    },
    {
      "id": "sky",
      "name": "sky",
      "fill": "#A4E3FF",
      "light": "#E2F1FF",
      "outline": "#3450AE"
    },
    {
      "id": "lilac",
      "name": "lilac",
      "fill": "#F4CDFF",
      "light": "#F0E8FF",
      "outline": "#5E3EAE"
    }
  ],
  "charms": [
    {
      "id": "core-classic-lemon",
      "kind": "core",
      "name": "classic star, lemon",
      "shape": "classic",
      "shade": "lemon"
    },
    {
      "id": "core-classic-peach",
      "kind": "core",
      "name": "classic star, peach",
      "shape": "classic",
      "shade": "peach"
    },
    {
      "id": "core-classic-mint",
      "kind": "core",
      "name": "classic star, mint",
      "shape": "classic",
      "shade": "mint"
    },
    {
      "id": "core-classic-sky",
      "kind": "core",
      "name": "classic star, sky",
      "shape": "classic",
      "shade": "sky"
    },
    {
      "id": "core-classic-lilac",
      "kind": "core",
      "name": "classic star, lilac",
      "shape": "classic",
      "shade": "lilac"
    },
    {
      "id": "core-chubby-lemon",
      "kind": "core",
      "name": "chubby star, lemon",
      "shape": "chubby",
      "shade": "lemon"
    },
    {
      "id": "core-chubby-peach",
      "kind": "core",
      "name": "chubby star, peach",
      "shape": "chubby",
      "shade": "peach"
    },
    {
      "id": "core-chubby-mint",
      "kind": "core",
      "name": "chubby star, mint",
      "shape": "chubby",
      "shade": "mint"
    },
    {
      "id": "core-chubby-sky",
      "kind": "core",
      "name": "chubby star, sky",
      "shape": "chubby",
      "shade": "sky"
    },
    {
      "id": "core-chubby-lilac",
      "kind": "core",
      "name": "chubby star, lilac",
      "shape": "chubby",
      "shade": "lilac"
    },
    {
      "id": "core-sparkle-lemon",
      "kind": "core",
      "name": "sparkle, lemon",
      "shape": "sparkle",
      "shade": "lemon"
    },
    {
      "id": "core-sparkle-peach",
      "kind": "core",
      "name": "sparkle, peach",
      "shape": "sparkle",
      "shade": "peach"
    },
    {
      "id": "core-sparkle-mint",
      "kind": "core",
      "name": "sparkle, mint",
      "shape": "sparkle",
      "shade": "mint"
    },
    {
      "id": "core-sparkle-sky",
      "kind": "core",
      "name": "sparkle, sky",
      "shape": "sparkle",
      "shade": "sky"
    },
    {
      "id": "core-sparkle-lilac",
      "kind": "core",
      "name": "sparkle, lilac",
      "shape": "sparkle",
      "shade": "lilac"
    },
    {
      "id": "core-six-lemon",
      "kind": "core",
      "name": "six-point star, lemon",
      "shape": "six",
      "shade": "lemon"
    },
    {
      "id": "core-six-peach",
      "kind": "core",
      "name": "six-point star, peach",
      "shape": "six",
      "shade": "peach"
    },
    {
      "id": "core-six-mint",
      "kind": "core",
      "name": "six-point star, mint",
      "shape": "six",
      "shade": "mint"
    },
    {
      "id": "core-six-sky",
      "kind": "core",
      "name": "six-point star, sky",
      "shape": "six",
      "shade": "sky"
    },
    {
      "id": "core-six-lilac",
      "kind": "core",
      "name": "six-point star, lilac",
      "shape": "six",
      "shade": "lilac"
    },
    {
      "id": "core-burst-lemon",
      "kind": "core",
      "name": "starburst, lemon",
      "shape": "burst",
      "shade": "lemon"
    },
    {
      "id": "core-burst-peach",
      "kind": "core",
      "name": "starburst, peach",
      "shape": "burst",
      "shade": "peach"
    },
    {
      "id": "core-burst-mint",
      "kind": "core",
      "name": "starburst, mint",
      "shape": "burst",
      "shade": "mint"
    },
    {
      "id": "core-burst-sky",
      "kind": "core",
      "name": "starburst, sky",
      "shape": "burst",
      "shade": "sky"
    },
    {
      "id": "core-burst-lilac",
      "kind": "core",
      "name": "starburst, lilac",
      "shape": "burst",
      "shade": "lilac"
    },
    {
      "id": "core-shooting-lemon",
      "kind": "core",
      "name": "shooting star, lemon",
      "shape": "shooting",
      "shade": "lemon"
    },
    {
      "id": "core-shooting-peach",
      "kind": "core",
      "name": "shooting star, peach",
      "shape": "shooting",
      "shade": "peach"
    },
    {
      "id": "core-shooting-mint",
      "kind": "core",
      "name": "shooting star, mint",
      "shape": "shooting",
      "shade": "mint"
    },
    {
      "id": "core-shooting-sky",
      "kind": "core",
      "name": "shooting star, sky",
      "shape": "shooting",
      "shade": "sky"
    },
    {
      "id": "core-shooting-lilac",
      "kind": "core",
      "name": "shooting star, lilac",
      "shape": "shooting",
      "shade": "lilac"
    },
    {
      "id": "core-ringed-lemon",
      "kind": "core",
      "name": "ringed star, lemon",
      "shape": "ringed",
      "shade": "lemon"
    },
    {
      "id": "core-ringed-peach",
      "kind": "core",
      "name": "ringed star, peach",
      "shape": "ringed",
      "shade": "peach"
    },
    {
      "id": "core-ringed-mint",
      "kind": "core",
      "name": "ringed star, mint",
      "shape": "ringed",
      "shade": "mint"
    },
    {
      "id": "core-ringed-sky",
      "kind": "core",
      "name": "ringed star, sky",
      "shape": "ringed",
      "shade": "sky"
    },
    {
      "id": "core-ringed-lilac",
      "kind": "core",
      "name": "ringed star, lilac",
      "shape": "ringed",
      "shade": "lilac"
    },
    {
      "id": "core-twin-lemon",
      "kind": "core",
      "name": "twin stars, lemon",
      "shape": "twin",
      "shade": "lemon"
    },
    {
      "id": "core-twin-peach",
      "kind": "core",
      "name": "twin stars, peach",
      "shape": "twin",
      "shade": "peach"
    },
    {
      "id": "core-twin-mint",
      "kind": "core",
      "name": "twin stars, mint",
      "shape": "twin",
      "shade": "mint"
    },
    {
      "id": "core-twin-sky",
      "kind": "core",
      "name": "twin stars, sky",
      "shape": "twin",
      "shade": "sky"
    },
    {
      "id": "core-twin-lilac",
      "kind": "core",
      "name": "twin stars, lilac",
      "shape": "twin",
      "shade": "lilac"
    },
    {
      "id": "core-pinwheel-lemon",
      "kind": "core",
      "name": "pinwheel star, lemon",
      "shape": "pinwheel",
      "shade": "lemon"
    },
    {
      "id": "core-pinwheel-peach",
      "kind": "core",
      "name": "pinwheel star, peach",
      "shape": "pinwheel",
      "shade": "peach"
    },
    {
      "id": "core-pinwheel-mint",
      "kind": "core",
      "name": "pinwheel star, mint",
      "shape": "pinwheel",
      "shade": "mint"
    },
    {
      "id": "core-pinwheel-sky",
      "kind": "core",
      "name": "pinwheel star, sky",
      "shape": "pinwheel",
      "shade": "sky"
    },
    {
      "id": "core-pinwheel-lilac",
      "kind": "core",
      "name": "pinwheel star, lilac",
      "shape": "pinwheel",
      "shade": "lilac"
    },
    {
      "id": "core-soft7-lemon",
      "kind": "core",
      "name": "seven-point star, lemon",
      "shape": "soft7",
      "shade": "lemon"
    },
    {
      "id": "core-soft7-peach",
      "kind": "core",
      "name": "seven-point star, peach",
      "shape": "soft7",
      "shade": "peach"
    },
    {
      "id": "core-soft7-mint",
      "kind": "core",
      "name": "seven-point star, mint",
      "shape": "soft7",
      "shade": "mint"
    },
    {
      "id": "core-soft7-sky",
      "kind": "core",
      "name": "seven-point star, sky",
      "shape": "soft7",
      "shade": "sky"
    },
    {
      "id": "core-soft7-lilac",
      "kind": "core",
      "name": "seven-point star, lilac",
      "shape": "soft7",
      "shade": "lilac"
    },
    {
      "id": "tech-hammer",
      "kind": "technical",
      "name": "hammer",
      "look": "a claw hammer with a wooden handle"
    },
    {
      "id": "tech-laptop",
      "kind": "technical",
      "name": "laptop",
      "look": "an open laptop"
    },
    {
      "id": "tech-book",
      "kind": "technical",
      "name": "book",
      "look": "a closed hardcover book"
    },
    {
      "id": "tech-pen",
      "kind": "technical",
      "name": "pen",
      "look": "a ballpoint pen"
    },
    {
      "id": "tech-wrench",
      "kind": "technical",
      "name": "wrench",
      "look": "an open-end wrench"
    },
    {
      "id": "tech-screwdriver",
      "kind": "technical",
      "name": "screwdriver",
      "look": "a screwdriver with a chunky handle"
    },
    {
      "id": "tech-gear",
      "kind": "technical",
      "name": "gear",
      "look": "a cog wheel"
    },
    {
      "id": "tech-magnifier",
      "kind": "technical",
      "name": "magnifying glass",
      "look": "a magnifying glass"
    },
    {
      "id": "tech-ruler",
      "kind": "technical",
      "name": "ruler",
      "look": "a straight ruler with tick marks"
    },
    {
      "id": "tech-pencil",
      "kind": "technical",
      "name": "pencil",
      "look": "a pencil with an eraser"
    },
    {
      "id": "tech-calculator",
      "kind": "technical",
      "name": "calculator",
      "look": "a pocket calculator with round buttons"
    },
    {
      "id": "tech-keyboard",
      "kind": "technical",
      "name": "keyboard",
      "look": "a small computer keyboard"
    },
    {
      "id": "tech-mouse",
      "kind": "technical",
      "name": "computer mouse",
      "look": "a computer mouse"
    },
    {
      "id": "tech-monitor",
      "kind": "technical",
      "name": "monitor",
      "look": "a desktop monitor on a stand"
    },
    {
      "id": "tech-smartphone",
      "kind": "technical",
      "name": "smartphone",
      "look": "a smartphone"
    },
    {
      "id": "tech-tablet",
      "kind": "technical",
      "name": "tablet",
      "look": "a tablet with a stylus"
    },
    {
      "id": "tech-microchip",
      "kind": "technical",
      "name": "microchip",
      "look": "a microchip with metal pins"
    },
    {
      "id": "tech-circuit",
      "kind": "technical",
      "name": "circuit board",
      "look": "a small circuit board"
    },
    {
      "id": "tech-server",
      "kind": "technical",
      "name": "server rack",
      "look": "a server rack"
    },
    {
      "id": "tech-database",
      "kind": "technical",
      "name": "database",
      "look": "a stack of database cylinders"
    },
    {
      "id": "tech-cloud-upload",
      "kind": "technical",
      "name": "cloud upload",
      "look": "a cloud with an upward arrow"
    },
    {
      "id": "tech-robot",
      "kind": "technical",
      "name": "robot",
      "look": "a friendly boxy robot with round lamp eyes"
    },
    {
      "id": "tech-rocket",
      "kind": "technical",
      "name": "rocket",
      "look": "a rocket"
    },
    {
      "id": "tech-lightbulb",
      "kind": "technical",
      "name": "light bulb",
      "look": "a light bulb"
    },
    {
      "id": "tech-paintbrush",
      "kind": "technical",
      "name": "paintbrush",
      "look": "a paintbrush"
    },
    {
      "id": "tech-palette",
      "kind": "technical",
      "name": "paint palette",
      "look": "a painter's palette with paint blobs"
    },
    {
      "id": "tech-compass",
      "kind": "technical",
      "name": "drafting compass",
      "look": "a drafting compass"
    },
    {
      "id": "tech-set-square",
      "kind": "technical",
      "name": "set square",
      "look": "a triangular set square"
    },
    {
      "id": "tech-tape-measure",
      "kind": "technical",
      "name": "tape measure",
      "look": "a tape measure"
    },
    {
      "id": "tech-pliers",
      "kind": "technical",
      "name": "pliers",
      "look": "a pair of pliers"
    },
    {
      "id": "tech-toolbox",
      "kind": "technical",
      "name": "toolbox",
      "look": "a toolbox"
    },
    {
      "id": "tech-usb",
      "kind": "technical",
      "name": "USB stick",
      "look": "a USB stick"
    },
    {
      "id": "tech-battery",
      "kind": "technical",
      "name": "battery",
      "look": "a battery"
    },
    {
      "id": "tech-plug",
      "kind": "technical",
      "name": "power plug",
      "look": "a power plug with a short cable"
    },
    {
      "id": "tech-magnet",
      "kind": "technical",
      "name": "magnet",
      "look": "a horseshoe magnet"
    },
    {
      "id": "tech-microscope",
      "kind": "technical",
      "name": "microscope",
      "look": "a microscope"
    },
    {
      "id": "tech-flask",
      "kind": "technical",
      "name": "lab flask",
      "look": "a lab flask with bubbling coloured liquid"
    },
    {
      "id": "tech-telescope",
      "kind": "technical",
      "name": "telescope",
      "look": "a telescope on a small tripod"
    },
    {
      "id": "tech-satellite",
      "kind": "technical",
      "name": "satellite",
      "look": "a satellite with solar panels"
    },
    {
      "id": "tech-drone",
      "kind": "technical",
      "name": "drone",
      "look": "a quadcopter drone"
    },
    {
      "id": "tech-printer-3d",
      "kind": "technical",
      "name": "3D printer",
      "look": "a small 3D printer"
    },
    {
      "id": "tech-camera",
      "kind": "technical",
      "name": "camera",
      "look": "a camera"
    },
    {
      "id": "tech-floppy",
      "kind": "technical",
      "name": "floppy disk",
      "look": "a floppy disk"
    },
    {
      "id": "tech-hard-hat",
      "kind": "technical",
      "name": "hard hat",
      "look": "a hard hat"
    },
    {
      "id": "tech-padlock",
      "kind": "technical",
      "name": "padlock",
      "look": "a padlock"
    },
    {
      "id": "tech-key",
      "kind": "technical",
      "name": "key",
      "look": "a key"
    },
    {
      "id": "tech-headset",
      "kind": "technical",
      "name": "headset",
      "look": "a headset with a microphone"
    },
    {
      "id": "tech-bar-chart",
      "kind": "technical",
      "name": "bar chart",
      "look": "a bar chart card"
    },
    {
      "id": "tech-clipboard",
      "kind": "technical",
      "name": "clipboard",
      "look": "a clipboard with a checklist"
    },
    {
      "id": "tech-stopwatch",
      "kind": "technical",
      "name": "stopwatch",
      "look": "a stopwatch"
    },
    {
      "id": "soft-earphones",
      "kind": "soft",
      "name": "earphones",
      "look": "a pair of wireless earphones"
    },
    {
      "id": "soft-daisy",
      "kind": "soft",
      "name": "daisy",
      "look": "a daisy"
    },
    {
      "id": "soft-tulip",
      "kind": "soft",
      "name": "tulip",
      "look": "a tulip"
    },
    {
      "id": "soft-sunflower",
      "kind": "soft",
      "name": "sunflower",
      "look": "a sunflower"
    },
    {
      "id": "soft-rose",
      "kind": "soft",
      "name": "rose",
      "look": "a rose"
    },
    {
      "id": "soft-cherry-blossom",
      "kind": "soft",
      "name": "cherry blossom",
      "look": "a cherry blossom sprig"
    },
    {
      "id": "soft-lavender",
      "kind": "soft",
      "name": "lavender",
      "look": "a lavender sprig"
    },
    {
      "id": "soft-bouquet",
      "kind": "soft",
      "name": "bouquet",
      "look": "a small flower bouquet"
    },
    {
      "id": "soft-potted-plant",
      "kind": "soft",
      "name": "potted plant",
      "look": "a potted plant"
    },
    {
      "id": "soft-cactus",
      "kind": "soft",
      "name": "cactus",
      "look": "a cactus in a pot"
    },
    {
      "id": "soft-sprout",
      "kind": "soft",
      "name": "sprout",
      "look": "a seedling sprout"
    },
    {
      "id": "soft-clover",
      "kind": "soft",
      "name": "four-leaf clover",
      "look": "a four-leaf clover"
    },
    {
      "id": "soft-tea-cup",
      "kind": "soft",
      "name": "tea cup",
      "look": "a tea cup with a wisp of steam"
    },
    {
      "id": "soft-mug",
      "kind": "soft",
      "name": "coffee mug",
      "look": "a coffee mug"
    },
    {
      "id": "soft-teapot",
      "kind": "soft",
      "name": "teapot",
      "look": "a teapot"
    },
    {
      "id": "soft-water-bottle",
      "kind": "soft",
      "name": "water bottle",
      "look": "a water bottle"
    },
    {
      "id": "soft-juice",
      "kind": "soft",
      "name": "juice",
      "look": "a glass of juice with a straw"
    },
    {
      "id": "soft-cookie",
      "kind": "soft",
      "name": "cookie",
      "look": "a chocolate chip cookie"
    },
    {
      "id": "soft-cupcake",
      "kind": "soft",
      "name": "cupcake",
      "look": "a cupcake"
    },
    {
      "id": "soft-strawberry",
      "kind": "soft",
      "name": "strawberry",
      "look": "a strawberry"
    },
    {
      "id": "soft-apple",
      "kind": "soft",
      "name": "apple",
      "look": "an apple"
    },
    {
      "id": "soft-ice-cream",
      "kind": "soft",
      "name": "ice cream",
      "look": "an ice cream cone"
    },
    {
      "id": "soft-donut",
      "kind": "soft",
      "name": "donut",
      "look": "a donut with sprinkles"
    },
    {
      "id": "soft-candle",
      "kind": "soft",
      "name": "candle",
      "look": "a candle"
    },
    {
      "id": "soft-rubber-duck",
      "kind": "soft",
      "name": "rubber duck",
      "look": "a rubber duck"
    },
    {
      "id": "soft-pillow",
      "kind": "soft",
      "name": "pillow",
      "look": "a fluffy pillow"
    },
    {
      "id": "soft-sleep-mask",
      "kind": "soft",
      "name": "sleep mask",
      "look": "a sleep mask"
    },
    {
      "id": "soft-sun",
      "kind": "soft",
      "name": "sun",
      "look": "a sun with rounded rays, no face"
    },
    {
      "id": "soft-rainbow",
      "kind": "soft",
      "name": "rainbow",
      "look": "a rainbow with two little clouds"
    },
    {
      "id": "soft-umbrella",
      "kind": "soft",
      "name": "umbrella",
      "look": "an open umbrella"
    },
    {
      "id": "soft-hot-air-balloon",
      "kind": "soft",
      "name": "hot-air balloon",
      "look": "a hot-air balloon"
    },
    {
      "id": "soft-kite",
      "kind": "soft",
      "name": "kite",
      "look": "a kite with a ribbon tail"
    },
    {
      "id": "soft-paper-plane",
      "kind": "soft",
      "name": "paper plane",
      "look": "a paper plane"
    },
    {
      "id": "soft-balloon",
      "kind": "soft",
      "name": "balloon",
      "look": "a balloon on a string"
    },
    {
      "id": "soft-gift",
      "kind": "soft",
      "name": "gift box",
      "look": "a gift box with a bow"
    },
    {
      "id": "soft-music-note",
      "kind": "soft",
      "name": "music note",
      "look": "a music note"
    },
    {
      "id": "soft-guitar",
      "kind": "soft",
      "name": "guitar",
      "look": "an acoustic guitar"
    },
    {
      "id": "soft-vinyl",
      "kind": "soft",
      "name": "vinyl record",
      "look": "a vinyl record"
    },
    {
      "id": "soft-yarn",
      "kind": "soft",
      "name": "yarn ball",
      "look": "a ball of yarn with knitting needles"
    },
    {
      "id": "soft-yoga-mat",
      "kind": "soft",
      "name": "yoga mat",
      "look": "a rolled yoga mat"
    },
    {
      "id": "soft-dumbbell",
      "kind": "soft",
      "name": "dumbbell",
      "look": "a dumbbell"
    },
    {
      "id": "soft-running-shoe",
      "kind": "soft",
      "name": "running shoe",
      "look": "a running shoe"
    },
    {
      "id": "soft-bicycle",
      "kind": "soft",
      "name": "bicycle",
      "look": "a bicycle"
    },
    {
      "id": "soft-football",
      "kind": "soft",
      "name": "football",
      "look": "a football (soccer ball)"
    },
    {
      "id": "soft-watering-can",
      "kind": "soft",
      "name": "watering can",
      "look": "a watering can"
    },
    {
      "id": "soft-heart",
      "kind": "soft",
      "name": "heart",
      "look": "a heart"
    },
    {
      "id": "soft-seashell",
      "kind": "soft",
      "name": "seashell",
      "look": "a seashell"
    },
    {
      "id": "soft-speech-bubble",
      "kind": "soft",
      "name": "speech bubble",
      "look": "an empty speech bubble"
    },
    {
      "id": "soft-butterfly",
      "kind": "soft",
      "name": "butterfly",
      "look": "a butterfly"
    },
    {
      "id": "soft-feather",
      "kind": "soft",
      "name": "feather",
      "look": "a feather"
    }
  ]
};
// END SOUL_CATALOG_JSON

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}

export const SOUL_CATALOG = deepFreeze(DATA);
export const CATALOG_VERSION = DATA.version;
export const SLOT_COUNT = DATA.slotCount;
/** Skill kinds in tie-break order: core > technical > soft. */
export const KINDS = DATA.kinds;
/** Face per winning kind: core -> nerdy, technical -> pirate, soft -> angel. */
export const FACE_BY_KIND = DATA.faces;
export const FACES = Object.freeze(DATA.kinds.map((k) => DATA.faces[k]));
export const GRADIENTS = DATA.gradients;
export const CHARMS = DATA.charms;
export const CHARM_BY_ID = new Map(CHARMS.map((c) => [c.id, c]));
/** Charm ids per kind, in catalog order (50 each). */
export const CHARMS_BY_KIND = Object.freeze(Object.fromEntries(KINDS.map((k) => [k, Object.freeze(CHARMS.filter((c) => c.kind === k).map((c) => c.id))])));

/** Face plates (catalog 2) in catalog order: { id, name }. */
export const PLATES = DATA.plates;
export const PLATE_IDS = Object.freeze(PLATES.map((p) => p.id));
/** Eye designs (catalog 2) in catalog order: { id, name }. */
export const EYES = DATA.eyes;
export const EYE_IDS = Object.freeze(EYES.map((e) => e.id));

/** skill-master `kind` label ("Core Skill" | "Hard Skill" | "Soft Skill") -> catalog kind, or null. */
export function skillKindOf(label) { return Object.prototype.hasOwnProperty.call(DATA.skillKind, label) ? DATA.skillKind[label] : null; }
