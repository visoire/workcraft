// Shared by the page templates (Node build) and the browser bundle. 24px grid, 2px stroke.
import { MARK, WORDMARK } from './brand.js';

export const ICONS = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowUpDown: 'M8 20V4M4 8l4-4 4 4M16 4v16M12 16l4 4 4-4',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  back: 'M15 6l-6 6 6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  chat: 'M4 5h16v11H9l-5 4zM8 9.5h8M8 12.5h5',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  layers: 'M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5',
  browser: 'M3.5 5h17v14h-17zM3.5 9h17M7 13h6M7 16h4',
  tablet: 'M6.5 3h11A1.5 1.5 0 0 1 19 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3zM11 18h2',
  phone: 'M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM10.5 18.5h3',
  globe: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17',
  bag: 'M5 8h14l-1.2 12H6.2zM9 8V6.5a3 3 0 0 1 6 0V8',
  spark: 'M11 4c.8 4.2 2.8 6.2 7 7-4.2.8-6.2 2.8-7 7-.8-4.2-2.8-6.2-7-7 4.2-.8 6.2-2.8 7-7z',
  palette: 'M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.4-1.9-.5-1.1.3-2.1 1.4-2.1h1.7a3.5 3.5 0 0 0 3.5-3.5C20 7.3 16.4 3.5 12 3.5zM7.8 11.2h.01M10 7.6h.01M14.2 7.6h.01',
  sun: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  pen: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  refresh: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  mail: 'M3.5 6h17v12h-17zM4 7l8 6 8-6',
  pin: 'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11zM12 10h.01',
  pause: 'M9 6v12M15 6v12',
  play: 'M8 5.5v13l11-6.5z',
  stop: 'M7 7h10v10H7z',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  menu: 'M4 8h16M4 16h16',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5 5 0 0 1 3.5 5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3.2 3.9M6.6 7.6C4 9.3 2.5 12 2.5 12S6 18 12 18c1.6 0 3-.4 4.3-1',
  cookie: 'M12 3a9 9 0 1 0 9 9 4 4 0 0 1-4-4 4 4 0 0 1-5-5zM8.5 10.5h.01M15.5 15.5h.01M10 16h.01M12.5 12.5h.01',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7',
  expand: 'M4 10V4h6M20 14v6h-6M4 4l6 6M20 20l-6-6',
  collapse: 'M10 4v6H4M14 20v-6h6M4 10l6-6M20 14l-6 6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  dots: 'M12 5.5h.01M12 12h.01M12 18.5h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6V14M12 17.5h.01',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  shuffle: 'M4 7h3c5 0 5 10 10 10h3M17 14l3 3-3 3M4 17h3c1.6 0 2.7-1 3.6-2.4M13.4 9.4C14.3 8 15.4 7 17 7h3M17 4l3 3-3 3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  dollar: 'M12 3v18M16.5 7.5c-.8-1.5-2.4-2.5-4.5-2.5-2.5 0-4.5 1.3-4.5 3.4 0 4.6 9.5 2.4 9.5 7.2 0 2.1-2 3.4-4.8 3.4-2.3 0-4-1-4.7-2.6',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20h4',
  wifiOff: 'M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.3-2.5M19 12.9a10 10 0 0 0-2.6-1.8M12 20h.01',
  pip: 'M3.5 5h17v14h-17zM12 11.5h6.5V17H12z',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  exitFullscreen: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  popout: 'M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  coffee: 'M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M12 3v2',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  clip: 'M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9',
  file: 'M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5zM14 3v4.5h4.5M9 13h6M9 16.5h4',
  image: 'M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01',
  checks: 'M2.5 12.5l4.5 4.5 9-9.5M11.5 16l1 1 9-9.5',
  alert: 'M12 8v5M12 16.5h.01M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  logout: 'M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 16l-4-4 4-4M6 12h10',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  inbox: 'M3.5 13.5l2.6-7.9A1.5 1.5 0 0 1 7.5 4.5h9a1.5 1.5 0 0 1 1.4 1.1l2.6 7.9V19a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19zM3.5 13.5h5l1.5 2.5h4l1.5-2.5h5',
  headset: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2zM20 15a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2zM18 17v1a3 3 0 0 1-3 3h-2.5',
  book: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z',
  activity: 'M3 12h4l3-7 4 14 3-7h4',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  key: 'M15 3a6 6 0 1 1-4.7 9.7L3 20v1h3v-2h2v-2h2l1.3-1.3A6 6 0 0 1 15 3zM16.5 7.5h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  userPlus: 'M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 20.5a7 7 0 0 1 12.5-4.3M19 14v6M16 17h6',
  bellOff: 'M3 3l18 18M8.6 4.7A6 6 0 0 1 18 10v5M18 18H4l2-2v-5c0-.9.2-1.8.6-2.6M10 20h4',
  filter: 'M4 5h16l-6 7.5V19l-4 1.5v-8z',
  life: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6',
  cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  terminal: 'M4 5h16v14H4zM7.5 9.5l3 2.5-3 2.5M12.5 15h4',
  link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2',
  hash: 'M5 9h15M4 15h15M10 3.5L8 20.5M16 3.5l-2 17',
  map: 'M3.5 6.5l5-2 7 2 5-2v13l-5 2-7-2-5 2zM8.5 4.5v13M15.5 6.5v13',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  bug: 'M8 9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0zM12 9v9M4 13h4M16 13h4M5 8l3 2M19 8l-3 2M5 19l3-2M19 19l-3-2M9.5 5.5L8 3.5M14.5 5.5l1.5-2',
};
export const STAR = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z';

