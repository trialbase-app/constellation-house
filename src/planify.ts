import {
  isEntranceStar,
  isGarden,
  newId,
  type House,
  type Opening,
  type OpeningKind,
  type Room,
  type Wall,
  type WallKind,
} from "./types";
import {
  resolveAccessRelations,
  roomsShareWall,
  type AccessFailure,
} from "./planAccess";
import { layoutRooms, placeGardens } from "./planLayout";
import { enforceMinAreas, minHeightForArea, minWidthForArea, moduleSize } from "./roomArea";

const EPS = 0.08;
const DOOR = 0.8;
type Bounds = { x: number; y: number; w: number; h: number };

export type RoomOverlap = {
  a: Room;
  b: Room;
  overlapX: number;
  overlapY: number;
  area: number;
};

export function findOverlaps(rooms: Room[]): RoomOverlap[] {
  const hits: RoomOverlap[] = [];
  const target = rooms.filter(
    (r) => r.kind === "star" || r.kind === "garden" || r.kind === "corridor",
  );
  for (let i = 0; i < target.length; i++) {
    for (let j = i + 1; j < target.length; j++) {
      const a = target[i];
      const b = target[j];
      const ox = overlapX(a, b);
      const oy = overlapY(a, b);
      if (ox > EPS && oy > EPS) {
        hits.push({ a, b, overlapX: ox, overlapY: oy, area: ox * oy });
      }
    }
  }
  return hits;
}

export function resolvePlanOverlaps(rooms: Room[], house: House) {
  const frame = deriveFloorFrame(rooms);
  for (let pass = 0; pass < 4; pass++) {
    forceSeparateAll(rooms, house, frame);
    if (findOverlaps(rooms).length === 0) break;
  }
  snapApartOverlaps(rooms, house);
}

export type PlanifyResult =
  | {
      ok: true;
      rooms: Room[];
      walls: Wall[];
      openings: Opening[];
    }
  | {
      ok: false;
      failures: AccessFailure[];
    };

/**
 * 図面化パイプライン（契約）:
 * ①敷地 ②必要床面積 ③建物ボリューム ④部屋配置
 * ⑤空間関係（行き来） ⑥形状調整 ⑦面積調整 ⑧接続具体化
 */
export function planify(house: House): PlanifyResult {
  const working: House = {
    ...house,
    links: house.links.filter((link) => link.kind === "access"),
  };

  // ②③④: 必要床面積・ボリューム・部屋配置（部門まとめ）
  const rooms = layoutRooms(working);
  const module = moduleSize(working.moduleMm);
  let frame = deriveFloorFrame(rooms);

  // 最低面積（目標1.0倍）まで確保
  enforceMinAreas(rooms, module);
  frame = deriveFloorFrame(rooms);
  forceSeparateAll(rooms, house, frame);
  snapApartOverlaps(rooms, house);
  frame = deriveFloorFrame(rooms);

  // 玄関は外気に面するよう寄せる（現状踏襲）
  enforceEntranceOnExterior(rooms, house, frame);

  // ⑤⑥⑦: 行き来必須 → 形状 → 面積
  const access = resolveAccessRelations(rooms, working, frame, {
    forceSeparate: () => {
      forceSeparateAll(rooms, house, frame);
      snapApartOverlaps(rooms, house);
    },
    growAreas: () => {
      // ⑦ 目標〜2倍まで増やして収める
      enforceMinAreas(rooms, module);
    },
    cloneRooms: (source) => source.map((room) => ({ ...room })),
    restoreRooms: (target, source) => {
      target.splice(0, target.length, ...source.map((room) => ({ ...room })));
    },
  });

  if (!access.ok) {
    return { ok: false, failures: access.failures };
  }

  refreshGardenRooms(rooms, house, module);
  frame = deriveFloorFrame(rooms);
  if (findOverlaps(rooms).length > 0) {
    forceSeparateAll(rooms, house, frame);
    snapApartOverlaps(rooms, house);
  }

  const remaining = findOverlaps(rooms);
  if (remaining.length > 0) {
    return {
      ok: false,
      failures: remaining.map((hit) => ({
        linkId: "",
        fromName: hit.a.name,
        toName: hit.b.name,
        detail: `${hit.a.name} × ${hit.b.name} の重なりを解消できませんでした。`,
      })),
    };
  }

  // 最終確認: 行き来がまだ生きているか
  const accessLinks = working.links.filter((l) => l.kind === "access");
  const broken = accessLinks.filter((link) => {
    const a = rooms.find((r) => r.id === link.fromId);
    const b = rooms.find((r) => r.id === link.toId);
    if (!a || !b) return true;
    if (roomsShareWall(a, b)) return false;
    const corridors = rooms.filter((r) => r.kind === "corridor");
    return !corridors.some((c) => roomsShareWall(a, c) && roomsShareWall(b, c));
  });
  if (broken.length > 0) {
    return {
      ok: false,
      failures: broken.map((link) => {
        const from = working.stars.find((s) => s.id === link.fromId);
        const to = working.stars.find((s) => s.id === link.toId);
        return {
          linkId: link.id,
          fromName: from?.name ?? "",
          toName: to?.name ?? "",
          detail: `${from?.name ?? "?"}と${to?.name ?? "?"}の行き来が、最終調整で切れてしまいました。`,
        };
      }),
    };
  }

  // ⑧ 壁・出入口
  const { walls, openings } = buildFabric(rooms, working);
  return { ok: true, rooms, walls, openings };
}

