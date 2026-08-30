/**
 * The hands you can write in, the instruments you write with, the inks, and
 * the stock you write on.
 *
 * A "hand" is more than a font: it carries its own natural size, slant, line
 * spacing and how unruly it gets, so switching hands changes the character of
 * the writing rather than just its shape.
 */

/* ─────────────────────────────────────────────────────────── HANDS ──────── */

export const HANDS = [
  {
    id: 'copperplate',
    name: 'Copperplate',
    note: 'a careful, formal hand',
    family: "'Mrs Saint Delafield', 'Dancing Script', cursive",
    size: 1.42, line: 1.42, slant: -1.2, weight: 400,
    jitter: 0.55, drift: 0.7, tracking: 0.004,
  },
  {
    id: 'flowing',
    name: 'Flowing',
    note: 'looping and quick',
    family: "'Dancing Script', cursive",
    size: 1.10, line: 1.62, slant: -0.4, weight: 500,
    jitter: 0.8, drift: 0.9, tracking: 0,
  },
  {
    id: 'letter',
    name: 'Old Letter',
    note: 'the hand of someone who writes often',
    family: "'Homemade Apple', cursive",
    size: 0.88, line: 2.0, slant: 0, weight: 400,
    jitter: 0.7, drift: 1.0, tracking: -0.004,
  },
  {
    id: 'delicate',
    name: 'Delicate',
    note: 'thin, and a little uncertain',
    family: "'Cedarville Cursive', cursive",
    size: 1.0, line: 1.86, slant: -0.8, weight: 400,
    jitter: 1.0, drift: 1.1, tracking: 0,
  },
  {
    id: 'hurried',
    name: 'Hurried',
    note: 'written faster than it should have been',
    family: "'La Belle Aurore', cursive",
    size: 0.98, line: 1.78, slant: -2.2, weight: 400,
    jitter: 1.3, drift: 1.3, tracking: -0.006,
  },
  {
    id: 'open',
    name: 'Open',
    note: 'round and unhurried',
    family: "'Caveat', cursive",
    size: 1.28, line: 1.44, slant: 0.4, weight: 500,
    jitter: 0.9, drift: 0.9, tracking: 0.002,
  },
  {
    id: 'pencilled',
    name: 'Pencilled',
    note: 'soft, grey, half-erased',
    family: "'Reenie Beanie', cursive",
    size: 1.22, line: 1.48, slant: -1.4, weight: 400,
    jitter: 1.15, drift: 1.2, tracking: 0.006,
  },
  {
    id: 'drafting',
    name: 'Drafting',
    note: 'printed, not joined',
    family: "'Architects Daughter', cursive",
    size: 0.94, line: 1.72, slant: 0, weight: 400,
    jitter: 0.75, drift: 0.8, tracking: 0.004,
  },
  {
    id: 'formal',
    name: 'Formal Script',
    note: 'upright and deliberate',
    family: "'Petit Formal Script', cursive",
    size: 1.02, line: 1.7, slant: 0, weight: 400,
    jitter: 0.5, drift: 0.6, tracking: 0.002,
  },
  {
    id: 'roundhand',
    name: 'Roundhand',
    note: 'a schoolroom hand',
    family: "'Kalam', cursive",
    size: 0.98, line: 1.66, slant: -0.6, weight: 300,
    jitter: 0.85, drift: 0.95, tracking: 0,
  },
  {
    id: 'ribbon',
    name: 'Ribbon',
    note: 'long tails, thin strokes',
    family: "'Rouge Script', cursive",
    size: 1.34, line: 1.5, slant: -1.6, weight: 400,
    jitter: 0.7, drift: 0.85, tracking: 0.004,
  },
  {
    id: 'scrawl',
    name: 'Scrawl',
    note: 'barely legible, entirely honest',
    family: "'Just Another Hand', cursive",
    size: 1.5, line: 1.28, slant: -2.8, weight: 400,
    jitter: 1.4, drift: 1.4, tracking: 0.01,
  },
];

/* ───────────────────────────────────────────────────── INSTRUMENTS ──────── */

