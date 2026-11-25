import { Assets, Spritesheet, type SpritesheetData, Texture } from 'pixi.js';
import uiSheet1x from '../../assets/spritesheet/ui_sheet.json';
import uiSheet2x from '../../assets/spritesheet/ui_sheet_retina.json';
import uiSheetPng1x from '../../assets/spritesheet/ui_sheet.png?url';
import uiSheetPng2x from '../../assets/spritesheet/ui_sheet_retina.png?url';
import { VEGETATION_TILES } from './ambience';
import { ISLANDS, WATER_TILE } from './arena';

/**
 * Game texture loading. Textures are loaded once per page and reused by every match
 * (the store is a module singleton). Failures reject so the UI can show an error + retry
 * before combat starts; Pixi drops failed entries from its cache, so retry re-fetches.
 */

type UrlMap = Record<string, string>;

const png1x = import.meta.glob<string>(
  [
    '../../assets/png/default/ships/ship_*.png',
    '../../assets/png/default/effects/*.png',
    '../../assets/png/default/tiles/*.png',
    '../../assets/png/default/ship_parts/cannon_ball.png',
  ],
  { query: '?url', import: 'default', eager: true },
) as UrlMap;

const png2x = import.meta.glob<string>(
  [
    '../../assets/png/retina/ships/ship_*.png',
    '../../assets/png/retina/effects/*.png',
    '../../assets/png/retina/tiles/*.png',
    '../../assets/png/retina/ship_parts/cannon_ball.png',
  ],
  { query: '?url', import: 'default', eager: true },
) as UrlMap;

/** Ship hull colour index (1–6). Damage variants are +6, +12; +18 is the wreck. */
export const SHIP_COLOR = { player: 2, chaser: 3, shooter: 4 } as const;

export interface GameTextures {
  tile: (id: number) => Texture;
  ship: (color: number, damageStage: 0 | 1 | 2 | 3) => Texture;
  explosion: Texture[];
  fire: Texture[];
  cannonBall: Texture;
  ui: Spritesheet;
}

function usedTiles(): number[] {
  const set = new Set<number>([WATER_TILE, ...VEGETATION_TILES]);
  for (const island of ISLANDS) {
    for (const t of island.tiles) set.add(t.tile);
    for (const t of island.decorations) set.add(t.tile);
  }
  return [...set];
}

function prefersRetina(): boolean {
  return typeof window !== 'undefined' && window.devicePixelRatio >= 1.5;
}

function urlFor(map: UrlMap, folder: string, name: string, density: '1x' | '2x'): string {
  const dir = density === '2x' ? 'retina' : 'default';
  const key = `../../assets/png/${dir}/${folder}/${name}.png`;
  const url = map[key];
  if (!url) throw new Error(`Missing asset ${key}`);
  return url;
}

let cached: GameTextures | null = null;
let inflight: Promise<GameTextures> | null = null;

export function getLoadedTextures(): GameTextures | null {
  return cached;
}

export function loadGameTextures(onProgress: (progress: number) => void): Promise<GameTextures> {
  if (cached) {
    onProgress(1);
    return Promise.resolve(cached);
  }
  if (inflight) return inflight;
  inflight = doLoad(onProgress).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doLoad(onProgress: (progress: number) => void): Promise<GameTextures> {
  const density = prefersRetina() ? '2x' : '1x';
  const map = density === '2x' ? png2x : png1x;
  const resolution = density === '2x' ? 2 : 1;

  const entries: Array<{ key: string; src: string }> = [];
  for (let i = 1; i <= 24; i++) entries.push({ key: `ship_${i}`, src: urlFor(map, 'ships', `ship_${i}`, density) });
  for (let i = 1; i <= 3; i++) entries.push({ key: `explosion_${i}`, src: urlFor(map, 'effects', `explosion_${i}`, density) });
  for (let i = 1; i <= 2; i++) entries.push({ key: `fire_${i}`, src: urlFor(map, 'effects', `fire_${i}`, density) });
  for (const t of usedTiles()) entries.push({ key: `tile_${t}`, src: urlFor(map, 'tiles', `tile_${t}`, density) });
  entries.push({ key: 'cannon_ball', src: urlFor(map, 'ship_parts', 'cannon_ball', density) });
  const atlasPng = density === '2x' ? uiSheetPng2x : uiSheetPng1x;
  const atlasData = (density === '2x' ? uiSheet2x : uiSheet1x) as unknown as SpritesheetData;

  const total = entries.length + 1;
  let done = 0;
  const tick = () => onProgress(++done / total);

  const textures = new Map<string, Texture>();
  let atlasTex: Texture | null = null;
  await Promise.all([
    ...entries.map(async (e) => {
      textures.set(e.key, await Assets.load<Texture>({ src: e.src, data: { resolution } }));
      tick();
    }),
    Assets.load<Texture>({ src: atlasPng, data: { resolution } }).then((t) => {
      atlasTex = t;
      tick();
    }),
  ]);
  const ui = new Spritesheet(atlasTex!, atlasData);
  await ui.parse();

  const get = (key: string): Texture => {
    const t = textures.get(key);
    if (!t) throw new Error(`Texture ${key} not loaded`);
    return t;
  };

  cached = {
    tile: (id) => get(`tile_${id}`),
    ship: (color, stage) => get(`ship_${color + stage * 6}`),
    explosion: [get('explosion_3'), get('explosion_2'), get('explosion_1')],
    fire: [get('fire_1'), get('fire_2')],
    cannonBall: get('cannon_ball'),
    ui,
  };
  return cached;
}
