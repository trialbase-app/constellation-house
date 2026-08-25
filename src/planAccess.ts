import {
  AREA_MAX_FACTOR,
  DEFAULT_CORRIDOR_MODULES,
  distance,
  newId,
  type House,
  type Link,
  type Room,
  type Star,
} from "./types";
import { moduleSize } from "./roomArea";

const EPS = 0.08;
const TOUCH = 0.55;

export type AccessFailure = {
  linkId: string;
  fromName: string;
  toName: string;
  detail: string;
};

type Bounds = { x: number; y: number; w: number; h: number };

/**
 * ⑤: 行き来を満たす。
 * まず全リンクを直接隣接で試し、不成立なら星距離の長い線から共通廊下へ切り替える。
 */
export function resolveAccessRelations(
  rooms: Room[],
  house: House,
  frame: Bounds,
  helpers: {
    forceSeparate: () => void;
    growAreas: () => void;
    cloneRooms: (source: Room[]) => Room[];
    restoreRooms: (target: Room[], source: Room[]) => void;
  },
): { ok: true } | { ok: false; failures: AccessFailure[] } {
  const accessLinks = house.links.filter((link) => link.kind === "access");
  if (accessLinks.length === 0) {
    helpers.forceSeparate();
    helpers.growAreas();
    return { ok: true };
  }

  const baseline = helpers.cloneRooms(rooms);
  const sortedByLength = [...accessLinks].sort((a, b) => {
    const da = linkStarDistance(house, a);
    const db = linkStarDistance(house, b);
    return db - da;
  });

  const corridorSet = new Set<string>();
  const attempts: Array<Set<string>> = [new Set()];
  for (const link of sortedByLength) {
    const next = new Set(corridorSet);
    next.add(link.id);
    corridorSet.add(link.id);
    attempts.push(new Set(next));
  }

  let lastFailures: AccessFailure[] = describeFailures(
    accessLinks,
    rooms,
    house,
    new Set(),
  );

  for (const viaCorridor of attempts) {
    helpers.restoreRooms(rooms, baseline);
    const placed = applyAttempt(rooms, house, frame, viaCorridor);
    if (!placed) {
      lastFailures = describeFailures(accessLinks, rooms, house, viaCorridor);
      continue;
    }

    // 重なり解消と再接続を数回繰り返す（引き離しで隣接が壊れないように）
    for (let repair = 0; repair < 6; repair++) {
      helpers.forceSeparate();
      helpers.growAreas();
      reattachDirectLinks(rooms, house, viaCorridor);
      attachCorridorContacts(rooms, house, viaCorridor);
      if (
        findOverlapsSimple(rooms).length === 0 &&
        allAccessSatisfied(accessLinks, rooms, house, viaCorridor)
      ) {
        break;
      }
    }

    if (findOverlapsSimple(rooms).length > 0) {
      lastFailures = [
        {
          linkId: "",
          fromName: "",
          toName: "",
          detail: "部屋同士の重なりを解消できませんでした。",
        },
      ];
      continue;
    }

    if (!allAccessSatisfied(accessLinks, rooms, house, viaCorridor)) {
      lastFailures = describeFailures(accessLinks, rooms, house, viaCorridor);
      continue;
    }

    if (!allRoomsInSite(rooms, house) || !areasWithinBounds(rooms)) {
      lastFailures = describeFailures(accessLinks, rooms, house, viaCorridor);
      continue;
    }

    return { ok: true };
  }

  return {
    ok: false,
    failures: lastFailures.filter((f) => f.fromName || f.detail),
  };
}

