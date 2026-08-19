export type LineKind = "access" | "sight";

export type Mode = "select" | "place" | "access" | "sight";

export type Star = {
  id: string;
  name: string;
  x: number;
  y: number;
  area: number;
};

export type Link = {
  id: string;
  fromId: string;
  toId: string;
  kind: LineKind;
};

export type Room = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minArea: number;
};

export type WallKind = "exterior" | "interior" | "fence";

export type Wall = {
  id: string;
  kind: WallKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type OpeningKind = "door" | "entrance" | "window";

export type Opening = {
  id: string;
  kind: OpeningKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hingeX: number;
  hingeY: number;
  leafX: number;
  leafY: number;
  sweep: 0 | 1;
};

export type Site = {
  width: number;
  height: number;
};

export type House = {
  site: Site;
  siteVisible: boolean;
  stars: Star[];
  links: Link[];
  rooms: Room[] | null;
  walls: Wall[] | null;
  openings: Opening[] | null;
  planStale: boolean;
  areaMargin: number;
  moduleMm: number;
};

export const ROAD_DEPTH = 2;
export const MIN_AREA = 4;
export const MAX_AREA = 80;
export const DEFAULT_AREA = 12;
export const DEFAULT_SITE: Site = { width: 10, height: 15 };
export const DEFAULT_AREA_MARGIN = 1.2;
export const DEFAULT_MODULE_MM = 910;

export function starRadius(area: number): number {
  return Math.sqrt(Math.max(area, MIN_AREA) / Math.PI);
}

export function distance(a: Star, b: Star): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isGarden(name: string): boolean {
  return name.includes("庭");
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
