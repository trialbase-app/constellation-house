import { rebuildFabric, resolvePlanOverlaps } from "./planify";
import { enforceMinAreas } from "./roomArea";
import {
  DEFAULT_MODULE_MM,
  isGarden,
  type House,
  type Opening,
  type Room,
  type Wall,
} from "./types";

const EPS = 0.08;

export type OutlineEdge = "left" | "right" | "top" | "bottom";

type Bounds = { x: number; y: number; w: number; h: number };

export function indoorFrame(rooms: Room[]): Bounds | null {
  const indoor = rooms.filter(isIndoor);
  if (indoor.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of indoor) {
    minX = Math.min(minX, room.x);
    minY = Math.min(minY, room.y);
    maxX = Math.max(maxX, right(room));
    maxY = Math.max(maxY, bottom(room));
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function stretchOutline(
  house: House,
  edge: OutlineEdge,
  rawCoord: number,
): { rooms: Room[]; walls: Wall[]; openings: Opening[] } | null {
  if (!house.rooms || house.rooms.length === 0) return null;

  const module = (house.moduleMm || DEFAULT_MODULE_MM) / 1000;
  const oldFrame = indoorFrame(house.rooms);
  if (!oldFrame) return null;

  const rooms = house.rooms.map((room) => ({ ...room }));
  const frame = { ...oldFrame };
  let delta = 0;

  switch (edge) {
    case "left": {
      const newLeft = snapNearest(rawCoord, module);
      delta = frame.x - newLeft;
      if (Math.abs(delta) < module * 0.45) return null;
      frame.x = newLeft;
      frame.w += delta;
      break;
    }
    case "right": {
      const newRight = snapNearest(rawCoord, module);
      delta = newRight - (frame.x + frame.w);
      if (Math.abs(delta) < module * 0.45) return null;
      frame.w += delta;
      break;
    }
    case "top": {
      const newTop = snapNearest(rawCoord, module);
      delta = frame.y - newTop;
      if (Math.abs(delta) < module * 0.45) return null;
      frame.y = newTop;
      frame.h += delta;
      break;
    }
    case "bottom": {
      const newBottom = snapNearest(rawCoord, module);
      delta = newBottom - (frame.y + frame.h);
      if (Math.abs(delta) < module * 0.45) return null;
      frame.h += delta;
      break;
    }
  }

  if (Math.abs(delta) < 1e-6) return null;

  applyEdgeDelta(rooms, oldFrame, edge, delta, house, module);
  enforceMinAreas(rooms, module);
  resolvePlanOverlaps(rooms, house);

  const { walls, openings } = rebuildFabric(rooms, house);
  return { rooms, walls, openings };
}

function applyEdgeDelta(
  rooms: Room[],
  frame: Bounds,
  edge: OutlineEdge,
  delta: number,
  house: House,
  module: number,
) {
  const vertical = edge === "top" || edge === "bottom";
  let edgeRooms = rooms.filter(
    (room) => isIndoor(room) && touchesEdge(room, frame, edge),
  );

  if (vertical) {
    if (edgeRooms.length === 0) {
      edgeRooms = fallbackSideRooms(rooms, frame, edge, house);
    }
    const totalH = edgeRooms.reduce((sum, room) => sum + room.h, 0);
    for (const room of edgeRooms) {
      const share = totalH > 0 ? room.h / totalH : 1 / edgeRooms.length;
      const dh = delta * share;
      if (edge === "bottom") {
        room.h = Math.max(module, room.h + dh);
      } else {
        room.y -= dh;
        room.h = Math.max(module, room.h + dh);
      }
    }
    return;
  }

  const flexEdgeRooms = edgeRooms.filter((room) => !isCorridor(room, house));
  let targets =
    flexEdgeRooms.length > 0 ? flexEdgeRooms : fallbackSideRooms(rooms, frame, edge, house);

  targets = targets.filter((room) => !isCorridor(room, house));
  if (targets.length === 0) return;

  const totalW = targets.reduce((sum, room) => sum + room.w, 0);
  for (const room of targets) {
    const share = totalW > 0 ? room.w / totalW : 1 / targets.length;
    const dw = delta * share;
    if (edge === "right") {
      room.w = Math.max(module, room.w + dw);
    } else {
      room.x -= dw;
      room.w = Math.max(module, room.w + dw);
    }
  }
}

function fallbackSideRooms(
  rooms: Room[],
  frame: Bounds,
  edge: OutlineEdge,
  house: House,
): Room[] {
  const indoor = rooms.filter((room) => isIndoor(room) && !isCorridor(room, house));
  if (indoor.length === 0) return [];

  switch (edge) {
    case "left":
      return indoor.filter((room) => cx(room) <= frame.x + frame.w * 0.5);
    case "right":
      return indoor.filter((room) => cx(room) >= frame.x + frame.w * 0.5);
    case "top":
      return indoor.filter((room) => cy(room) <= frame.y + frame.h * 0.5);
    case "bottom":
      return indoor.filter((room) => cy(room) >= frame.y + frame.h * 0.5);
  }
}

function isIndoor(room: Room): boolean {
  return room.kind !== "garden" && !isGarden(room.name);
}

function isCorridor(room: Room, house: House): boolean {
  const star = house.stars.find((s) => s.id === room.id);
  return star?.roomType === "corridor" || room.kind === "corridor";
}

function touchesEdge(room: Room, frame: Bounds, edge: OutlineEdge): boolean {
  switch (edge) {
    case "left":
      return nearly(room.x, frame.x);
    case "right":
      return nearly(right(room), frame.x + frame.w);
    case "top":
      return nearly(room.y, frame.y);
    case "bottom":
      return nearly(bottom(room), frame.y + frame.h);
  }
}

function snapNearest(n: number, module: number) {
  return Math.round(n / module) * module;
}

function cx(room: Room) {
  return room.x + room.w / 2;
}

function cy(room: Room) {
  return room.y + room.h / 2;
}

function right(room: Room) {
  return room.x + room.w;
}

function bottom(room: Room) {
  return room.y + room.h;
}

function nearly(a: number, b: number) {
  return Math.abs(a - b) < EPS;
}