function applyAttempt(
  rooms: Room[],
  house: House,
  frame: Bounds,
  viaCorridor: Set<string>,
): boolean {
  const module = moduleSize(house.moduleMm);
  const corridorW =
    (house.corridorModules || DEFAULT_CORRIDOR_MODULES) * module;

  const directLinks = house.links.filter(
    (link) => link.kind === "access" && !viaCorridor.has(link.id),
  );
  const corridorLinks = house.links.filter(
    (link) => link.kind === "access" && viaCorridor.has(link.id),
  );

  // ハブ部屋から順に、空いている辺へ付ける（同じ辺に押し込めない）
  const degree = accessDegreeMap(directLinks);
  const ordered = orderLinksForPlacement(directLinks, house);
  for (let pass = 0; pass < 12; pass++) {
    let progressed = false;
    for (const link of ordered) {
      const pair = roomsForLink(rooms, house, link);
      if (!pair) continue;
      const [a, b] = pair;
      if (roomsShareWall(a, b)) continue;
      if (attachPairKeepingHub(a, b, rooms, house, module, degree)) {
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  if (corridorLinks.length > 0) {
    const connectIds = new Set<string>();
    for (const link of corridorLinks) {
      connectIds.add(link.fromId);
      connectIds.add(link.toId);
    }
    const corridor = insertSharedCorridor(
      rooms,
      house,
      frame,
      corridorW,
      connectIds,
    );
    if (!corridor) return false;
    attachCorridorContacts(rooms, house, viaCorridor);
  }

  return true;
}

function reattachDirectLinks(
  rooms: Room[],
  house: House,
  viaCorridor: Set<string>,
) {
  const module = moduleSize(house.moduleMm);
  const directLinks = house.links.filter(
    (link) => link.kind === "access" && !viaCorridor.has(link.id),
  );
  const degree = accessDegreeMap(directLinks);
  for (const link of orderLinksForPlacement(directLinks, house)) {
    const pair = roomsForLink(rooms, house, link);
    if (!pair) continue;
    const [a, b] = pair;
    if (roomsShareWall(a, b)) continue;
    attachPairKeepingHub(a, b, rooms, house, module, degree);
  }
}

/** 接続が多い方を固定し、少ない方を空いている辺へ付ける */
function attachPairKeepingHub(
  a: Room,
  b: Room,
  rooms: Room[],
  house: House,
  module: number,
  degree: Map<string, number>,
): boolean {
  const da = degree.get(a.id) ?? 0;
  const db = degree.get(b.id) ?? 0;
  // すでに多くの隣を持つ部屋も錨にする
  const neighborsA = countAccessNeighbors(a, rooms, house);
  const neighborsB = countAccessNeighbors(b, rooms, house);
  const scoreA = da * 10 + neighborsA;
  const scoreB = db * 10 + neighborsB;

  if (scoreA >= scoreB) {
    return (
      attachOnBestSide(a, b, rooms, house, module) ||
      attachOnBestSide(b, a, rooms, house, module)
    );
  }
  return (
    attachOnBestSide(b, a, rooms, house, module) ||
    attachOnBestSide(a, b, rooms, house, module)
  );
}

function accessDegreeMap(links: Link[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.fromId, (degree.get(link.fromId) ?? 0) + 1);
    degree.set(link.toId, (degree.get(link.toId) ?? 0) + 1);
  }
  return degree;
}

function countAccessNeighbors(room: Room, rooms: Room[], house: House): number {
  let n = 0;
  for (const link of house.links) {
    if (link.kind !== "access") continue;
    const otherId =
      link.fromId === room.id
        ? link.toId
        : link.toId === room.id
          ? link.fromId
          : null;
    if (!otherId) continue;
    const other = rooms.find((r) => r.id === otherId);
    if (other && roomsShareWall(room, other)) n += 1;
  }
  return n;
}

function attachCorridorContacts(
  rooms: Room[],
  house: House,
  viaCorridor: Set<string>,
) {
  if (viaCorridor.size === 0) return;
  const module = moduleSize(house.moduleMm);
  const corridors = rooms.filter((r) => r.kind === "corridor");
  if (corridors.length === 0) return;

  const connectIds = new Set<string>();
  for (const link of house.links) {
    if (!viaCorridor.has(link.id)) continue;
    connectIds.add(link.fromId);
    connectIds.add(link.toId);
  }

  for (const id of connectIds) {
    const room = rooms.find((r) => r.id === id && r.kind === "star");
    if (!room) continue;
    if (corridors.some((c) => roomsShareWall(room, c))) continue;
    for (const corridor of corridors) {
      if (attachOnBestSide(corridor, room, rooms, house, module)) break;
      if (nudgeRoomToCorridor(room, corridor, house, module)) break;
    }
  }
}

/** 接続数の多い部屋に関する線を先に処理する */
function orderLinksForPlacement(links: Link[], house: House): Link[] {
  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.fromId, (degree.get(link.fromId) ?? 0) + 1);
    degree.set(link.toId, (degree.get(link.toId) ?? 0) + 1);
  }
  return [...links].sort((a, b) => {
    const da = Math.max(degree.get(a.fromId) ?? 0, degree.get(a.toId) ?? 0);
    const db = Math.max(degree.get(b.fromId) ?? 0, degree.get(b.toId) ?? 0);
    if (db !== da) return db - da;
    return linkStarDistance(house, a) - linkStarDistance(house, b);
  });
}

