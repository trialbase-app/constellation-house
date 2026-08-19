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
import { layoutRooms } from "./planLayout";

const EPS = 0.08;
const DOOR = 0.8;
const WINDOW = 1.1;
type Bounds = { x: number; y: number; w: number; h: number };

export function planify(house: House): {
  rooms: Room[];
  walls: Wall[];
  openings: Opening[];
} {
  const rooms = layoutRooms(house);
  const frame = deriveFloorFrame(rooms);
  enforceAccessAdjacency(rooms, house, frame);
  enforceDepartmentConnectivity(rooms, house, frame);
  enforceEntranceOnExterior(rooms, house, frame);
  resolveOverlaps(rooms, house, frame);
  enforceAccessAdjacency(rooms, house, frame);
  enforceDepartmentConnectivity(rooms, house, frame);
  enforceEntranceOnExterior(rooms, house, frame);
  clampRoomsToBounds(rooms, house, frame);
  const { walls, openings } = buildFabric(rooms, house);
  return { rooms, walls, openings };
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

  for (const link of house.links) {
    const a = rooms.find((r) => r.id === link.fromId);
    const b = rooms.find((r) => r.id === link.toId);
    if (!a || !b) continue;
    const shared = sharedWall(a, b);
    if (link.kind === "access") {
      if (shared) {
        openings.push(openingFromShared(shared, a, b, "door", DOOR));
      }
    } else if (shared) {
      openings.push(openingFromShared(shared, a, b, "window", WINDOW));
    } else {
      const facing = facingEdge(a, b);
      if (facing) openings.push(openingOnEdge(facing, "window", WINDOW, a));
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
  const target = rooms.filter((r) => r.kind === "star" || r.kind === "garden");
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

function enforceAccessAdjacency(rooms: Room[], house: House, frame: Bounds) {
  const targetRooms = rooms.filter(
    (r) => r.kind === "star" || r.kind === "garden",
  );
  for (let i = 0; i < 28; i++) {
    for (const link of house.links) {
      if (link.kind !== "access") continue;
      const a = targetRooms.find((r) => r.id === link.fromId);
      const b = targetRooms.find((r) => r.id === link.toId);
      if (!a || !b) continue;
      if (sharedWall(a, b)) continue;
      forceShareByExpansion(a, b, house, frame);
    }
  }
}

function enforceDepartmentConnectivity(rooms: Room[], house: House, frame: Bounds) {
  const targetRooms = rooms.filter((r) => r.kind === "star");
  const starById = new Map(house.stars.map((s) => [s.id, s]));
  const byDepartment = new Map<string, Room[]>();

  for (const room of targetRooms) {
    const dep = starById.get(room.id)?.departmentId;
    if (!dep) continue;
    const list = byDepartment.get(dep) ?? [];
    list.push(room);
    byDepartment.set(dep, list);
  }

  for (const [, depRooms] of byDepartment) {
    if (depRooms.length <= 1) continue;
    const pairs = buildDepartmentPairs(depRooms);
    for (let i = 0; i < 20; i++) {
      let allShared = true;
      for (const [a, b] of pairs) {
        if (sharedWall(a, b)) continue;
        forceShareByShift(a, b, house, frame);
        allShared = false;
      }
      if (allShared) break;
    }
  }
}

function buildDepartmentPairs(depRooms: Room[]): Array<[Room, Room]> {
  const remaining = depRooms.slice(1);
  const connected = [depRooms[0]];
  const pairs: Array<[Room, Room]> = [];

  while (remaining.length > 0) {
    let bestI = 0;
    let bestFrom = connected[0];
    let bestD = Infinity;
    for (const from of connected) {
      for (let i = 0; i < remaining.length; i++) {
        const to = remaining[i];
        const d = Math.hypot(cx(from) - cx(to), cy(from) - cy(to));
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestFrom = from;
        }
      }
    }
    const [picked] = remaining.splice(bestI, 1);
    pairs.push([bestFrom, picked]);
    connected.push(picked);
  }
  return pairs;
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

function resolveOverlaps(rooms: Room[], house: House, frame: Bounds) {
  const starById = new Map(house.stars.map((s) => [s.id, s]));
  const target = rooms.filter((r) => r.kind === "star" || r.kind === "garden");
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (let i = 0; i < target.length; i++) {
      for (let j = i + 1; j < target.length; j++) {
        const a = target[i];
        const b = target[j];
        const ox = overlapX(a, b);
        const oy = overlapY(a, b);
        if (ox <= 0.02 || oy <= 0.02) continue;
        if (shouldKeepTouching(a, b, house, starById)) continue;
        separateRooms(a, b, ox, oy, house, frame);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function shouldKeepTouching(
  a: Room,
  b: Room,
  house: House,
  starById: Map<string, House["stars"][number]>,
) {
  if (house.links.some((l) => l.kind === "access" && (
    (l.fromId === a.id && l.toId === b.id) ||
    (l.fromId === b.id && l.toId === a.id)
  ))) {
    return true;
  }
  const depA = starById.get(a.id)?.departmentId;
  const depB = starById.get(b.id)?.departmentId;
  return Boolean(depA && depB && depA === depB);
}

function separateRooms(
  a: Room,
  b: Room,
  ox: number,
  oy: number,
  house: House,
  frame: Bounds,
) {
  const aArea = a.w * a.h;
  const bArea = b.w * b.h;
  const movable = aArea <= bArea ? a : b;
  const anchor = movable === a ? b : a;
  const dx = cx(movable) - cx(anchor);
  const dy = cy(movable) - cy(anchor);

  if (ox < oy) {
    const shift = ox + 0.04;
    movable.x += dx >= 0 ? shift : -shift;
  } else {
    const shift = oy + 0.04;
    movable.y += dy >= 0 ? shift : -shift;
  }
  clampRoomToBounds(movable, house, frame);
}

function clampRoomsToBounds(rooms: Room[], house: House, frame: Bounds) {
  for (const room of rooms) {
    if (room.kind !== "star" && room.kind !== "garden") continue;
    clampRoomToBounds(room, house, frame);
  }
}

function clampRoomToBounds(room: Room, house: House, frame: Bounds) {
  const siteX0 = 0;
  const siteY0 = 0;
  const siteX1 = house.site.width;
  const siteY1 = house.site.height;

  const x0 = Math.max(siteX0, frame.x);
  const y0 = Math.max(siteY0, frame.y);
  const x1 = Math.min(siteX1, frame.x + frame.w);
  const y1 = Math.min(siteY1, frame.y + frame.h);

  room.w = Math.min(room.w, Math.max(0.2, x1 - x0));
  room.h = Math.min(room.h, Math.max(0.2, y1 - y0));
  room.x = clamp(room.x, x0, Math.max(x0, x1 - room.w));
  room.y = clamp(room.y, y0, Math.max(y0, y1 - room.h));
}

function forceShareByExpansion(a: Room, b: Room, house: House, frame: Bounds) {
  const dx = cx(b) - cx(a);
  const dy = cy(b) - cy(a);
  if (Math.abs(dx) >= Math.abs(dy)) {
    // 左右方向に接続を作る（小さい方を優先して伸ばす）
    const aArea = a.w * a.h;
    const bArea = b.w * b.h;
    if (dx >= 0) {
      if (aArea <= bArea) {
        const nextW = Math.max(a.w, b.x - a.x);
        if (canExpand(a, nextW, a.h, frame)) {
          a.w = nextW;
        } else {
          b.x = a.x + a.w;
        }
      } else {
        b.x = a.x + a.w;
      }
    } else {
      if (bArea <= aArea) {
        const nextW = Math.max(b.w, a.x - b.x);
        if (canExpand(b, nextW, b.h, frame)) {
          b.w = nextW;
        } else {
          a.x = b.x + b.w;
        }
      } else {
        a.x = b.x + b.w;
      }
    }
    const oy = overlapY(a, b);
    if (oy < 0.6) {
      const top = Math.min(a.y, b.y);
      const bottomY = Math.max(bottom(a), bottom(b));
      if (aArea <= bArea) {
        const nextH = bottomY - top;
        if (canExpand(a, a.w, nextH, frame)) {
          a.y = top;
          a.h = nextH;
        } else {
          b.y = cy(a) - b.h / 2;
        }
      } else {
        const nextH = bottomY - top;
        if (canExpand(b, b.w, nextH, frame)) {
          b.y = top;
          b.h = nextH;
        } else {
          a.y = cy(b) - a.h / 2;
        }
      }
    }
  } else {
    // 上下方向に接続を作る（小さい方を優先して伸ばす）
    const aArea = a.w * a.h;
    const bArea = b.w * b.h;
    if (dy >= 0) {
      if (aArea <= bArea) {
        const nextH = Math.max(a.h, b.y - a.y);
        if (canExpand(a, a.w, nextH, frame)) {
          a.h = nextH;
        } else {
          b.y = a.y + a.h;
        }
      } else {
        b.y = a.y + a.h;
      }
    } else {
      if (bArea <= aArea) {
        const nextH = Math.max(b.h, a.y - b.y);
        if (canExpand(b, b.w, nextH, frame)) {
          b.h = nextH;
        } else {
          a.y = b.y + b.h;
        }
      } else {
        a.y = b.y + b.h;
      }
    }
    const ox = overlapX(a, b);
    if (ox < 0.6) {
      const left = Math.min(a.x, b.x);
      const rightX = Math.max(right(a), right(b));
      if (aArea <= bArea) {
        const nextW = rightX - left;
        if (canExpand(a, nextW, a.h, frame)) {
          a.x = left;
          a.w = nextW;
        } else {
          b.x = cx(a) - b.w / 2;
        }
      } else {
        const nextW = rightX - left;
        if (canExpand(b, nextW, b.h, frame)) {
          b.x = left;
          b.w = nextW;
        } else {
          a.x = cx(b) - a.w / 2;
        }
      }
    }
  }
  clampRoomToBounds(a, house, frame);
  clampRoomToBounds(b, house, frame);
}

function forceShareByShift(a: Room, b: Room, house: House, frame: Bounds) {
  const dx = cx(b) - cx(a);
  const dy = cy(b) - cy(a);
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) b.x = a.x + a.w;
    else a.x = b.x + b.w;
    if (overlapY(a, b) < 0.6) {
      b.y = cy(a) - b.h / 2;
    }
  } else {
    if (dy >= 0) b.y = a.y + a.h;
    else a.y = b.y + b.h;
    if (overlapX(a, b) < 0.6) {
      b.x = cx(a) - b.w / 2;
    }
  }
  clampRoomToBounds(a, house, frame);
  clampRoomToBounds(b, house, frame);
}

function canExpand(room: Room, nextW: number, nextH: number, frame: Bounds) {
  const area = nextW * nextH;
  const min = Math.max(1, room.minArea);
  const areaLimit = min * 2.0;
  const aspect = Math.max(nextW / Math.max(0.01, nextH), nextH / Math.max(0.01, nextW));
  const aspectLimit = room.kind === "corridor" ? 6.0 : 2.4;
  const inFrame = nextW <= frame.w + EPS && nextH <= frame.h + EPS;
  return area <= areaLimit && aspect <= aspectLimit && inFrame;
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

function facingEdge(from: Room, to: Room): Edge | null {
  const dx = cx(to) - cx(from);
  const dy = cy(to) - cy(from);
  const edges = roomEdges(from);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? edges[3] : edges[2];
  }
  return dy >= 0 ? edges[1] : edges[0];
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
