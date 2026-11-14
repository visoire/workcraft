/**
 * WorkCraft · Blip Mascot Kit (blip.js)
 * Zero-dependency HTML/CSS/SVG + Terminal ANSI mascot component for WorkCraft & WorkCraft Chat.
 */

export const BLIP_PALETTES = {
  blue: {
    body: '#2C84FC',
    top: '#2C84FC',
    shade: '#1E64D0',
    foot: '#164DA8',
    ink: '#081C38',
    shine: '#FFFFFF',
    tip: '#FFBF35',
    blush: '#FE947F',
    alert: '#FF6458',
  },
  indigo: {
    body: '#335CFF',
    top: '#4B70FF',
    shade: '#2447D9',
    foot: '#1934A8',
    ink: '#0A1438',
    shine: '#FFFFFF',
    tip: '#FFBF35',
    blush: '#FF9488',
    alert: '#FF5C5C',
  },
  ice: {
    body: '#2C84FC',
    top: '#4799FF',
    shade: '#1E64D0',
    foot: '#164DA8',
    ink: '#081C38',
    shine: '#FFFFFF',
    tip: '#67E8F9',
    blush: '#93C5FD',
    alert: '#38BDF8',
  },
  teal: {
    body: '#21CEB2',
    top: '#1FCCAF',
    shade: '#0E9A82',
    foot: '#088573',
    ink: '#042B2C',
    shine: '#FFFFFF',
    tip: '#FFBF35',
    blush: '#FE947F',
    alert: '#FF6458',
  },
  amber: {
    body: '#F59E0B',
    top: '#FBBF24',
    shade: '#D97706',
    foot: '#B45309',
    ink: '#291502',
    shine: '#FFFFFF',
    tip: '#38BDF8',
    blush: '#FDA4AF',
    alert: '#EF4444',
  },
  coral: {
    body: '#F43F5E',
    top: '#FB7185',
    shade: '#E11D48',
    foot: '#BE123C',
    ink: '#2A0610',
    shine: '#FFFFFF',
    tip: '#FFBF35',
    blush: '#FBCFE8',
    alert: '#FBBF24',
  },
  emerald: {
    body: '#10B981',
    top: '#34D399',
    shade: '#059669',
    foot: '#047857',
    ink: '#04261C',
    shine: '#FFFFFF',
    tip: '#FFBF35',
    blush: '#FE947F',
    alert: '#FF6458',
  },
  mono: {
    body: '#4B5563',
    top: '#6B7280',
    shade: '#374151',
    foot: '#1F2937',
    ink: '#090D16',
    shine: '#FFFFFF',
    tip: '#E5E7EB',
    blush: '#9CA3AF',
    alert: '#F87171',
  },
};

/**
 * Canonical 18×15 pixel grid of Blip (idle pose).
 * Legend:
 *   . = transparent
 *   T = antenna tip (--blip-tip)
 *   S = medium shade (--blip-shade: antenna stems + belly bevel)
 *   H = top head bevel (--blip-top)
 *   B = primary body & arms (--blip-body)
 *   W = eye white highlight (--blip-shine)
 *   K = dark eye & mouth ink (--blip-ink)
 *   P = pink/coral cheek blush (--blip-blush)
 *   F = dark feet (--blip-foot)
 */
export const BLIP_GRID = [
  '....T.............',
  '....S........T....',
  '....S........S....',
  '...HHHHHHHHHHHH...',
  '..BBBBBBBBBBBBBB..',
  '..BBBBBBBBBBBBBB..',
  '..BBBWKBBBBWKBBB..',
  '..BBBKKBBBBKKBBB..',
  'BBBBBKKBBBBKKBBBBB',
  'BBBPPBBKBBKBBPPBBB',
  '..BBBBBBKKBBBBBB..',
  '..BBBBBBBBBBBBBB..',
  '...SSSSSSSSSSSS...',
  '....FFF....FFF....',
  '....FFF....FFF....',
];

/**
 * Generates a tight 18×15 SVG icon of Blip (ideal for favicons, avatars, buttons, and badges).
 */
