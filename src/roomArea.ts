import { DEFAULT_MODULE_MM, isGarden, type Room } from "./types";

export function moduleSize(moduleMm: number): number {
  return (moduleMm || DEFAULT_MODULE_MM) / 1000;
}

export function enforceMinAreas(rooms: Room[], module: number) {
  const adjustable = rooms.filter(isAdjustableRoom);
  const byDeficit = adjustable
    .slice()
    .sort(
      (a, b) =>
        Math.max(0, a.minArea - a.w * a.h) - Math.max(0, b.minArea - b.w * b.h),
    );

  for (const room of byDeficit) {
    growRoomToMinAreaSafe(room, rooms, module);
  }
}

/** @deprecated prefer growRoomToMinAreaSafe */
export function growRoomToMinArea(room: Room, module: number) {
  growRoomToMinAreaSafe(room, [room], module);
}

export function growRoomToMinAreaSafe(room: Room, allRooms: Room[], module: number) {
  const minSide = module;
  room.w = Math.max(minSide, room.w);
  room.h = Math.max(minSide, room.h);

  const minArea = Math.max(1, room.minArea);
  const others = allRooms.filter((other) => other.id !== room.id);

  while (room.w * room.h + 1e-6 < minArea) {
    const maxW = maxGrowWidth(room, others, module);
    const maxH = maxGrowHeight(room, others, module);
    const canGrowW = room.w + module <= maxW + 1e-6;
    const canGrowH = room.h + module <= maxH + 1e-6;
    if (!canGrowW && !canGrowH) break;

    if (canGrowW && (!canGrowH || room.w <= room.h)) {
      room.w = Math.min(maxW, room.w + module);
    } else if (canGrowH) {
      room.h = Math.min(maxH, room.h + module);
    } else {
      break;
    }
  }

  if (room.w * room.h + 1e-6 < minArea) {
    const targetW = snapUp(Math.sqrt(minArea * (room.w / Math.max(room.h, module))), module);
    const targetH = snapUp(minArea / Math.max(targetW, module), module);
    room.w = Math.min(maxGrowWidth(room, others, module), Math.max(room.w, targetW));
    room.h = Math.min(maxGrowHeight(room, others, module), Math.max(room.h, targetH));
  }
}

export function minWidthForArea(room: Room, module: number): number {
  const minArea = Math.max(1, room.minArea);
  const h = Math.max(module, room.h);
  return snapUp(Math.max(module, minArea / h), module);
}

export function minHeightForArea(room: Room, module: number): number {
  const minArea = Math.max(1, room.minArea);
  const w = Math.max(module, room.w);
  return snapUp(Math.max(module, minArea / w), module);
}

function maxGrowWidth(room: Room, others: Room[], module: number): number {
  let maxRight = room.x + room.w + module * 80;
  for (const other of others) {
    if (!blocksHorizontalGrow(room, other)) continue;
    if (other.x + other.w <= room.x + module * 0.5) continue;
    if (other.x >= room.x) {
      maxRight = Math.min(maxRight, other.x);
    }
  }
  return Math.max(module, snapDown(maxRight - room.x, module));
}

function maxGrowHeight(room: Room, others: Room[], module: number): number {
  let maxBottom = room.y + room.h + module * 80;
  for (const other of others) {
    if (!blocksVerticalGrow(room, other)) continue;
    if (other.y + other.h <= room.y + module * 0.5) continue;
    if (other.y >= room.y) {
      maxBottom = Math.min(maxBottom, other.y);
    }
  }
  return Math.max(module, snapDown(maxBottom - room.y, module));
}

function blocksHorizontalGrow(a: Room, b: Room): boolean {
  return overlapY(a, b) > 0.01;
}

function blocksVerticalGrow(a: Room, b: Room): boolean {
  return overlapX(a, b) > 0.01;
}

function overlapX(a: Room, b: Room) {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
}

function overlapY(a: Room, b: Room) {
  return Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
}

function isAdjustableRoom(room: Room): boolean {
  return room.kind !== "garden" && !isGarden(room.name);
}

function snapUp(n: number, module: number) {
  return Math.ceil(n / module - 1e-9) * module;
}

function snapDown(n: number, module: number) {
  return Math.max(module, Math.floor(n / module + 1e-9) * module);
}
