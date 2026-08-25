/** @deprecated sight は廃止。既存データ互換のため残す */
export type LineKind = "access" | "sight";

export type Mode = "select" | "place" | "access";

/** 廊下幅（モジュール個数）。図面化の①で指定 */
export type CorridorModules = 1 | 2;

export type RoomType = "normal" | "stair" | "corridor" | "entrance";

export type Star = {
  id: string;
  name: string;
  x: number;
  y: number;
  area: number;
  departmentId: string;
  roomType: RoomType;
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
  kind: "star" | "corridor" | "toilet" | "garden";
  x: number;
  y: number;
  w: number;
  h: number;
  minArea: number;
};

export type Department = {
  id: string;
  name: string;
  color: string;
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
  departments: Department[];
  stars: Star[];
  links: Link[];
  rooms: Room[] | null;
  walls: Wall[] | null;
  openings: Opening[] | null;
  planStale: boolean;
  areaMargin: number;
  moduleMm: number;
  /** 廊下を足すときの幅（モジュール1または2）。初期値1 */
  corridorModules: CorridorModules;
};

export const ROAD_DEPTH = 2;
export const MIN_AREA = 4;
export const MAX_AREA = 80;
export const DEFAULT_AREA = 12;
export const DEFAULT_SITE: Site = { width: 10, height: 15 };
export const DEFAULT_AREA_MARGIN = 1.2;
export const DEFAULT_MODULE_MM = 910;
export const DEFAULT_CORRIDOR_MODULES: CorridorModules = 1;
/** ⑦で面積を増やしてよい上限（目標面積に対する倍率） */
export const AREA_MAX_FACTOR = 2;
export const DEFAULT_DEPARTMENTS: Department[] = [
  { id: "dep-a", name: "部門A", color: "#e9cf9c" },
  { id: "dep-b", name: "部門B", color: "#d2e6bb" },
  { id: "dep-c", name: "部門C", color: "#bcd9f0" },
];

export function starRadius(area: number): number {
  return Math.sqrt(Math.max(area, MIN_AREA) / Math.PI);
}

export function distance(a: Star, b: Star): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isGarden(name: string): boolean {
  return name.includes("庭");
}

export function roomTypeLabel(roomType: RoomType): string {
  switch (roomType) {
    case "stair":
      return "階段室";
    case "corridor":
      return "廊下";
    case "entrance":
      return "玄関";
    default:
      return "通常室";
  }
}

export function isEntranceStar(star: Star): boolean {
  return star.roomType === "entrance" || star.name.includes("玄関");
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