export function blipIconSvg(options = {}) {
  const {
    size = 32,
    theme = 'blue',
    animated = false,
    className = 'blip-icon-svg',
    label = 'Blip',
  } = options;
  const p = BLIP_PALETTES[theme] || BLIP_PALETTES.blue;
  const animStyle = animated
    ? `<style>
      @keyframes bi-blink { 0%,45%,49%,100%{opacity:1} 46%,48%{opacity:0} }
      @keyframes bi-line  { 0%,45%,49%,100%{opacity:0} 46%,48%{opacity:1} }
      @keyframes bi-bob   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-0.35px)} }
      .bi-body { animation: bi-bob 3.2s steps(2,end) infinite; }
      .bi-open { animation: bi-blink 6s steps(1,end) infinite; }
      .bi-shut { opacity:0; animation: bi-line 6s steps(1,end) infinite; }
    </style>`
    : '';
  const w = Math.round(size * (18 / 15));
  const h = size;
  return `<svg class="${className}" width="${w}" height="${h}" viewBox="0 0 18 15" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="${label}">
  ${animStyle}
  <g class="bi-body">
    <rect x="4" y="0" width="1" height="1" fill="${p.tip}"/>
    <rect x="4" y="1" width="1" height="2" fill="${p.shade}"/>
    <rect x="13" y="1" width="1" height="1" fill="${p.tip}"/>
    <rect x="13" y="2" width="1" height="1" fill="${p.shade}"/>
    <rect x="3" y="3" width="12" height="1" fill="${p.top}"/>
    <rect x="2" y="4" width="14" height="8" fill="${p.body}"/>
    <rect x="0" y="8" width="2" height="2" fill="${p.body}"/>
    <rect x="16" y="8" width="2" height="2" fill="${p.body}"/>
    <rect x="3" y="9" width="2" height="1" fill="${p.blush}"/>
    <rect x="13" y="9" width="2" height="1" fill="${p.blush}"/>
    <g class="bi-open">
      <rect x="5" y="6" width="2" height="3" fill="${p.ink}"/>
      <rect x="5" y="6" width="1" height="1" fill="${p.shine}"/>
      <rect x="11" y="6" width="2" height="3" fill="${p.ink}"/>
      <rect x="11" y="6" width="1" height="1" fill="${p.shine}"/>
    </g>
    ${
      animated
        ? `<g class="bi-shut">
      <rect x="5" y="8" width="2" height="1" fill="${p.ink}"/>
      <rect x="11" y="8" width="2" height="1" fill="${p.ink}"/>
    </g>`
        : ''
    }
    <rect x="7" y="9" width="1" height="1" fill="${p.ink}"/>
    <rect x="8" y="10" width="2" height="1" fill="${p.ink}"/>
    <rect x="10" y="9" width="1" height="1" fill="${p.ink}"/>
    <rect x="3" y="12" width="12" height="1" fill="${p.shade}"/>
    <rect x="4" y="13" width="3" height="2" fill="${p.foot}"/>
    <rect x="11" y="13" width="3" height="2" fill="${p.foot}"/>
  </g>
</svg>`;
}

/**
 * Generates the full rigged SVG markup for the interactive/animated Blip mascot.
 * Pair with blip.css (or pass inlineStyles: true for a self-contained SVG).
 */