function refreshGardenRooms(rooms: Room[], house: House, module: number) {
  const indoor = rooms.filter((room) => room.kind === "star");
  const gardenStars = house.stars.filter((star) => isGarden(star.name));
  if (gardenStars.length === 0) return;

  const replacements = placeGardens(house, gardenStars, indoor, module);
  for (const replacement of replacements) {
    const index = rooms.findIndex((room) => room.id === replacement.id);
    if (index >= 0) rooms[index] = replacement;
  }
}

function forceSeparateAll(rooms: Room[], house: House, frame: Bounds) {
  const module = moduleSize(house.moduleMm);

  for (let pass = 0; pass < 120; pass++) {
    const hits = findOverlaps(rooms).sort((a, b) => b.area - a.area);
    if (hits.length === 0) break;

    let changed = false;
    for (const hit of hits) {
      const before = hit.area;
      nudgeApart(hit.a, hit.b, hit.overlapX, hit.overlapY, house, frame);
      pushBothApart(hit.a, hit.b, house);
      if (overlapX(hit.a, hit.b) > EPS && overlapY(hit.a, hit.b) > EPS) {
        shrinkAreaOverlap(hit.a, hit.b, house);
      }
      if (trySnapRoomApart(hit.a, hit.b, rooms, house, module)) {
        // snapped
      }
      const after = overlapX(hit.a, hit.b) * overlapY(hit.a, hit.b);
      if (after + 1e-6 < before) changed = true;
    }
    if (!changed) break;
  }
}

function pushBothApart(a: Room, b: Room, house: House) {
  const ox = overlapX(a, b);
  const oy = overlapY(a, b);
  if (ox <= EPS || oy <= EPS) return;

  const module = moduleSize(house.moduleMm);
  if (ox <= oy) {
    const half = (ox + EPS) / 2;
    a.x -= half;
    b.x += half;
  } else {
    const half = (oy + EPS) / 2;
    a.y -= half;
    b.y += half;
  }
  clampRoomToSite(a, house);
  clampRoomToSite(b, house);

  if (overlapX(a, b) > EPS && overlapY(a, b) > EPS) {
    const movable = a.w * a.h <= b.w * b.h ? a : b;
    if (ox <= oy && movable.w > module * 1.5) {
      movable.w = Math.max(module, movable.w - module);
    } else if (movable.h > module * 1.5) {
      movable.h = Math.max(module, movable.h - module);
    }
    clampRoomToSite(movable, house);
  }
}

