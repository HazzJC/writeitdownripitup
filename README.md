# Ritual

**Write it down. Let it go.**

A writing ritual on a rainy desk. You pick up a pen, choose an ink and a sheet,
and write. The weather outside the window answers what you do — rain thickens,
wind rises, thunder closes in — and when you are finished you hold a wax seal
until the storm breaks, let go, and the candle takes the page.

Nothing is saved. There is no server and no storage. When it burns, it is gone.

Live at **<https://ritual.harryjameschapman.com>**.

## Running and building

```bash
npm start              # dev server on http://localhost:5173
npm run build:single   # dist/ritual.html  — the whole app in one file
npm run build:desktop  # a Windows .exe and installer
```

There is no build step for the website. Cloudflare Pages serves the repository
root directly with the build command left empty, which is the most robust
configuration available: nothing sits between a push and a working site that
can fail. Every asset path is relative and the app makes no network requests
once loaded, so the repo root simply *is* the site.

The dev server exists only because ES modules cannot be loaded over `file://`.

### The three ways to run it

| | Size | Needs |
| --- | --- | --- |
| **The website** | 2.1 MB | Nothing. Installable from Edge or Chrome, and works offline once visited. |
| **`dist/ritual.html`** | 3.1 MB | Nothing at all — one file, double-click it. Works on any machine, including Macs. |
| **`Ritual.exe`** | 4.7 MB | Windows with WebView2 (shipped with Windows 11). |

The single file inlines everything as data URIs, so opening it makes exactly one
request: the file itself. That is also why it is the only artefact that needs a
bundler — modules are blocked over `file://`, so the 25 of them are flattened
into one classic script with esbuild. esbuild is a devDependency; the website
and the desktop build both ship the original source untouched.

The desktop build is the same web app in a WebView2 window, which is Chromium —
so it renders identically to the site. Rust's only job is to open the window; no
commands are registered and no capabilities are granted, because the app asks
the host for nothing. Build prerequisites are Rust, MSVC build tools, and
WebView2. It is unsigned, so Windows shows a SmartScreen prompt on first run.

### Regenerating

Two files are generated and committed, and want re-running when assets change:

```bash
npm run build:sw       # sw.js — the offline precache list and its version
npm run build:icons    # favicon → every PNG size, plus the Windows .ico
```

`sw.js` keys its cache to a hash of every file's contents, so a changed asset
means a new cache name and the old one is dropped. Forgetting to re-run it is
recoverable: `index.html` is fetched network-first precisely so a stale cache
can always correct itself.

---

## The idea

One number drives everything.

`IntensityEngine` watches how you write and publishes a single `0…1` value.
The lighting engine, the sky, the rain on the glass, the candle, the dust in
the air, the props on the desk, the handwriting itself and every voice in the
soundscape are all consumers of that one value. Nothing polls anything else.

That is why the app hangs together: the thunder you hear, the flash in the
window, the flicker on the wax, the wobble that creeps into your letters and
the density of the rain on the pane are not separate effects that happen to
fire at once. They are the same number, read six different ways.

---

## The intensity meter

Four influences, combined every frame.

### 1. The personal baseline — a flow-state detector