export function blipSvg(options = {}) {
  const {
    theme = 'blue',
    className = 'blip-svg',
    label = 'Blip mascot',
  } = options;
  const p = BLIP_PALETTES[theme] || BLIP_PALETTES.blue;

  // Deterministic loose pixel cloud for the 'spawn' animation
  const spawnPieces = [
    [-2, -2, 'var(--blip-body, ' + p.body + ')'],
    [2, -3, 'var(--blip-tip, ' + p.tip + ')'],
    [6, -3.5, 'var(--blip-body, ' + p.body + ')'],
    [11, -3, 'var(--blip-body, ' + p.body + ')'],
    [15, -2, 'var(--blip-tip, ' + p.tip + ')'],
    [19, -1, 'var(--blip-body, ' + p.body + ')'],
    [-3, 2, 'var(--blip-body, ' + p.body + ')'],
    [0, 1, 'var(--blip-top, ' + p.top + ')'],
    [4, 0.5, 'var(--blip-body, ' + p.body + ')'],
    [8.5, 0, 'var(--blip-ink, ' + p.ink + ')'],
    [13, 0.5, 'var(--blip-body, ' + p.body + ')'],
    [17, 1.5, 'var(--blip-top, ' + p.top + ')'],
    [20, 3, 'var(--blip-body, ' + p.body + ')'],
    [-2.5, 6, 'var(--blip-body, ' + p.body + ')'],
    [1, 5, 'var(--blip-blush, ' + p.blush + ')'],
    [5, 4, 'var(--blip-ink, ' + p.ink + ')'],
    [9, 4.5, 'var(--blip-body, ' + p.body + ')'],
    [12.5, 4, 'var(--blip-ink, ' + p.ink + ')'],
    [16, 5, 'var(--blip-blush, ' + p.blush + ')'],
    [19.5, 6.5, 'var(--blip-body, ' + p.body + ')'],
    [0, 9.5, 'var(--blip-shade, ' + p.shade + ')'],
    [4, 10.5, 'var(--blip-foot, ' + p.foot + ')'],
    [8.5, 10, 'var(--blip-shade, ' + p.shade + ')'],
    [13, 10.5, 'var(--blip-foot, ' + p.foot + ')'],
    [17, 9.5, 'var(--blip-shade, ' + p.shade + ')'],
  ]
    .map(
      ([x, y, fill], idx) =>
        `<rect x="${x}" y="${y}" width="1.15" height="1.15" fill="${fill}" transform="rotate(${(idx * 23) % 45} ${x + 0.5} ${y + 0.5})"/>`
    )
    .join('');

  return `<svg class="${className}" viewBox="-5 -4 28 21" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="${label}">
  <!-- Ground shadow -->
  <ellipse class="blip-ground-shadow" cx="9" cy="15.4" rx="6.2" ry="0.55" fill="var(--blip-shadow, rgba(8, 28, 56, 0.14))"/>

  <!-- Loose pixel cloud for spawn state -->
  <g class="blip-spawn-cloud">${spawnPieces}</g>

  <!-- Main rig (translates horizontally for walk) -->
  <g class="blip-rig">
    <!-- Actor (bobs, hops, spins, tilts) -->
    <g class="blip-actor">
      <!-- Left Antenna -->
      <g class="blip-antenna-l">
        <rect class="blip-tip-l" x="4" y="0" width="1" height="1" fill="var(--blip-tip, ${p.tip})"/>
        <rect x="4" y="1" width="1" height="2" fill="var(--blip-shade, ${p.shade})"/>
      </g>

      <!-- Right Antenna -->
      <g class="blip-antenna-r">
        <rect class="blip-tip-r" x="13" y="1" width="1" height="1" fill="var(--blip-tip, ${p.tip})"/>
        <rect x="13" y="2" width="1" height="1" fill="var(--blip-shade, ${p.shade})"/>
      </g>

      <!-- Left & Right Arms -->
      <rect class="blip-arm-l" x="0" y="8" width="2" height="2" fill="var(--blip-body, ${p.body})"/>
      <rect class="blip-arm-r" x="16" y="8" width="2" height="2" fill="var(--blip-body, ${p.body})"/>

      <!-- Head & Torso -->
      <g class="blip-head-group">
        <rect x="3" y="3" width="12" height="1" fill="var(--blip-top, ${p.top})"/>
        <rect x="2" y="4" width="14" height="8" fill="var(--blip-body, ${p.body})"/>
        <rect x="3" y="12" width="12" height="1" fill="var(--blip-shade, ${p.shade})"/>
      </g>

      <!-- Back Dorsal Stripe (shown mid-spin when facing away) -->
      <g class="blip-back-stripe">
        <rect x="8" y="5" width="2" height="6" fill="var(--blip-shade, ${p.shade})"/>
      </g>

      <!-- FACE 1: Normal / Idle / Glance -->
      <g class="blip-face blip-face--normal">
        <rect x="3" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="13" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <g class="blip-eyes blip-eyes-normal">
          <rect x="5" y="6" width="2" height="3" fill="var(--blip-ink, ${p.ink})"/>
          <rect class="blip-shine-l" x="5" y="6" width="1" height="1" fill="var(--blip-shine, ${p.shine})"/>
          <rect x="11" y="6" width="2" height="3" fill="var(--blip-ink, ${p.ink})"/>
          <rect class="blip-shine-r" x="11" y="6" width="1" height="1" fill="var(--blip-shine, ${p.shine})"/>
        </g>
        <g class="blip-mouth-smile">
          <rect x="7" y="9" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
          <rect x="8" y="10" width="2" height="1" fill="var(--blip-ink, ${p.ink})"/>
          <rect x="10" y="9" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        </g>
      </g>

      <!-- All face geometry sits on whole pixels of the 18x15 grid (fractions snap unpredictably under
           crispEdges and made blinks and small eyes flicker or vanish at small sizes). -->
      <!-- FACE 2: Blink -->
      <g class="blip-face blip-face--blink">
        <rect x="3" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="13" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="5" y="8" width="2" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="11" y="8" width="2" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="7" y="9" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="8" y="10" width="2" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="10" y="9" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
      </g>

      <!-- FACE 3: Squint / Focused (Walk pause, Working and Coding) -->
      <g class="blip-face blip-face--squint">
        <rect x="3" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="13" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="5" y="7" width="2" height="2" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="5" y="7" width="1" height="1" fill="var(--blip-shine, ${p.shine})"/>
        <rect x="11" y="7" width="2" height="2" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="11" y="7" width="1" height="1" fill="var(--blip-shine, ${p.shine})"/>
        <rect x="7" y="9" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="8" y="10" width="2" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="10" y="9" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
      </g>

      <!-- FACE 4: Shock (Startled freeze, Error) -->
      <g class="blip-face blip-face--shock">
        <rect x="3" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="13" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="4" y="5" width="3" height="4" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="5" y="6" width="1" height="2" fill="var(--blip-shine, ${p.shine})"/>
        <rect x="11" y="5" width="3" height="4" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="12" y="6" width="1" height="2" fill="var(--blip-shine, ${p.shine})"/>
        <rect x="8" y="9" width="2" height="2" fill="var(--blip-ink, ${p.ink})"/>
      </g>

      <!-- FACE 5: Dizzy (Startled stumble, Error) -->
      <g class="blip-face blip-face--dizzy">
        <rect x="3" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="13" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <g class="blip-eye-dizzy-l">
          <rect x="4" y="6" width="3" height="3" fill="var(--blip-ink, ${p.ink})"/>
          <rect x="5" y="6" width="1" height="3" fill="var(--blip-shine, ${p.shine})"/>
          <rect x="4" y="7" width="3" height="1" fill="var(--blip-shine, ${p.shine})"/>
          <rect x="5" y="7" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        </g>
        <g class="blip-eye-dizzy-r">
          <rect x="11" y="6" width="3" height="3" fill="var(--blip-ink, ${p.ink})"/>
          <rect x="12" y="6" width="1" height="3" fill="var(--blip-shine, ${p.shine})"/>
          <rect x="11" y="7" width="3" height="1" fill="var(--blip-shine, ${p.shine})"/>
          <rect x="12" y="7" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        </g>
        <rect x="7" y="10" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="8" y="9" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="9" y="10" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="10" y="9" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
      </g>

      <!-- FACE 6: Happy '^ ^' eyes and an open mouth with a tongue -->
      <g class="blip-face blip-face--happy">
        <rect x="3" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="13" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="5" y="8" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="6" y="7" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="7" y="8" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="10" y="8" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="11" y="7" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="12" y="8" width="1" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="7" y="9" width="4" height="2" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="8" y="10" width="2" height="1" fill="var(--blip-alert, ${p.alert})"/>
      </g>

      <!-- FACE 7: Sleep -->
      <g class="blip-face blip-face--sleep">
        <rect x="3" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="13" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="5" y="8" width="2" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="11" y="8" width="2" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="8" y="10" width="2" height="1" fill="var(--blip-ink, ${p.ink})"/>
      </g>

      <!-- FACE 8: Listening: wide open eyes and a small round mouth, ears up -->
      <g class="blip-face blip-face--listen">
        <rect x="3" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="13" y="9" width="2" height="1" fill="var(--blip-blush, ${p.blush})"/>
        <rect x="5" y="5" width="2" height="4" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="5" y="5" width="1" height="1" fill="var(--blip-shine, ${p.shine})"/>
        <rect x="11" y="5" width="2" height="4" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="11" y="5" width="1" height="1" fill="var(--blip-shine, ${p.shine})"/>
        <rect x="8" y="10" width="2" height="1" fill="var(--blip-ink, ${p.ink})"/>
      </g>

      <!-- Feet -->
      <rect class="blip-foot-l" x="4" y="13" width="3" height="2" fill="var(--blip-foot, ${p.foot})"/>
      <rect class="blip-foot-r" x="11" y="13" width="3" height="2" fill="var(--blip-foot, ${p.foot})"/>

      <!-- OPTIONAL ACCESSORIES (also on whole pixels) -->
      <!-- 1. Pixel Glasses -->
      <g class="blip-acc blip-acc--glasses">
        <rect x="4" y="5" width="4" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="4" y="9" width="4" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="4" y="5" width="1" height="5" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="7" y="5" width="1" height="5" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="8" y="6" width="2" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="10" y="5" width="4" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="10" y="9" width="4" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="10" y="5" width="1" height="5" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="13" y="5" width="1" height="5" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="2" y="6" width="2" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="14" y="6" width="2" height="1" fill="var(--blip-ink, ${p.ink})"/>
      </g>
      <!-- 2. Agent Headset (also worn while Blip listens) -->
      <g class="blip-acc blip-acc--headset">
        <rect x="2" y="2" width="14" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="1" y="6" width="2" height="4" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="15" y="6" width="2" height="4" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="3" y="10" width="3" height="1" fill="var(--blip-ink, ${p.ink})"/>
        <rect x="5" y="10" width="1" height="1" fill="var(--blip-tip, ${p.tip})"/>
      </g>
      <!-- 3. Leader Crown -->
      <g class="blip-acc blip-acc--crown">
        <rect x="5" y="2" width="8" height="1" fill="var(--blip-tip, ${p.tip})"/>
        <rect x="5" y="1" width="1" height="1" fill="var(--blip-tip, ${p.tip})"/>
        <rect x="8" y="0" width="2" height="2" fill="var(--blip-tip, ${p.tip})"/>
        <rect x="12" y="1" width="1" height="1" fill="var(--blip-tip, ${p.tip})"/>
        <rect x="8" y="2" width="2" height="1" fill="var(--blip-alert, ${p.alert})"/>
      </g>
      <!-- 4. Coffee Mug -->
      <g class="blip-acc blip-acc--coffee">
        <rect x="17" y="8" width="2" height="3" fill="#FFFFFF"/>
        <rect x="19" y="8" width="1" height="2" fill="#FFFFFF"/>
        <rect x="17" y="8" width="2" height="1" fill="#6F4E37"/>
        <rect x="17" y="6" width="1" height="1" fill="var(--blip-shine, #FFFFFF)" opacity="0.75"/>
        <rect x="18" y="5" width="1" height="1" fill="var(--blip-shine, #FFFFFF)" opacity="0.75"/>
      </g>
      <!-- 5. Builder Hardhat -->
      <g class="blip-acc blip-acc--hardhat">
        <rect x="3" y="2" width="12" height="1" fill="var(--blip-tip, ${p.tip})"/>
        <rect x="4" y="1" width="10" height="1" fill="var(--blip-tip, ${p.tip})"/>
        <rect x="2" y="3" width="14" height="1" fill="#E59A0C"/>
      </g>

      <!-- Exclamation Mark '!' (Startled / Error) -->
      <g class="blip-alert-mark">
        <rect x="8" y="-3" width="2" height="2" fill="var(--blip-alert, ${p.alert})"/>
        <rect x="8" y="0" width="2" height="1" fill="var(--blip-alert, ${p.alert})"/>
      </g>

      <!-- Spawn Antenna Sparks ('Ta-da!') -->
      <g class="blip-spawn-sparks">
        <rect x="3" y="-2" width="1" height="1" fill="var(--blip-tip, ${p.tip})"/>
        <rect x="5" y="-2" width="1" height="1" fill="var(--blip-alert, ${p.alert})"/>
        <rect x="12" y="-1" width="1" height="1" fill="var(--blip-alert, ${p.alert})"/>
        <rect x="14" y="-2" width="1" height="1" fill="var(--blip-tip, ${p.tip})"/>
      </g>
    </g>

    <!-- Happy '+' Sparkles -->
    <g class="blip-sparkles">
      <rect x="-4" y="5" width="3" height="1" fill="var(--blip-tip, ${p.tip})"/>
      <rect x="-3" y="4" width="1" height="3" fill="var(--blip-tip, ${p.tip})"/>
      <rect x="-4" y="10" width="3" height="1" fill="var(--blip-alert, ${p.alert})"/>
      <rect x="-3" y="9" width="1" height="3" fill="var(--blip-alert, ${p.alert})"/>
      <rect x="20" y="4" width="3" height="1" fill="var(--blip-alert, ${p.alert})"/>
      <rect x="21" y="3" width="1" height="3" fill="var(--blip-alert, ${p.alert})"/>
      <rect x="20" y="10" width="3" height="1" fill="var(--blip-tip, ${p.tip})"/>
      <rect x="21" y="9" width="1" height="3" fill="var(--blip-tip, ${p.tip})"/>
    </g>

    <!-- Thinking Dots (Thinking / Loading state) -->
    <g class="blip-thought-dots">
      <rect class="blip-dot-1" x="6" y="-2" width="1" height="1" fill="var(--blip-body, ${p.body})"/>
      <rect class="blip-dot-2" x="8" y="-2" width="1" height="1" fill="var(--blip-tip, ${p.tip})"/>
      <rect class="blip-dot-3" x="10" y="-2" width="1" height="1" fill="var(--blip-body, ${p.body})"/>
    </g>

    <!-- Coding Sparks (Coding / Working state) -->
    <g class="blip-code-sparks">
      <rect x="-2" y="6" width="1" height="1" fill="var(--blip-tip, ${p.tip})"/>
      <rect x="19" y="6" width="1" height="1" fill="var(--blip-body, ${p.body})"/>
      <rect x="8" y="-2" width="1" height="1" fill="var(--blip-tip, ${p.tip})"/>
    </g>

    <!-- Listening sound waves: two arcs on each side that pulse outwards -->
    <g class="blip-listen-waves">
      <rect class="blip-wave-1" x="20" y="7" width="1" height="3" fill="var(--blip-tip, ${p.tip})"/>
      <rect class="blip-wave-2" x="22" y="6" width="1" height="5" fill="var(--blip-tip, ${p.tip})"/>
      <rect class="blip-wave-1" x="-3" y="7" width="1" height="3" fill="var(--blip-tip, ${p.tip})"/>
      <rect class="blip-wave-2" x="-5" y="6" width="1" height="5" fill="var(--blip-tip, ${p.tip})"/>
    </g>



    <!-- Sleep 'Z's -->
    <g class="blip-sleep-z">
      <path d="M15.5 -0.5 h2 v0.5 l-1.2 1 h1.2 v0.5 h-2 v-0.5 l1.2 -1 h-1.2 z" fill="var(--blip-body, ${p.body})"/>
      <path d="M18.2 -2.5 h1.5 v0.4 l-0.9 0.8 h0.9 v0.4 h-1.5 v-0.4 l0.9 -0.8 h-0.9 z" fill="var(--blip-tip, ${p.tip})"/>
    </g>
  </g>
</svg>`;
}