function snapApartOverlaps(rooms: Room[], house: House) {
  const module = moduleSize(house.moduleMm);

  for (let pass = 0; pass < 50; pass++) {
    const hits = findOverlaps(rooms);
    if (hits.length === 0) break;

    let changed = false;
    for (const hit of hits) {
      if (trySnapRoomApart(hit.a, hit.b, rooms, house, module)) {
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function trySnapRoomApart(
  a: Room,
  b: Room,
  rooms: Room[],
  house: House,
  module: number,
): boolean {
  const movable = a.w * a.h <= b.w * b.h ? a : b;
  const anchor = movable === a ? b : a;
  const startX = movable.x;
  const startY = movable.y;
  const gap = module * 0.05 + EPS;

  const candidates = [
    { x: anchor.x + anchor.w + gap, y: movable.y },
    { x: anchor.x - movable.w - gap, y: movable.y },
    { x: movable.x, y: anchor.y + anchor.h + gap },
    { x: movable.x, y: anchor.y - movable.h - gap },
  ];

  for (const pos of candidates) {
    movable.x = pos.x;
    movable.y = pos.y;
    clampRoomToSite(movable, house);
    const stillOverlaps = rooms.some((other) => {
      if (other.id === movable.id) return false;
      return overlapX(movable, other) > EPS && overlapY(movable, other) > EPS;
    });
    if (!stillOverlaps) return true;
  }

  movable.x = startX;
  movable.y = startY;
  return false;
}

function clampRoomToSite(room: Room, house: House) {
  const module = moduleSize(house.moduleMm);
  const minW = minWidthForArea(room, module);
  const minH = minHeightForArea(room, module);
  room.w = Math.max(minW, Math.min(room.w, house.site.width));
  room.h = Math.max(minH, Math.min(room.h, house.site.height));
  room.x = clamp(room.x, 0, Math.max(0, house.site.width - room.w));
  room.y = clamp(room.y, 0, Math.max(0, house.site.height - room.h));
}

export function rebuildFabric(rooms: Room[], house: House) {
  return buildFabric(rooms, house);
}

type Shared = {
  dir: "v" | "h";
  x: number;
  y: number;
  t0: number;
  t1: number;
  len: number;
};

function sharedWall(a: Room, b: Room): Shared | null {
  const yo = overlapY(a, b);
  const xo = overlapX(a, b);
  if (yo > EPS && nearly(a.x + a.w, b.x)) {
    return { dir: "v", x: b.x, y: 0, t0: Math.max(a.y, b.y), t1: Math.min(bottom(a), bottom(b)), len: yo };
  }
  if (yo > EPS && nearly(b.x + b.w, a.x)) {
    return { dir: "v", x: a.x, y: 0, t0: Math.max(a.y, b.y), t1: Math.min(bottom(a), bottom(b)), len: yo };
  }
  if (xo > EPS && nearly(a.y + a.h, b.y)) {
    return { dir: "h", x: 0, y: b.y, t0: Math.max(a.x, b.x), t1: Math.min(right(a), right(b)), len: xo };
  }
  if (xo > EPS && nearly(b.y + b.h, a.y)) {
    return { dir: "h", x: 0, y: a.y, t0: Math.max(a.x, b.x), t1: Math.min(right(a), right(b)), len: xo };
  }
  return null;
}

function buildFabric(rooms: Room[], house: House): { walls: Wall[]; openings: Opening[] } {
  const indoor = rooms.filter((r) => !isGarden(r.name));
  const gardens = rooms.filter((r) => isGarden(r.name));
  const openings: Opening[] = [];

  const corridors = rooms.filter((r) => r.kind === "corridor");
  for (const link of house.links) {
    if (link.kind !== "access") continue;
    const a = rooms.find((r) => r.id === link.fromId);
    const b = rooms.find((r) => r.id === link.toId);
    if (!a || !b) continue;
    const shared = sharedWall(a, b);
    if (shared) {
      openings.push(openingFromShared(shared, a, b, "door", DOOR));
      continue;
    }
    // 廊下経由の行き来: 各室と廊下の接面に出入口
    for (const corridor of corridors) {
      const toCorrA = sharedWall(a, corridor);
      const toCorrB = sharedWall(b, corridor);
      if (toCorrA) {
        openings.push(openingFromShared(toCorrA, a, corridor, "door", DOOR));
      }
      if (toCorrB) {
        openings.push(openingFromShared(toCorrB, b, corridor, "door", DOOR));
      }
    }
  }

  for (const entry of pickEntrances(indoor, house)) {
    const edge = chooseEntranceEdge(entry, indoor);
    if (edge) {
      const already = openings.some((o) => colinearTouch(o, edge));
      if (!already) openings.push(openingOnEdge(edge, "entrance", 0.9, entry));
    }
  }

  const interiorWalls: Wall[] = [];
  for (let i = 0; i < indoor.length; i++) {
    for (let j = i + 1; j < indoor.length; j++) {
      const shared = sharedWall(indoor[i], indoor[j]);
      if (!shared) continue;
      interiorWalls.push(wallFromShared(shared, "interior"));
    }
  }

  const exteriorWalls: Wall[] = [];
  for (const room of indoor) {
    for (const edge of roomEdges(room)) {
      const holes = interiorIntervalsOnEdge(edge, indoor, room);
      for (const part of subtract(edgeRange(edge), holes)) {
        exteriorWalls.push(edgePartToWall(edge, part, "exterior"));
      }
    }
  }

  const fenceWalls: Wall[] = [];
  for (const garden of gardens) {
    for (const edge of roomEdges(garden)) {
      const holes = indoor
        .map((room) => sharedWall(garden, room))
        .filter((shared): shared is Shared => {
          if (!shared) return false;
          if (horizontal(edge) && shared.dir === "h" && nearly(shared.y, edge.y1)) return true;
          if (!horizontal(edge) && shared.dir === "v" && nearly(shared.x, edge.x1)) return true;
          return false;
        })
        .map((shared) => ({ a: shared.t0, b: shared.t1 }));
      for (const part of subtract(edgeRange(edge), holes)) {
        fenceWalls.push(edgePartToWall(edge, part, "fence"));
      }
    }
  }

  const walls = [...exteriorWalls, ...interiorWalls, ...fenceWalls].map((wall) =>
    punchWall(wall, openings),
  ).flat();

  return { walls, openings };
}

function deriveFloorFrame(rooms: Room[]): Bounds {
  const target = rooms.filter(
    (r) => r.kind === "star" || r.kind === "garden" || r.kind === "corridor",
  );
  if (target.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of target) {
    minX = Math.min(minX, room.x);
    minY = Math.min(minY, room.y);
    maxX = Math.max(maxX, right(room));
    maxY = Math.max(maxY, bottom(room));
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function enforceEntranceOnExterior(rooms: Room[], house: House, frame: Bounds) {
  const starById = new Map(house.stars.map((s) => [s.id, s]));
  const entries = rooms.filter((r) => {
    if (r.kind !== "star") return false;
    const star = starById.get(r.id);
    return star ? isEntranceStar(star) : r.name.includes("玄関");
  });
  for (const entry of entries) {
    const leftGap = entry.x - frame.x;
    const rightGap = frame.x + frame.w - right(entry);
    const topGap = entry.y - frame.y;
    const bottomGap = frame.y + frame.h - bottom(entry);
    const minGap = Math.min(leftGap, rightGap, topGap, bottomGap);

    if (minGap === leftGap) {
      entry.x = frame.x;
    } else if (minGap === rightGap) {
      entry.x = frame.x + frame.w - entry.w;
    } else if (minGap === topGap) {
      entry.y = frame.y;
    } else {
      entry.y = frame.y + frame.h - entry.h;
    }
    clampRoomToBounds(entry, house, frame);
  }
}

function shrinkAreaOverlap(a: Room, b: Room, house: House) {
  const module = moduleSize(house.moduleMm);
  const ox = overlapX(a, b);
  const oy = overlapY(a, b);
  const movable = a.w * a.h <= b.w * b.h ? a : b;
  const anchor = movable === a ? b : a;

  if (ox <= oy) {
    if (cx(movable) >= cx(anchor)) {
      movable.w = Math.max(minWidthForArea(movable, module), right(anchor) - movable.x);
    } else {
      const nextW = Math.max(minWidthForArea(movable, module), right(movable) - anchor.x);
      movable.x = right(movable) - nextW;
      movable.w = nextW;
    }
  } else if (cy(movable) >= cy(anchor)) {
    movable.h = Math.max(minHeightForArea(movable, module), bottom(anchor) - movable.y);
  } else {
    const nextH = Math.max(minHeightForArea(movable, module), bottom(movable) - anchor.y);
    movable.y = bottom(movable) - nextH;
    movable.h = nextH;
  }

  clampRoomToSite(movable, house);
  clampRoomToSite(anchor, house);
}

function nudgeApart(
  a: Room,
  b: Room,
  ox: number,
  oy: number,
  house: House,
  _frame: Bounds,
) {
  const module = moduleSize(house.moduleMm);
  const movable = a.w * a.h <= b.w * b.h ? a : b;
  const anchor = movable === a ? b : a;
  const dx = cx(movable) - cx(anchor);
  const dy = cy(movable) - cy(anchor);

  if (ox <= oy) {
    const shift = ox + EPS + 0.01;
    movable.x += dx >= 0 ? shift : -shift;
    clampRoomToSite(movable, house);
    if (overlapX(a, b) > EPS && overlapY(a, b) > EPS) {
      shrinkAlongAxis(movable, anchor, "x", house);
    }
  } else {
    const shift = oy + EPS + 0.01;
    movable.y += dy >= 0 ? shift : -shift;
    clampRoomToSite(movable, house);
    if (overlapX(a, b) > EPS && overlapY(a, b) > EPS) {
      shrinkAlongAxis(movable, anchor, "y", house);
    }
  }

  if (overlapX(a, b) > EPS && overlapY(a, b) > EPS) {
    shrinkAreaOverlap(a, b, house);
  }

  if (overlapX(a, b) > EPS && overlapY(a, b) > EPS) {
    const minW = minWidthForArea(movable, module);
    const minH = minHeightForArea(movable, module);
    if (ox <= oy && movable.w > minW + module) {
      movable.w = Math.max(minW, movable.w - module);
    } else if (movable.h > minH + module) {
      movable.h = Math.max(minH, movable.h - module);
    }
    clampRoomToSite(movable, house);
  }
}

function shrinkAlongAxis(
  movable: Room,
  anchor: Room,
  axis: "x" | "y",
  house: House,
) {
  const module = moduleSize(house.moduleMm);
  if (axis === "x") {
    const ox = overlapX(movable, anchor);
    if (ox <= EPS) return;
    if (cx(movable) >= cx(anchor)) {
      movable.w = Math.max(minWidthForArea(movable, module), movable.w - ox - EPS);
    } else {
      const nextW = Math.max(minWidthForArea(movable, module), movable.w - ox - EPS);
      movable.x = right(movable) - nextW;
      movable.w = nextW;
    }
  } else {
    const oy = overlapY(movable, anchor);
    if (oy <= EPS) return;
    if (cy(movable) >= cy(anchor)) {
      movable.h = Math.max(minHeightForArea(movable, module), movable.h - oy - EPS);
    } else {
      const nextH = Math.max(minHeightForArea(movable, module), movable.h - oy - EPS);
      movable.y = bottom(movable) - nextH;
      movable.h = nextH;
    }
  }
  clampRoomToSite(movable, house);
}

function clampRoomToBounds(room: Room, house: House, frame: Bounds) {
  const module = moduleSize(house.moduleMm);
  const siteX0 = 0;
  const siteY0 = 0;
  const siteX1 = house.site.width;
  const siteY1 = house.site.height;

  const x0 = Math.max(siteX0, frame.x);
  const y0 = Math.max(siteY0, frame.y);
  const x1 = Math.min(siteX1, frame.x + frame.w);
  const y1 = Math.min(siteY1, frame.y + frame.h);

  const minW = minWidthForArea(room, module);
  const minH = minHeightForArea(room, module);
  room.w = Math.max(minW, Math.min(room.w, Math.max(minW, x1 - x0)));
  room.h = Math.max(minH, Math.min(room.h, Math.max(minH, y1 - y0)));
  room.x = clamp(room.x, x0, Math.max(x0, x1 - room.w));
  room.y = clamp(room.y, y0, Math.max(y0, y1 - room.h));
}

type Edge = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  inwardX: number;
  inwardY: number;
};

function roomEdges(room: Room): Edge[] {
  return [
    { x1: room.x, y1: room.y, x2: right(room), y2: room.y, inwardX: 0, inwardY: 1 },
    { x1: room.x, y1: bottom(room), x2: right(room), y2: bottom(room), inwardX: 0, inwardY: -1 },
    { x1: room.x, y1: room.y, x2: room.x, y2: bottom(room), inwardX: 1, inwardY: 0 },
    { x1: right(room), y1: room.y, x2: right(room), y2: bottom(room), inwardX: -1, inwardY: 0 },
  ];
}

function edgeRange(edge: Edge): { a: number; b: number } {
  if (horizontal(edge)) return { a: Math.min(edge.x1, edge.x2), b: Math.max(edge.x1, edge.x2) };
  return { a: Math.min(edge.y1, edge.y2), b: Math.max(edge.y1, edge.y2) };
}

function interiorIntervalsOnEdge(edge: Edge, indoor: Room[], room: Room): { a: number; b: number }[] {
  const holes: { a: number; b: number }[] = [];
  for (const other of indoor) {
    if (other.id === room.id) continue;
    const shared = sharedWall(room, other);
    if (!shared) continue;
    if (horizontal(edge) && shared.dir === "h" && nearly(shared.y, edge.y1)) {
      holes.push({ a: shared.t0, b: shared.t1 });
    }
    if (!horizontal(edge) && shared.dir === "v" && nearly(shared.x, edge.x1)) {
      holes.push({ a: shared.t0, b: shared.t1 });
    }
  }
  return holes;
}

function subtract(range: { a: number; b: number }, holes: { a: number; b: number }[]) {
  let parts = [range];
  for (const hole of holes) {
    const next: { a: number; b: number }[] = [];
    for (const part of parts) {
      const lo = Math.max(part.a, hole.a);
      const hi = Math.min(part.b, hole.b);
      if (lo >= hi) {
        next.push(part);
        continue;
      }
      if (part.a < lo - 0.02) next.push({ a: part.a, b: lo });
      if (hi < part.b - 0.02) next.push({ a: hi, b: part.b });
    }
    parts = next;
  }
  return parts.filter((p) => p.b - p.a > 0.06);
}

function edgePartToWall(edge: Edge, part: { a: number; b: number }, kind: WallKind): Wall {
  if (horizontal(edge)) {
    return { id: newId("wall"), kind, x1: part.a, y1: edge.y1, x2: part.b, y2: edge.y1 };
  }
  return { id: newId("wall"), kind, x1: edge.x1, y1: part.a, x2: edge.x1, y2: part.b };
}

function wallFromShared(shared: Shared, kind: WallKind): Wall {
  if (shared.dir === "v") {
    return { id: newId("wall"), kind, x1: shared.x, y1: shared.t0, x2: shared.x, y2: shared.t1 };
  }
  return { id: newId("wall"), kind, x1: shared.t0, y1: shared.y, x2: shared.t1, y2: shared.y };
}

function punchWall(wall: Wall, openings: Opening[]): Wall[] {
  const horiz = nearly(wall.y1, wall.y2);
  const range = horiz
    ? { a: Math.min(wall.x1, wall.x2), b: Math.max(wall.x1, wall.x2) }
    : { a: Math.min(wall.y1, wall.y2), b: Math.max(wall.y1, wall.y2) };
  const holes: { a: number; b: number }[] = [];
  for (const opening of openings) {
    if (horiz && nearly(opening.y1, wall.y1) && nearly(opening.y2, wall.y1)) {
      holes.push({ a: Math.min(opening.x1, opening.x2), b: Math.max(opening.x1, opening.x2) });
    }
    if (!horiz && nearly(opening.x1, wall.x1) && nearly(opening.x2, wall.x1)) {
      holes.push({ a: Math.min(opening.y1, opening.y2), b: Math.max(opening.y1, opening.y2) });
    }
  }
  return subtract(range, holes).map((part) =>
    horiz
      ? { ...wall, id: newId("wall"), x1: part.a, x2: part.b, y1: wall.y1, y2: wall.y1 }
      : { ...wall, id: newId("wall"), y1: part.a, y2: part.b, x1: wall.x1, x2: wall.x1 },
  );
}

function openingFromShared(
  shared: Shared,
  a: Room,
  b: Room,
  kind: OpeningKind,
  width: number,
): Opening {
  const inward = {
    inwardX: shared.dir === "v" ? (cx(b) > cx(a) ? 1 : -1) : 0,
    inwardY: shared.dir === "h" ? (cy(b) > cy(a) ? 1 : -1) : 0,
  };
  const edge: Edge =
    shared.dir === "v"
      ? { x1: shared.x, y1: shared.t0, x2: shared.x, y2: shared.t1, ...inward }
      : { x1: shared.t0, y1: shared.y, x2: shared.t1, y2: shared.y, ...inward };
  return openingOnEdge(edge, kind, Math.min(width, shared.len - 0.1), b);
}

function openingOnEdge(edge: Edge, kind: OpeningKind, width: number, into: Room): Opening {
  const horiz = horizontal(edge);
  const a = horiz ? Math.min(edge.x1, edge.x2) : Math.min(edge.y1, edge.y2);
  const b = horiz ? Math.max(edge.x1, edge.x2) : Math.max(edge.y1, edge.y2);
  const usable = Math.max(0.5, Math.min(width, b - a - 0.12));
  const mid = (a + b) / 2;
  const t0 = clamp(mid - usable / 2, a + 0.06, b - usable - 0.06);
  const t1 = t0 + usable;

  let x1: number, y1: number, x2: number, y2: number;
  if (horiz) {
    x1 = t0;
    x2 = t1;
    y1 = edge.y1;
    y2 = edge.y1;
  } else {
    x1 = edge.x1;
    x2 = edge.x1;
    y1 = t0;
    y2 = t1;
  }

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  let inwardX = edge.inwardX;
  let inwardY = edge.inwardY;
  if (inwardX * (cx(into) - midX) + inwardY * (cy(into) - midY) < 0) {
    inwardX *= -1;
    inwardY *= -1;
  }

  const hingeX = x1;
  const hingeY = y1;
  const leafX = hingeX + inwardX * usable;
  const leafY = hingeY + inwardY * usable;
  const wallDx = x2 - x1;
  const wallDy = y2 - y1;
  const cross = wallDx * inwardY - wallDy * inwardX;
  const sweep: 0 | 1 = cross >= 0 ? 0 : 1;

  return {
    id: newId("open"),
    kind,
    x1,
    y1,
    x2,
    y2,
    hingeX,
    hingeY,
    leafX,
    leafY,
    sweep,
  };
}

function pickEntrances(indoor: Room[], house: House): Room[] {
  if (indoor.length === 0) return [];
  const starById = new Map(house.stars.map((s) => [s.id, s]));
  const typed = indoor.filter((r) => {
    const star = starById.get(r.id);
    return star ? isEntranceStar(star) : r.name.includes("玄関");
  });
  if (typed.length > 0) return typed;
  const fallback = indoor
    .slice()
    .sort(
      (a, b) =>
        bottom(b) - bottom(a) ||
        Math.abs(cx(a) - house.site.width / 2) -
          Math.abs(cx(b) - house.site.width / 2),
    )[0];
  return fallback ? [fallback] : [];
}

function chooseEntranceEdge(room: Room, indoor: Room[]): Edge | null {
  const centerX = average(indoor.map((r) => cx(r)));
  const centerY = average(indoor.map((r) => cy(r)));
  const vx = cx(room) - centerX;
  const vy = cy(room) - centerY;
  const preferHorizontal = Math.abs(vx) >= Math.abs(vy);
  const preferred = preferHorizontal
    ? vx >= 0
      ? "right"
      : "left"
    : vy >= 0
      ? "bottom"
      : "top";

  const edges = roomEdges(room).filter((edge) => {
    return !indoor.some((other) => {
      if (other.id === room.id) return false;
      const shared = sharedWall(room, other);
      if (!shared) return false;
      if (horizontal(edge) && shared.dir === "h" && nearly(shared.y, edge.y1)) return true;
      if (!horizontal(edge) && shared.dir === "v" && nearly(shared.x, edge.x1)) return true;
      return false;
    });
  });
  if (edges.length === 0) return null;
  const byName = edges.find((edge) => edgeName(edge, room) === preferred);
  if (byName) return byName;
  return edges[0];
}

function colinearTouch(opening: Opening, edge: Edge) {
  if (horizontal(edge) && nearly(opening.y1, edge.y1) && nearly(opening.y2, edge.y1)) return true;
  if (!horizontal(edge) && nearly(opening.x1, edge.x1) && nearly(opening.x2, edge.x1)) return true;
  return false;
}

function horizontal(edge: { y1: number; y2: number }) {
  return nearly(edge.y1, edge.y2);
}

function edgeName(edge: Edge, room: Room): "top" | "bottom" | "left" | "right" {
  if (horizontal(edge)) {
    return nearly(edge.y1, room.y) ? "top" : "bottom";
  }
  return nearly(edge.x1, room.x) ? "left" : "right";
}

function cx(r: Room) {
  return r.x + r.w / 2;
}
function cy(r: Room) {
  return r.y + r.h / 2;
}
function right(r: Room) {
  return r.x + r.w;
}
function bottom(r: Room) {
  return r.y + r.h;
}
function overlapX(a: Room, b: Room) {
  return Math.min(right(a), right(b)) - Math.max(a.x, b.x);
}
function overlapY(a: Room, b: Room) {
  return Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
}
function nearly(a: number, b: number) {
  return Math.abs(a - b) < EPS;
}
function average(ns: number[]) {
  if (ns.length === 0) return 0;
  return ns.reduce((sum, n) => sum + n, 0) / ns.length;
}
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