/**
 * movable を anchor の上下左右の空いている辺に付け、他室との重なりが最小の位置を選ぶ。
 */
function attachOnBestSide(
  anchor: Room,
  movable: Room,
  rooms: Room[],
  house: House,
  module: number,
): boolean {
  const saved = { ...movable };
  type Cand = { score: number; state: Room };
  const candidates: Cand[] = [];

  const placements: Array<() => void> = [
    () => {
      // 右
      movable.x = right(anchor);
      movable.y = snapNearest(cy(anchor) - movable.h / 2, module);
      alignSpan(anchor, movable, "y");
    },
    () => {
      // 左
      movable.x = anchor.x - movable.w;
      movable.y = snapNearest(cy(anchor) - movable.h / 2, module);
      alignSpan(anchor, movable, "y");
    },
    () => {
      // 下
      movable.y = bottom(anchor);
      movable.x = snapNearest(cx(anchor) - movable.w / 2, module);
      alignSpan(anchor, movable, "x");
    },
    () => {
      // 上
      movable.y = anchor.y - movable.h;
      movable.x = snapNearest(cx(anchor) - movable.w / 2, module);
      alignSpan(anchor, movable, "x");
    },
  ];

  for (const place of placements) {
    Object.assign(movable, saved);
    place();
    clampToSite(movable, house);
    if (movable.w * movable.h + 1e-6 < movable.minArea) continue;
    if (!roomsShareWall(anchor, movable)) continue;

    let overlapPenalty = 0;
    for (const other of rooms) {
      if (other.id === movable.id || other.id === anchor.id) continue;
      if (other.kind === "garden") continue;
      const ox = overlapX(movable, other);
      const oy = overlapY(movable, other);
      if (ox > EPS && oy > EPS) overlapPenalty += ox * oy;
    }

    // 星の相対位置に近いほど加点
    const starA = house.stars.find((s) => s.id === anchor.id);
    const starB = house.stars.find((s) => s.id === movable.id);
    let orientBonus = 0;
    if (starA && starB) {
      const wantDx = starB.x - starA.x;
      const wantDy = starB.y - starA.y;
      const gotDx = cx(movable) - cx(anchor);
      const gotDy = cy(movable) - cy(anchor);
      if (wantDx * gotDx > 0) orientBonus += 1;
      if (wantDy * gotDy > 0) orientBonus += 1;
    }

    candidates.push({
      score: orientBonus * 2 - overlapPenalty * 40,
      state: { ...movable },
    });
  }

  if (candidates.length === 0) {
    Object.assign(movable, saved);
    return false;
  }

  candidates.sort((a, b) => b.score - a.score);
  const noOverlap = candidates.filter(
    (c) => !hasOverlapFromState(c.state, anchor, rooms),
  );
  const chosen = (noOverlap.length > 0 ? noOverlap : candidates)[0];
  Object.assign(movable, chosen.state);
  return roomsShareWall(anchor, movable);
}