export function svgIcon(name, size = 20, cls = '') {
  if (name === 'star') return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR}" fill="currentColor"/></svg>`;
  const sw = name === 'dots' ? 3 : 2;
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`;
}

// The four app colors: WordCraft, GridCraft, DeckCraft, PdfCraft.
export const APP_COLORS = { word: '#3B82F6', grid: '#10B981', deck: '#F97316', pdf: '#14B8A6' };

// Brand: the W ribbon mark and the WorkCraft wordmark, traced from the logo PNGs (src/app/brand.js is
// generated, see assets/workcraft/README.md). Both draw in currentColor, so they follow the ink of the page,
// white on the dark sidebar and the chat header. The pixel and raster versions (favicon, touch icons, the
// logo of the emails) live in public/.
//   markSvg(size)      the mark. size is the old square size: the mark is 1.3 x as wide and 0.62 x as high as that.
//   logoSvg(size)      the same mark, kept under its old name (nav, panel, docs).
//   wordmarkSvg(h)     the whole word, h px high. It includes the mark, so do not put the mark next to it.
const BRAND_SCALE = 1.3;
const f2 = (n) => Math.round(n * 100) / 100;
const brandSvg = (g, width, cls, label) =>
  `<svg class="${cls}" width="${f2(width)}" height="${f2((width * g.h) / g.w)}" viewBox="0 0 ${g.w} ${g.h}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"'}><path fill="currentColor" fill-rule="evenodd" d="${g.d}"/></svg>`;
export const markSvg = (size = 30, cls = 'mark') => brandSvg(MARK, size * BRAND_SCALE, cls);
export const logoSvg = (size = 32, cls = 'logo-mark') => brandSvg(MARK, size * BRAND_SCALE, cls);
export const wordmarkSvg = (height = 22, cls = 'wordmark-svg', label = '') => brandSvg(WORDMARK, (height * WORDMARK.w) / WORDMARK.h, cls, label);

