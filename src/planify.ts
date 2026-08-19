import {
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

export function planify(house: House): {
  rooms: Room[];
  walls: Wall[];
  openings: Opening[];
} {
  const rooms = layoutRooms(house);
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

  const entry = pickEntrance(indoor, house);
  if (entry) {
    const south = {
      x1: entry.x,
      y1: bottom(entry),
      x2: right(entry),
      y2: bottom(entry),
      inwardX: 0,
      inwardY: -1,
    };
    const blocked = indoor.some(
      (other) => other.id !== entry.id && sharedWall(entry, other)?.dir === "h" && nearly(sharedWall(entry, other)!.y, bottom(entry)),
    );
    const edge = blocked ? southMostExterior(entry, indoor) : south;
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

function pickEntrance(indoor: Room[], house: House): Room | null {
  if (indoor.length === 0) return null;
  const named = indoor.find((r) => r.name.includes("玄関"));
  if (named) return named;
  return indoor.slice().sort((a, b) => bottom(b) - bottom(a) || Math.abs(cx(a) - house.site.width / 2) - Math.abs(cx(b) - house.site.width / 2))[0];
}

function southMostExterior(room: Room, indoor: Room[]): Edge | null {
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
  return edges.slice().sort((a, b) => (a.y1 + a.y2) / 2 - (b.y1 + b.y2) / 2).reverse()[0];
}

function colinearTouch(opening: Opening, edge: Edge) {
  if (horizontal(edge) && nearly(opening.y1, edge.y1) && nearly(opening.y2, edge.y1)) return true;
  if (!horizontal(edge) && nearly(opening.x1, edge.x1) && nearly(opening.x2, edge.x1)) return true;
  return false;
}

function horizontal(edge: { y1: number; y2: number }) {
  return nearly(edge.y1, edge.y2);
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
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