function hasOverlapFromState(state: Room, anchor: Room, rooms: Room[]): boolean {
  for (const other of rooms) {
    if (other.id === state.id || other.id === anchor.id) continue;
    if (other.kind === "garden") continue;
    if (overlapX(state, other) > EPS && overlapY(state, other) > EPS) return true;
  }
  return false;
}

function alignSpan(a: Room, b: Room, axis: "x" | "y") {
  if (axis === "y") {
    const top = Math.max(a.y, b.y);
    const bot = Math.min(bottom(a), bottom(b));
    if (bot - top >= TOUCH) return;
    // 共有辺が短すぎるとき、movable 側をずらして最低タッチを確保
    const need = TOUCH;
    const mid = (Math.min(a.y, b.y) + Math.max(bottom(a), bottom(b))) / 2;
    b.y = mid - b.h / 2;
    const t0 = Math.max(a.y, b.y);
    const t1 = Math.min(bottom(a), bottom(b));
    if (t1 - t0 >= need) return;
    b.y = a.y;
    if (b.h > a.h) b.h = a.h;
    return;
  }

  const left = Math.max(a.x, b.x);
  const rightX = Math.min(right(a), right(b));
  if (rightX - left >= TOUCH) return;
  b.x = a.x;
  if (b.w > a.w) b.w = a.w;
}

function insertSharedCorridor(
  rooms: Room[],
  house: House,
  frame: Bounds,
  corridorW: number,
  connectIds: Set<string>,
): Room | null {
  const module = moduleSize(house.moduleMm);
  const stars = rooms.filter((r) => r.kind === "star");
  if (stars.length === 0) return null;

  const horizontal = frame.w >= frame.h;
  let corridor: Room;

  if (horizontal) {
    let y = snapNearest(frame.y + frame.h / 2 - corridorW / 2, module);
    y = clamp(y, frame.y, frame.y + frame.h - corridorW);
    corridor = {
      id: newId("corridor"),
      name: "廊下",
      kind: "corridor",
      x: frame.x,
      y,
      w: frame.w,
      h: corridorW,
      minArea: corridorW * module,
    };
  } else {
    let x = snapNearest(frame.x + frame.w / 2 - corridorW / 2, module);
    x = clamp(x, frame.x, frame.x + frame.w - corridorW);
    corridor = {
      id: newId("corridor"),
      name: "廊下",
      kind: "corridor",
      x,
      y: frame.y,
      w: corridorW,
      h: frame.h,
      minArea: corridorW * module,
    };
  }

  for (const room of stars) {
    if (!carveRoomForCorridor(room, corridor, module)) {
      return null;
    }
  }

  // 接続対象が廊下に届くよう、廊下面を部屋側に寄せる補助
  for (const id of connectIds) {
    const room = rooms.find((r) => r.id === id && r.kind === "star");
    if (!room) continue;
    if (roomsShareWall(room, corridor)) continue;
    if (!nudgeRoomToCorridor(room, corridor, house, module)) {
      return null;
    }
  }

  rooms.push(corridor);
  return corridor;
}

function carveRoomForCorridor(room: Room, corridor: Room, module: number): boolean {
  if (room.kind !== "star") return true;

  const ox = overlapX(room, corridor);
  const oy = overlapY(room, corridor);
  if (ox <= EPS || oy <= EPS) return true;

  if (corridor.w >= corridor.h) {
    // 水平廊下: 上下に残す
    const above = corridor.y - room.y;
    const below = bottom(room) - bottom(corridor);
    if (above >= below && above >= module) {
      room.h = Math.max(module, corridor.y - room.y);
    } else if (below >= module) {
      const newY = bottom(corridor);
      room.h = Math.max(module, bottom(room) - newY);
      room.y = newY;
    } else {
      return false;
    }
  } else {
    const left = corridor.x - room.x;
    const rightGap = right(room) - right(corridor);
    if (left >= rightGap && left >= module) {
      room.w = Math.max(module, corridor.x - room.x);
    } else if (rightGap >= module) {
      const newX = right(corridor);
      room.w = Math.max(module, right(room) - newX);
      room.x = newX;
    } else {
      return false;
    }
  }

  return room.w * room.h + 1e-6 >= room.minArea;
}