Two speeds are tracked at once: an **instant** rate over the last 5 seconds,
and your **session average** over the time you have actually been writing
(long pauses are excluded, so staring out of the window doesn't drag it down).

Absolute speed is irrelevant. 30 wpm and 90 wpm are treated identically. What
matters is breaking into a sprint *relative to yourself*. Being in the zone
contributes up to **+60%** on top of the floor.

Until it has watched you for a while it doesn't know your pace, so it blends
from a typical writer's speed toward the measured one over the first 30 seconds
of writing. Without that, an ordinary opening sentence reads as a colossal
sprint purely because the running average is still near zero.

### 2. The baseline floor — time and volume

As the entry grows in both minutes and characters, the *minimum* level of the
storm rises. Time maxes out at **3 minutes**, volume at **1,500 characters**
(~250–300 words). The floor moves from **5% to 40%**, so a long session never
returns to a completely quiet sky, however long you pause.

### 3. The cold-start clamp

For the first **20 seconds**, typing surges can only unlock a fraction of the
storm's power — 0% at 0s, 50% at 10s, 100% at 20s. Hammering out your first
sentence at speed cannot summon a hurricane.

### 4. Asymmetrical gliding

The storm swells quickly and decays slowly: roughly **2–3 seconds** of
sustained fast writing to reach full intensity, and **6–8 seconds** to settle
back to the floor when you stop. Pausing to think doesn't cut the sound; the
thunder rolls away and leaves you a steady rain to sit in.

These numbers are all in `INTENSITY_CONFIG` at the top of
[src/intensity.js](src/intensity.js), and the engine is pure — no DOM, no
audio — so its behaviour can be simulated offline.

### Presence — how long it has been raining

Intensity answers *how hard are you writing right now*. That is deliberately
not the same question as *how long has it been raining*, so there is a second,
much slower value: **presence**, which starts at zero and takes a couple of
minutes of writing to reach one.

A session therefore opens with a dry sky and no rain at all. After the first
words a single drop lands on the pane, then another — about one every four
seconds. The rain arrives over minutes, not seconds, and the storm can only
ever be as loud as the weather that has actually accumulated. Both the sound
and the rain you can see are gated by it.

### Punctuating moments

| Moment | What happens |
| --- | --- |
| **Second paragraph** | A distant roll of thunder, guaranteed |
| **Third paragraph** | A lightning strike, guaranteed |
| **Later paragraphs** | Rolled against current intensity — a quiet sky answers rarely and only with thunder; a raging one answers almost always, and with lightning |
| **Holding the seal** | The crescendo: a swell of about +0.20 above wherever you already are, over 2.4s, under a ceiling — clearly perceptible, but not a jump cut. One distant rumble as the sky gathers, and otherwise nothing |
| **Letting go** | One enormous strike directly overhead — the flash holds the room white and takes seconds to fade, with deep thunder right behind it. Then the release: the heavy weather is cut and the page goes to the candle |
| **After the burn** | Tranquility. The score resolves to one open sustained chord, the colour comes back into the room, and the closing lines arrive one at a time over about eight seconds |

Turn the meter on in the info sheet to watch all of it live on a brass
barometer, with the floor, surge, cold-start clamp and both rates broken out.

---

## The soundscape

Everything you hear is synthesised at runtime with the Web Audio API. **There
are no audio files in this repository.**

The governing idea for the weather is that **you are indoors**. You are not
standing in the rain; you are listening to it through a pane of glass and a
roof. Broadband hiss is what rain sounds like when it is falling on *you*, and
it swamps everything else — so there is none of it.

- **Rain** — a dark, quiet bed of rain on tiles and garden heard through a
  wall; a slightly less muffled layer that only arrives in heavy rain; and the
  thing that actually carries the character: discrete resonant *taps* of
  individual drops striking the pane, spread across the stereo field because
  the window is wide. Even at full storm the rate stays countable — a wall of
  ticks becomes hiss again.
- **Wind** — brown noise through a resonant band, with gusts built from
  incommensurate LFOs so the pattern never audibly repeats.
- **Thunder** — what makes synthesised thunder sound fake is a sharp
  transient: it reads as a click, or a door slamming. Real thunder heard from
  inside has almost no attack; it arrives, swells, and rolls while the sound
  comes back off everything between you and it. So there is no crack layer at
  all, the attack is slow even overhead, the filter stays under 500Hz, a second
  delayed rumble returns off the hills, and most of the signal goes to a long
  dark reverb. Measured: about 57% of its energy sits below 250Hz. Distance
  changes the filter, the length, the tail, and the delay before you hear it.
- **The score** — generative, in D aeolian, over an unresolved i–VI–III–iv
  progression. Layers accrete as the storm builds: a drone, then slow detuned
  pads, then struck bell tones, then high glassy shimmer, then a low pulse near
  the peak. Note density and register are driven by intensity, so the music
  speeds up when you speed up and thins out when you stop.
- **The instrument on the paper** — a short filtered noise burst per keystroke,
  shaped per instrument. A pencil rasps, a ballpoint ticks, a fountain pen lays
  down something wet and round, a quill scratches.

A master low-pass filter acts as a **distance** control: calm weather is heard
through a closed window, and as the storm builds the filter opens until the
weather is effectively in the room. Three things deliberately bypass it — the
pen, the fire, and the drops on the pane. All three are unambiguously in the
room with you, and muffling them when the sky is calmest would be exactly
backwards.

---

## The view outside

The landscape is drawn as four depth layers rather than one silhouette, and
each is recoloured every frame relative to the sky at the horizon. That matters
because distance at night is carried almost entirely by *contrast*: the far
ridge sits a shade lighter than the sky behind it (haze scatters light toward
you), and each nearer layer goes darker and sharper. A single black cutout
reads as a stage flat. Splitting it up is also what lets a strike rim the near
trees while the far ones merely glow.

Recolouring is four full-canvas operations per layer, so each layer caches its
tinted copy and only rebuilds when the colour would visibly differ — quantised
to four levels, which turns a continuous fade from four rebuilds a frame into a
handful in total.

The cottage across the field is drawn *lit* rather than cut out of a
silhouette. A hole in a silhouette gives you a bright rectangle floating in the
dark with no building around it; a wall you can see, with light spilling down it
from its own windows and a slate roof catching the sky, is what makes the
windows read as windows. Its openings are deliberately different sizes at
different heights — two matching lit rectangles side by side read unmistakably
as a pair of eyes.

The trees bend with the storm. The layers are cached bitmaps, so the bend is a
horizontal skew — full displacement at the top of the frame, none at the
bottom, pivoting the trunks about their roots. Drawing it as a stack of shifted
bands gives a truer curved flex and costs a draw call per band per layer per
frame; at this distance the difference is not visible and the cost is.

Three textures are generated at startup and handed to CSS as data URIs
([src/scene/textures.js](src/scene/textures.js)): a panel of cotton lace for
the curtains, soft grime for the glass, and film grain over everything. The
grain is dark noise blended with `screen`, not grey noise with `overlay` — on
a scene this dark, overlay reduces to `2 × base × blend` and moves the result
by about two levels out of 255, which is to say it does nothing. Dark noise
through screen adds `blend × (1 − base)`, so it bites in the shadows and fades
out in the highlights, which is also how real film grain behaves.

## The page

The writing surface is a controlled `contenteditable`: a JS string is the
single source of truth and the DOM is rebuilt from it. That is what makes
per-character handwriting possible — every glyph is its own inline-block with
its own rotation, offset, scale and ink density.

Two details do most of the work:

- **Deterministic jitter.** Each character's wobble comes from a hash of its
  index and the session seed, so it is stable. Re-render the same text and the
  same letters wobble the same way; nothing shimmers as you type.
- **Correlated drift.** Neighbouring characters share a slow noise, so words
  ride up and down *together*. Independent per-letter noise looks like a ransom
  note; correlated noise looks like a hand.

On top of that, the ink flow wanders as the nib runs wet and dry, pools where a
stroke begins after a lift, and — with the quill — runs out entirely and has to
be recharged. And the hand deteriorates as the storm rises: the jitter grows
with intensity, so writing fast in a tempest looks like writing fast in a
tempest.

Rendering is cached per line, so typing at the end of a long entry only rebuilds
the line being written.

## Choosing things

There are no menus. Every control is the object it controls:

| Object | What it is |
| --- | --- |
| The tray, bottom left | Five instruments. Click one and it lifts out. |
| The bottles | Six inks. The chosen one stands open, and clinks as it is set down — pitched down the row, so the six are audibly distinct. Graphite and charcoal carry their own colour, so the bottles dim. |
| The pile, far left | Four paper stocks, each as the object that paper comes out of — a bundle of loose sheets, a block of writing paper, a bound notebook, a ledger. |
| The specimen booklet | Twelve hands. Flip its pages. |
| The wax seal | Press and hold to finish. |
| The tab on the page corner | This document, the settings, and a plain text box. |

They are real buttons underneath, grouped as radio sets with arrow-key
navigation and proper labels — skeuomorphism shouldn't cost you the keyboard.

---

## Layout

```
index.html            the scene, and the SVG filters that tear the page's edges
server.mjs            a static file server

src/
  intensity.js        THE METER — pure, no DOM, no audio
  storm-events.js     when thunder and lightning are allowed to happen
  main.js             bootstrap, the frame loop, and the arc of the ritual

  core/               maths, seeded noise
  audio/
    core.js           context, master chain, procedural reverb and noise buffers
    weather.js        rain, wind, thunder
    music.js          the generative score
    writing.js        the pen on the paper, and the fire
  scene/
    textures.js       lace, film grain and grime, generated as data URIs
    lighting.js       candle + lightning + ambient -> CSS custom properties
    sky.js            what you see through the window, in four depth layers
    glass.js          rain running down the pane
    candle.js         soft-body flame physics
    props.js          books and the jar, shaded by their angle to the flame
    atmos.js          dust, embers, ash
    burn.js           the page burning
  write/
    hands.js          hands, instruments, inks, stocks
    paper.js          the writing surface
  ui/                 the desk objects, the seal, the panels, haptics

styles/               base, scene, paper, ui, and the self-hosted fonts
assets/               CC0 PBR textures and OFL fonts — see assets/CREDITS.md

tools/
  build-sw.mjs        generates sw.js (offline precache list + version)
  build-icons.mjs     favicon.svg -> every PNG size, and the Windows .ico
  build-single.mjs    the one-file build
  build-dist.mjs      the clean tree the desktop build bundles

src-tauri/            the desktop shell: a window, and nothing else
_headers              Cloudflare Pages caching and security headers
sw.js                 GENERATED — do not edit
```

---

## Accessibility and comfort

- **Plain text box.** Behind the tab on the page corner, kept in two-way sync.
  If the handwriting is hard to read, or you would rather just type, write
  there instead.
- **Calm the storm.** Stops the screen shake and the haptics, and is on by
  default if the OS asks for reduced motion. The weather still runs.
- **Volume**, and a mute that fades rather than cuts.
- Every object is focusable, labelled, and reachable with arrow keys.
- The focus ring is suppressed on the writing surface only — a 2px ring around
  the whole sheet destroys the scene, and a text caret is already an
  unambiguous focus indicator. Every other control keeps it.
- Audio only starts on the opening gesture, as browsers require.

## Notes

- No build step, no dependencies, no network calls at runtime.
- Fonts and textures are bundled, so it works offline.
- **Ctrl+Alt+D** opens the debug overlay (or add `?debug` to the URL). It
  tracks intensity and presence on a rolling graph, prints every number the
  scene is reading, and gives you a slider for each of the two values that
  drive the whole world — so you can pin the storm at 0, at 1, or sweep it
  through the range and watch each subsystem respond, instead of writing for
  three minutes to see what happens. It also fires thunder and lightning on
  demand and switches hand, pen, ink and paper. Nothing is built until you
  open it.

  Ctrl+Alt+D rather than Ctrl+Shift+D because the latter is "bookmark all
  tabs" in Chrome and Edge, and a page cannot preventDefault a browser-level
  shortcut.
- `window.ritual` is exposed for poking at in the console. Setting
  `ritual.debugIntensity = 0.8` pins the storm at a chosen level;
  `ritual.debugIntensity = null` hands control back to the meter.
  `ritual.debugPresence` does the same for the slower one.