/** The drawing is 28 units wide (the viewBox). Snap a size to a whole number of device pixels per unit. */
export function snapBlipSize(size, dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) {
  const perUnit = Math.max(1, Math.round((size / 28) * dpr)) / dpr;
  return Math.round(perUnit * 28 * 100) / 100;
}

/**
 * Creates a live DOM element `<div class="blip">` with controller methods:
 *   .setState(state)
 *   .trigger(state, durationMs)
 *   .setTheme(theme)
 *   .setAccessory(accessory)
 *   .say(text, durationMs)
 */
export function createBlip(options = {}) {
  const {
    state = 'idle',
    theme = 'blue',
    size = 72,
    accessory = '',
    interactive = true,
    label = 'Blip',
  } = options;

  const el = document.createElement('div');
  el.className = `blip${interactive ? ' blip--interactive' : ''}`;
  el.dataset.state = state;
  el.dataset.theme = theme;
  if (accessory) el.dataset.accessory = accessory;
  // A pixel of Blip is a whole number of screen pixels: at 1.07 px per pixel (30 px wide) rows came out one or two
  // device pixels tall and the eyes looked lopsided. 28 css px = one pixel per unit, 56 = two, 84 = three.
  el.style.setProperty('--blip-size', typeof size === 'number' ? `${snapBlipSize(size)}px` : String(size));
  el.innerHTML = blipSvg({ theme, label }) + '<div class="blip-bubble" role="status" aria-live="polite"></div>';

  const bubble = el.querySelector('.blip-bubble');
  let triggerTimer = null;
  let bubbleTimer = null;
  let baseState = state;

  const api = {
    el,
    getState() {
      return el.dataset.state || 'idle';
    },
    setState(nextState) {
      if (triggerTimer) {
        clearTimeout(triggerTimer);
        triggerTimer = null;
      }
      baseState = nextState;
      el.dataset.state = nextState;
      return api;
    },
    trigger(tempState, durationMs = 2400) {
      if (triggerTimer) clearTimeout(triggerTimer);
      el.dataset.state = tempState;
      triggerTimer = setTimeout(() => {
        el.dataset.state = baseState;
        triggerTimer = null;
      }, durationMs);
      return api;
    },
    setTheme(nextTheme) {
      el.dataset.theme = nextTheme;
      return api;
    },
    setAccessory(nextAcc) {
      if (!nextAcc) delete el.dataset.accessory;
      else el.dataset.accessory = nextAcc;
      return api;
    },
    say(text, durationMs = 2800) {
      if (!bubble) return api;
      if (bubbleTimer) clearTimeout(bubbleTimer);
      if (!text) {
        bubble.classList.remove('is-visible');
        return api;
      }
      bubble.textContent = text;
      bubble.classList.add('is-visible');
      if (durationMs > 0) {
        bubbleTimer = setTimeout(() => {
          bubble.classList.remove('is-visible');
          bubbleTimer = null;
        }, durationMs);
      }
      return api;
    },
  };

  if (interactive) {
    const reactions = ['happy', 'startled', 'wave'];
    let rIdx = 0;
    el.addEventListener('click', () => {
      const pick = reactions[rIdx % reactions.length];
      rIdx++;
      api.trigger(pick, pick === 'startled' ? 3000 : 2200);
    });
  }

  return api;
}