function nudgeRoomToCorridor(
  room: Room,
  corridor: Room,
  house: House,
  module: number,
): boolean {
  if (corridor.w >= corridor.h) {
    // 水平廊下 → 上下どちらかに付ける
    if (cy(room) <= cy(corridor)) {
      room.h = Math.max(module, corridor.y - room.y);
      if (room.h < module) {
        room.y = corridor.y - Math.max(module, room.h);
        room.h = Math.max(module, corridor.y - room.y);
      }
    } else {
      room.y = bottom(corridor);
      room.h = Math.max(module, room.h);
    }
    // 廊下面と横方向が重なるよう寄せる
    if (overlapX(room, corridor) < TOUCH) {
      room.x = clamp(room.x, corridor.x, corridor.x + corridor.w - room.w);
      if (room.w > corridor.w) {
        room.w = corridor.w;
        room.x = corridor.x;
      }
    }
  } else {
    if (cx(room) <= cx(corridor)) {
      room.w = Math.max(module, corridor.x - room.x);
    } else {
      room.x = right(corridor);
      room.w = Math.max(module, room.w);
    }
    if (overlapY(room, corridor) < TOUCH) {
      room.y = clamp(room.y, corridor.y, corridor.y + corridor.h - room.h);
      if (room.h > corridor.h) {
        room.h = corridor.h;
        room.y = corridor.y;
      }
    }
  }

  clampToSite(room, house);
  return room.w * room.h + 1e-6 >= room.minArea && roomsShareWall(room, corridor);
}

export function accessSatisfied(
  a: Room,
  b: Room,
  rooms: Room[],
  viaCorridor: boolean,
): boolean {
  if (roomsShareWall(a, b)) return true;
  if (!viaCorridor) return false;
  const corridors = rooms.filter((r) => r.kind === "corridor");
  return corridors.some((c) => roomsShareWall(a, c) && roomsShareWall(b, c));
}

function allAccessSatisfied(
  links: Link[],
  rooms: Room[],
  house: House,
  viaCorridor: Set<string>,
): boolean {
  for (const link of links) {
    const pair = roomsForLink(rooms, house, link);
    if (!pair) return false;
    if (!accessSatisfied(pair[0], pair[1], rooms, viaCorridor.has(link.id))) {
      return false;
    }
  }
  return true;
}

function describeFailures(
  links: Link[],
  rooms: Room[],
  house: House,
  viaCorridor: Set<string>,
): AccessFailure[] {
  const failures: AccessFailure[] = [];
  for (const link of links) {
    const stars = starPair(house, link);
    if (!stars) continue;
    const [from, to] = stars;
    const pair = roomsForLink(rooms, house, link);
    if (!pair) {
      failures.push({
        linkId: link.id,
        fromName: from.name,
        toName: to.name,
        detail: `${from.name} — ${to.name} の部屋が見つかりません。`,
      });
      continue;
    }
    if (!accessSatisfied(pair[0], pair[1], rooms, viaCorridor.has(link.id))) {
      const useCorridor = viaCorridor.has(link.id);
      failures.push({
        linkId: link.id,
        fromName: from.name,
        toName: to.name,
        detail: useCorridor
          ? `${from.name}と${to.name}を、共通の廊下に両方とも面させる配置が作れませんでした（面積を守りつつ削ると届かない状態です）。`
          : `${from.name}と${to.name}を、壁を共有する隣同士の部屋として置けませんでした。`,
      });
    }
  }
  return failures;
}