// ---------------------------------------------------------------------------
// Workspace: extra glyphs (same 24px grid, 2px stroke) and an options-based helper.
Object.assign(ICONS, {
  folder: 'M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z',
  folderOpen: 'M3.5 18V7A1.5 1.5 0 0 1 5 5.5h4l2 2.5h6.5A1.5 1.5 0 0 1 19 9.5v1M3.5 18l2.3-6.2A1.5 1.5 0 0 1 7.2 10.8H21l-2.5 7.6a1.5 1.5 0 0 1-1.4 1.1H5a1.5 1.5 0 0 1-1.5-1.5z',
  filePlus: 'M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5zM14 3v4.5h4.5M12 11v6M9 14h6',
  folderPlus: 'M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18zM12 10.5v6M9 13.5h6',
  share: 'M12 15V4M8 7.5L12 4l4 3.5M8 11H6.5A1.5 1.5 0 0 0 5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H16',
  archive: 'M3.5 4h17v4.5h-17zM5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12h4',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  minus: 'M5 12h14',
  grip: 'M9 7h.01M15 7h.01M9 12h.01M15 12h.01M9 17h.01M15 17h.01',
  layoutSingle: 'M3.5 4h17v16h-17z',
  layoutColumns: 'M3.5 4h17v16h-17zM12 4v16',
  layoutRows: 'M3.5 4h17v16h-17zM3.5 12h17',
  layoutGrid: 'M3.5 4h17v16h-17zM12 4v16M3.5 12h17',
  sidebar: 'M3.5 4h17v16h-17zM9.5 4v16',
  command: 'M9 6.5A2.5 2.5 0 1 0 6.5 9H9zM9 9h6v6H9zM15 6.5V9h2.5A2.5 2.5 0 1 0 15 6.5zM9 17.5V15H6.5A2.5 2.5 0 1 0 9 17.5zM15 15v2.5a2.5 2.5 0 1 0 2.5-2.5z',
  wifi: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.7 16a5 5 0 0 1 6.6 0M12 19h.01',
  plug: 'M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  commit: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 12h5.5M15.5 12H21',
  power: 'M12 3v8M7 6.3a7 7 0 1 0 10 0',
  dock: 'M3.5 4h17v16h-17zM3.5 16h17',
  minimize: 'M5 18h14',
  collapseUp: 'M6 15l6-6 6 6',
  slash: 'M15 4L9 20',
  at: 'M16 12a4 4 0 1 1-1.2-2.9M16 8v5.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  briefcase: 'M4 8h16v11H4zM9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M4 13h16',
  retry: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5',
  // Answer again: the two circling arrows with a small spark inside (a new answer, not a page reload)
  regenerate: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5M12 9.6l.8 1.6 1.6.8-1.6.8-.8 1.6-.8-1.6-1.6-.8 1.6-.8z',
  // Undo the changes of an answer: back in time (counter-clockwise arrow around a clock hand)
  restore: 'M3.5 12a8.5 8.5 0 1 0 2.7-6.2L3.5 8.5M3.5 3.5v5h5M12 7.5V12l3 1.8',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5h.01',
  eraser: 'M9 19.5h11M5.3 14.4l8-8.1a2 2 0 0 1 2.8 0l2.6 2.6a2 2 0 0 1 0 2.8l-6.2 6.3H8.6a2 2 0 0 1-1.4-.6l-1.9-1.9a2 2 0 0 1 0-3.1zM9.5 10.2l5 5',
  keyboard: 'M4 6.5h16A1.5 1.5 0 0 1 21.5 8v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 16V8A1.5 1.5 0 0 1 4 6.5zM6.5 10h.01M9.5 10h.01M12.5 10h.01M15.5 10h.01M18 10h.01M7.5 14h9',
  panelTop: 'M4 5h16v14H4zM4 9.5h16',
  panelLeft: 'M4 5h16v14H4zM9.5 5v14',
  panelRight: 'M4 5h16v14H4zM14.5 5v14',
  chevronUp: 'M6 15l6-6 6 6',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
  micOff: 'M4 4l16 16M9 9v3a3 3 0 0 0 5.1 2.1M15 10.5V6a3 3 0 0 0-5.7-1.3M6 11a6 6 0 0 0 9.4 4.9M12 17v4M9 21h6',
});

const ALIAS = {
  'chevron-right': 'chevron', 'chevron-down': 'chevronDown', 'chevron-left': 'back', 'eye-off': 'eyeOff',
  'wifi-off': 'wifiOff', more: 'dots', ai: 'spark', maximize: 'expand', restore: 'collapse', edit: 'pen',
  'file-plus': 'filePlus', 'folder-plus': 'folderPlus', 'folder-open': 'folderOpen', 'layout-single': 'layoutSingle',
  'layout-columns': 'layoutColumns', 'layout-rows': 'layoutRows', 'layout-grid': 'layoutGrid',
};

/** Inline SVG by name; accepts the kebab-case aliases used by the workspace. */
export function icon(name, opt = {}) {
  const key = ICONS[name] ? name : ALIAS[name] && ICONS[ALIAS[name]] ? ALIAS[name] : 'file';
  return svgIcon(key, opt.size || 18, opt.cls || '');
}