/**
 * `flow` shapes how the ink is laid down:
 *   base      the resting darkness of a stroke
 *   variance  how much it wanders as the nib runs wet and dry
 *   pooling   extra darkness where a stroke begins after a pause
 *   bleed     how far the ink creeps into the paper fibres
 */
export const INSTRUMENTS = [
  {
    id: 'pencil',
    name: 'Pencil',
    note: 'graphite, soft and grey',
    voice: 'pencil',
    weightMul: 1.0,
    forcesInk: '#3a3a3c',        // graphite ignores the ink bottle
    flow: { base: 0.72, variance: 0.24, pooling: 0.04, bleed: 0.15 },
    grain: 0.55,                 // visible tooth of the paper
  },
  {
    id: 'ballpoint',
    name: 'Ballpoint',
    note: 'reliable, a little mean',
    voice: 'ballpoint',
    weightMul: 0.92,
    flow: { base: 0.88, variance: 0.10, pooling: 0.10, bleed: 0.05 },
    grain: 0.12,
  },
  {
    id: 'fountain',
    name: 'Fountain Pen',
    note: 'wet, and it knows it',
    voice: 'fountain',
    weightMul: 1.12,
    flow: { base: 0.95, variance: 0.20, pooling: 0.34, bleed: 0.55 },
    grain: 0.06,
  },
  {
    id: 'quill',
    name: 'Quill',
    note: 'scratches, blots, needs dipping',
    voice: 'quill',
    weightMul: 1.2,
    flow: { base: 0.9, variance: 0.42, pooling: 0.5, bleed: 0.7 },
    grain: 0.22,
    dips: true,                  // runs dry and must be recharged
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    note: 'broad, black, smudges',
    voice: 'charcoal',
    weightMul: 1.35,
    forcesInk: '#211f1f',
    flow: { base: 0.8, variance: 0.3, pooling: 0.06, bleed: 0.4 },
    grain: 0.85,
  },
];

/* ─────────────────────────────────────────────────────────── INKS ───────── */

export const INKS = [
  { id: 'iron-gall', name: 'Iron Gall', hex: '#2b2118', glass: '#3d3226' },
  { id: 'midnight', name: 'Midnight', hex: '#161d33', glass: '#28304a' },
  { id: 'oxblood', name: 'Oxblood', hex: '#4a1720', glass: '#5d2430' },
  { id: 'sepia', name: 'Sepia', hex: '#54341a', glass: '#6a4626' },
  { id: 'verdigris', name: 'Verdigris', hex: '#1c3a34', glass: '#2b5049' },
  { id: 'violet', name: 'Violet', hex: '#32204a', glass: '#443063' },
];

/* ─────────────────────────────────────────────────────────── STOCK ──────── */

export const STOCKS = [
  {
    id: 'parchment',
    name: 'Parchment',
    note: 'old, and it has been folded',
    texture: 'assets/textures/parchment.jpg',
    crease: 'assets/textures/crease-heavy.jpg',
    tint: '#e3d2ac',
    ruled: false,
    deckle: 1.0,
    grain: 0.9,
    ageing: 0.85,
  },
  {
    id: 'letter',
    name: 'Letter Paper',
    note: 'plain, cream, unlined',
    texture: 'assets/textures/paper-creased.jpg',
    crease: 'assets/textures/crease.jpg',
    tint: '#ece3cf',
    ruled: false,
    deckle: 0.45,
    grain: 0.5,
    ageing: 0.3,
  },
  {
    id: 'notebook',
    name: 'Notebook',
    note: 'ruled, with a margin',
    texture: 'assets/textures/paper-creased.jpg',
    crease: 'assets/textures/crease.jpg',
    tint: '#eee9dc',
    ruled: true,
    margin: true,
    deckle: 0,
    grain: 0.35,
    ageing: 0.12,
  },
  {
    id: 'ledger',
    name: 'Ledger',
    note: 'squared, for accounts and confessions',
    texture: 'assets/textures/paper-creased.jpg',
    crease: 'assets/textures/crease.jpg',
    tint: '#e9e4d3',
    ruled: 'grid',
    deckle: 0,
    grain: 0.4,
    ageing: 0.2,
  },
];

export const byId = (list, id) => list.find((x) => x.id === id) || list[0];