function roomsForLink(
  rooms: Room[],
  _house: House,
  link: Link,
): [Room, Room] | null {
  const a = rooms.find((r) => r.id === link.fromId);
  const b = rooms.find((r) => r.id === link.toId);
  if (!a || !b) return null;
  return [a, b];
}

function starPair(house: House, link: Link): [Star, Star] | null {
  const from = house.stars.find((s) => s.id === link.fromId);
  const to = house.stars.find((s) => s.id === link.toId);
  if (!from || !to) return null;
  return [from, to];
}

function linkStarDistance(house: House, link: Link): number {
  const pair = starPair(house, link);
  if (!pair) return 0;
  return distance(pair[0], pair[1]);
}

export function roomsShareWall(a: Room, b: Room): boolean {
  const yo = overlapY(a, b);
  const xo = overlapX(a, b);
  if (yo > EPS && nearly(a.x + a.w, b.x)) return true;
  if (yo > EPS && nearly(b.x + b.w, a.x)) return true;
  if (xo > EPS && nearly(a.y + a.h, b.y)) return true;
  if (xo > EPS && nearly(b.y + b.h, a.y)) return true;
  return false;
}

function findOverlapsSimple(rooms: Room[]): Array<{ a: Room; b: Room }> {
  const hits: Array<{ a: Room; b: Room }> = [];
  const target = rooms.filter(
    (r) => r.kind === "star" || r.kind === "garden" || r.kind === "corridor",
  );
  for (let i = 0; i < target.length; i++) {
    for (let j = i + 1; j < target.length; j++) {
      const a = target[i];
      const b = target[j];
      if (overlapX(a, b) > EPS && overlapY(a, b) > EPS) hits.push({ a, b });
    }
  }
  return hits;
}

function allRoomsInSite(rooms: Room[], house: House): boolean {
  for (const room of rooms) {
    if (room.kind === "garden") continue;
    if (room.x < -EPS || room.y < -EPS) return false;
    if (right(room) > house.site.width + EPS) return false;
    if (bottom(room) > house.site.height + EPS) return false;
  }
  return true;
}

function areasWithinBounds(rooms: Room[]): boolean {
  for (const room of rooms) {
    if (room.kind !== "star") continue;
    const area = room.w * room.h;
    // 下限は目標面積。上限2倍は⑦の増やす側の目安で、初期割り付け超過は許容する
    if (area + 1e-6 < room.minArea) return false;
  }
  return true;
}

/** ⑥: 面積を保ちつつ縦横比を変える */
export function adjustRoomAspect(room: Room, module: number, preferWide: boolean) {
  const area = Math.max(room.minArea, room.w * room.h);
  const maxArea = room.minArea * AREA_MAX_FACTOR;
  const target = Math.min(maxArea, area);
  if (preferWide) {
    const nextW = snapUp(Math.sqrt(target * 1.4), module);
    const nextH = snapUp(target / nextW, module);
    room.w = Math.max(module, nextW);
    room.h = Math.max(module, nextH);
  } else {
    const nextH = snapUp(Math.sqrt(target * 1.4), module);
    const nextW = snapUp(target / nextH, module);
    room.w = Math.max(module, nextW);
    room.h = Math.max(module, nextH);
  }
}

function clampToSite(room: Room, house: House) {
  room.w = Math.min(room.w, house.site.width);
  room.h = Math.min(room.h, house.site.height);
  room.x = clamp(room.x, 0, Math.max(0, house.site.width - room.w));
  room.y = clamp(room.y, 0, Math.max(0, house.site.height - room.h));
}

function overlapX(a: Room, b: Room) {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
}

function overlapY(a: Room, b: Room) {
  return Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
}

function nearly(a: number, b: number) {
  return Math.abs(a - b) < EPS;
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

function snapNearest(n: number, module: number) {
  return Math.round(n / module) * module;
}

function snapUp(n: number, module: number) {
  return Math.ceil(n / module - 1e-9) * module;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