/**
 * Renders Blip as a compact terminal string using Unicode half-blocks (▀, ▄, █)
 * and 24-bit ANSI truecolor escape sequences — just like Claude Code's CLI mascot!
 */
export function blipAnsi(options = {}) {
  const { theme = 'blue', indent = '  ' } = options;
  const p = BLIP_PALETTES[theme] || BLIP_PALETTES.blue;
  const colorMap = {
    T: p.tip,
    S: p.shade,
    H: p.top,
    B: p.body,
    W: p.shine,
    K: p.ink,
    P: p.blush,
    F: p.foot,
  };
  const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const fg = (hex) => {
    const [r, g, b] = hexToRgb(hex);
    return `\x1b[38;2;${r};${g};${b}m`;
  };
  const bg = (hex) => {
    const [r, g, b] = hexToRgb(hex);
    return `\x1b[48;2;${r};${g};${b}m`;
  };
  const reset = '\x1b[0m';

  const lines = [];
  for (let y = 0; y < BLIP_GRID.length; y += 2) {
    const topRow = BLIP_GRID[y];
    const botRow = BLIP_GRID[y + 1] || '..................';
    let line = indent;
    for (let x = 0; x < 18; x++) {
      const tc = colorMap[topRow[x]];
      const bc = colorMap[botRow[x]];
      if (!tc && !bc) {
        line += ' ';
      } else if (tc && !bc) {
        line += `${fg(tc)}▀${reset}`;
      } else if (!tc && bc) {
        line += `${fg(bc)}▄${reset}`;
      } else if (tc === bc) {
        line += `${fg(tc)}█${reset}`;
      } else {
        line += `${fg(tc)}${bg(bc)}▀${reset}`;
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

if (typeof window !== 'undefined') {
  window.Blip = {
    BLIP_PALETTES,
    BLIP_GRID,
    blipIconSvg,
    blipSvg,
    createBlip,
    blipAnsi,
  };
}
