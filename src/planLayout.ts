import {
  DEFAULT_AREA_MARGIN,
  DEFAULT_MODULE_MM,
  MIN_AREA,
  isGarden,
  type House,
  type Room,
  type Star,
} from "./types";

type Rect = { x: number; y: number; w: number; h: number };
type Side = "negative" | "positive";

type Item = {
  star: Star;
  minArea: number;
};

type Spine = {
  horizontal: boolean;
  center: number;
};

const PADDING = 0;

export function layoutRooms(house: House): Room[] {
  const module = (house.moduleMm || DEFAULT_MODULE_MM) / 1000;
  const indoorStars = house.stars.filter((s) => !isGarden(s.name));
  const gardenStars = house.stars.filter((s) => isGarden(s.name));

  if (indoorStars.length === 0) {
    return placeGardens(house, gardenStars, [], module);
  }

  const { starRooms, autoRooms } = layoutBuilding(house, indoorStars, module);
  const gardens = placeGardens(house, gardenStars, starRooms, module);
  return [...starRooms, ...autoRooms, ...gardens];
}

export function floorStats(house: House) {
  const indoor = house.stars.filter((s) => !isGarden(s.name));
  const roomSum = indoor.reduce((sum, s) => sum + Math.max(MIN_AREA, s.area), 0);
  const margin = house.areaMargin || DEFAULT_AREA_MARGIN;
  return {
    roomSum,
    margin,
    floorArea: roomSum * margin,
    moduleMm: house.moduleMm || DEFAULT_MODULE_MM,
  };
}

function layoutBuilding(house: House, stars: Star[], module: number) {
  const stats = floorStats(house);
  const footprint = fitFootprint(house, stats.floorArea, aspectFromStars(stars), module, stars);
  const spine = makeSpine(footprint, stars, module);

  const sideRects = getSideRects(footprint, spine);
  const depGroups = groupByDepartment(stars);
  const depBySide = splitDepartmentsBySide(depGroups, spine, house);

  const rectByDepartment = new Map<string, Rect>();
  for (const side of ["negative", "positive"] as const) {
    const sideDepartments = depBySide.get(side) ?? [];
    const sideRect = sideRects[side];
    for (const [depId, rect] of allocateDepartmentRects(sideRect, sideDepartments, spine, module)) {
      rectByDepartment.set(depId, rect);
    }
  }

  const starRooms: Room[] = [];
  for (const dep of depGroups) {
    const rect = rectByDepartment.get(dep.departmentId);
    if (!rect) continue;
    const items = dep.stars.map((star) => ({ star, minArea: Math.max(MIN_AREA, star.area) }));
    starRooms.push(...splitRect(rect, items, house, module));
  }

  const autoRooms: Room[] = [];

  return { starRooms, autoRooms };
}

function aspectFromStars(stars: Star[]) {
  if (stars.length === 0) return 1;
  const xs = stars.map((s) => s.x);
  const ys = stars.map((s) => s.y);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const h = Math.max(...ys) - Math.min(...ys) + 1;
  return clamp(w / h, 0.5, 2.0);
}

function fitFootprint(
  house: House,
  floorArea: number,
  aspect: number,
  module: number,
  stars: Star[],
): Rect {
  const maxW = snapDown(house.site.width, module);
  const maxH = snapDown(house.site.height, module);
  let h = Math.sqrt(floorArea / aspect);
  let w = floorArea / h;
  w = clamp(snapUp(w, module), module, maxW);
  h = clamp(snapUp(floorArea / w, module), module, maxH);

  while (w * h + 0.01 < floorArea) {
    if (w <= h && w + module <= maxW) w += module;
    else if (h + module <= maxH) h += module;
    else if (w + module <= maxW) w += module;
    else break;
  }

  const cx = average(stars.map((s) => s.x));
  const cy = average(stars.map((s) => s.y));
  let x = snapNearest(cx - w / 2, module);
  let y = snapNearest(cy - h / 2, module);
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + w > house.site.width) x = snapDown(house.site.width - w, module);
  if (y + h > house.site.height) y = snapDown(house.site.height - h, module);

  return { x: Math.max(0, x), y: Math.max(0, y), w, h };
}

function makeSpine(footprint: Rect, stars: Star[], module: number): Spine {
  const spreadX = spread(stars.map((s) => s.x));
  const spreadY = spread(stars.map((s) => s.y));
  const horizontal = spreadX >= spreadY;
  const center = horizontal
    ? average(stars.map((s) => s.y))
    : average(stars.map((s) => s.x));

  if (horizontal) {
    let y = snapNearest(center, module);
    y = clamp(y, footprint.y + module, footprint.y + footprint.h - module);
    return {
      horizontal,
      center: y,
    };
  }

  let x = snapNearest(center, module);
  x = clamp(x, footprint.x + module, footprint.x + footprint.w - module);
  return {
    horizontal,
    center: x,
  };
}

function getSideRects(footprint: Rect, spine: Spine): Record<Side, Rect> {
  if (spine.horizontal) {
    const negative: Rect = {
      x: footprint.x,
      y: footprint.y,
      w: footprint.w,
      h: Math.max(0, spine.center - footprint.y),
    };
    const positive: Rect = {
      x: footprint.x,
      y: spine.center,
      w: footprint.w,
      h: Math.max(0, footprint.y + footprint.h - spine.center),
    };
    return { negative, positive };
  }

  const negative: Rect = {
    x: footprint.x,
    y: footprint.y,
    w: Math.max(0, spine.center - footprint.x),
    h: footprint.h,
  };
  const positive: Rect = {
    x: spine.center,
    y: footprint.y,
    w: Math.max(0, footprint.x + footprint.w - spine.center),
    h: footprint.h,
  };
  return { negative, positive };
}

function groupByDepartment(stars: Star[]) {
  const map = new Map<string, { departmentId: string; stars: Star[]; area: number }>();
  for (const star of stars) {
    const departmentId = star.departmentId || "dep-a";
    const group = map.get(departmentId) ?? { departmentId, stars: [], area: 0 };
    group.stars.push(star);
    group.area += Math.max(MIN_AREA, star.area);
    map.set(departmentId, group);
  }
  return [...map.values()];
}

function splitDepartmentsBySide(
  groups: { departmentId: string; stars: Star[]; area: number }[],
  spine: Spine,
  house: House,
) {
  const bySide = new Map<Side, { departmentId: string; stars: Star[]; area: number }[]>([
    ["negative", []],
    ["positive", []],
  ]);
  for (const group of groups) {
    const centroid = average(
      group.stars.map((s) => (spine.horizontal ? s.y : s.x)),
    );
    const side: Side = centroid < spine.center ? "negative" : "positive";
    bySide.get(side)?.push(group);
  }

  if ((bySide.get("negative")?.length ?? 0) === 0 && (bySide.get("positive")?.length ?? 0) > 1) {
    const moved = bySide.get("positive")?.shift();
    if (moved) bySide.get("negative")?.push(moved);
  }
  if ((bySide.get("positive")?.length ?? 0) === 0 && (bySide.get("negative")?.length ?? 0) > 1) {
    const moved = bySide.get("negative")?.pop();
    if (moved) bySide.get("positive")?.push(moved);
  }

  for (const side of ["negative", "positive"] as const) {
    bySide.get(side)?.sort((a, b) => {
      const pa = average(a.stars.map((s) => (spine.horizontal ? s.x : s.y)));
      const pb = average(b.stars.map((s) => (spine.horizontal ? s.x : s.y)));
      return pa - pb;
    });
  }

  // 実線リンクで異なる部門が強く結ばれている場合は、
  // 部門の左右固定を少し緩めて同じ側に寄せる。
  alignSidesByAccess(bySide, house);

  return bySide;
}

function alignSidesByAccess(
  bySide: Map<Side, { departmentId: string; stars: Star[]; area: number }[]>,
  house: House,
) {
  const sideOf = new Map<string, Side>();
  for (const side of ["negative", "positive"] as const) {
    for (const group of bySide.get(side) ?? []) {
      sideOf.set(group.departmentId, side);
    }
  }

  const starById = new Map(house.stars.map((s) => [s.id, s]));
  const pairCount = new Map<string, number>();
  for (const link of house.links) {
    if (link.kind !== "access") continue;
    const a = starById.get(link.fromId);
    const b = starById.get(link.toId);
    if (!a || !b) continue;
    if (a.departmentId === b.departmentId) continue;
    const key = [a.departmentId, b.departmentId].sort().join("|");
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }

  for (const [key, count] of pairCount) {
    if (count < 2) continue;
    const [depA, depB] = key.split("|");
    const sideA = sideOf.get(depA);
    const sideB = sideOf.get(depB);
    if (!sideA || !sideB || sideA === sideB) continue;

    const a = findGroup(bySide, depA);
    const b = findGroup(bySide, depB);
    if (!a || !b) continue;

    // 小さい方を、大きい方の側へ移す
    const moveDep = a.area <= b.area ? a.departmentId : b.departmentId;
    const toSide = a.area <= b.area ? sideB : sideA;
    const fromSide = toSide === "negative" ? "positive" : "negative";
    const fromArr = bySide.get(fromSide) ?? [];
    const idx = fromArr.findIndex((g) => g.departmentId === moveDep);
    if (idx >= 0) {
      const [moved] = fromArr.splice(idx, 1);
      (bySide.get(toSide) ?? []).push(moved);
      sideOf.set(moveDep, toSide);
    }
  }

  for (const side of ["negative", "positive"] as const) {
    bySide.get(side)?.sort((a, b) => {
      const pa = average(a.stars.map((s) => s.x));
      const pb = average(b.stars.map((s) => s.x));
      return pa - pb;
    });
  }
}

function findGroup(
  bySide: Map<Side, { departmentId: string; stars: Star[]; area: number }[]>,
  departmentId: string,
) {
  for (const side of ["negative", "positive"] as const) {
    const found = (bySide.get(side) ?? []).find((g) => g.departmentId === departmentId);
    if (found) return found;
  }
  return null;
}

function allocateDepartmentRects(
  sideRect: Rect,
  groups: { departmentId: string; stars: Star[]; area: number }[],
  spine: Spine,
  module: number,
) {
  const result = new Map<string, Rect>();
  if (groups.length === 0 || sideRect.w <= 0 || sideRect.h <= 0) return result;

  const alongLength = spine.horizontal ? sideRect.w : sideRect.h;
  const totalArea = groups.reduce((sum, g) => sum + g.area, 0);
  let cursor = spine.horizontal ? sideRect.x : sideRect.y;
  const end = cursor + alongLength;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const remaining = groups.length - i;
    const isLast = i === groups.length - 1;
    let span = alongLength / groups.length;
    if (!isLast) {
      span = (group.area / totalArea) * alongLength;
      span = snapUp(span, module);
      const maxSpan = end - cursor - module * (remaining - 1);
      span = clamp(span, module, Math.max(module, maxSpan));
    } else {
      span = end - cursor;
    }

    const rect = spine.horizontal
      ? { x: cursor, y: sideRect.y, w: span, h: sideRect.h }
      : { x: sideRect.x, y: cursor, w: sideRect.w, h: span };
    result.set(group.departmentId, rect);
    cursor += span;
  }
  return result;
}

function splitRect(rect: Rect, items: Item[], house: House, module: number): Room[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    const item = items[0];
    return [
      {
        id: item.star.id,
        name: item.star.name,
        kind: "star",
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        minArea: item.minArea,
      },
    ];
  }

  const vertical = chooseAxis(rect, items);
  const { leftItems, rightItems, split } = chooseSplit(rect, items, house, vertical, module);
  if (split == null) return items.map((_, index) => stackFallback(rect, items, index, module));

  const leftRect = vertical
    ? { x: rect.x, y: rect.y, w: split - rect.x, h: rect.h }
    : { x: rect.x, y: rect.y, w: rect.w, h: split - rect.y };
  const rightRect = vertical
    ? { x: split, y: rect.y, w: rect.x + rect.w - split, h: rect.h }
    : { x: rect.x, y: split, w: rect.w, h: rect.y + rect.h - split };

  return [...splitRect(leftRect, leftItems, house, module), ...splitRect(rightRect, rightItems, house, module)];
}

function chooseAxis(rect: Rect, items: Item[]) {
  const spreadX = spread(items.map((i) => i.star.x));
  const spreadY = spread(items.map((i) => i.star.y));
  if (spreadX > spreadY + 0.3) return true;
  if (spreadY > spreadX + 0.3) return false;
  return rect.w >= rect.h;
}

function chooseSplit(rect: Rect, items: Item[], house: House, vertical: boolean, module: number) {
  const axis = vertical ? "x" : "y";
  const sorted = [...items].sort(
    (a, b) => (a.star as any)[axis] - (b.star as any)[axis] || a.star.id.localeCompare(b.star.id),
  );
  const total = sumMin(sorted);
  const span = vertical ? rect.w : rect.h;
  const modules = Math.max(2, Math.round(span / module));

  let bestK = 1;
  let bestScore = Infinity;
  for (let k = 1; k < sorted.length; k++) {
    const left = sorted.slice(0, k);
    const right = sorted.slice(k);
    const frac = sumMin(left) / total;
    const cuts = countCutLinks(left, right, house);
    const score = Math.abs(frac - 0.5) + cuts * 0.35;
    if (score < bestScore) {
      bestScore = score;
      bestK = k;
    }
  }

  const leftItems = sorted.slice(0, bestK);
  const rightItems = sorted.slice(bestK);
  let splitK = clamp(Math.round((sumMin(leftItems) / total) * modules), 1, modules - 1);
  const origin = vertical ? rect.x : rect.y;
  let split = origin + splitK * module;
  split = clamp(split, origin + module, origin + span - module);
  return { leftItems, rightItems, split };
}

function stackFallback(rect: Rect, items: Item[], index: number, module: number): Room {
  const item = items[index];
  const n = items.length;
  const h = Math.max(module, rect.h / n);
  return {
    id: item.star.id,
    name: item.star.name,
    kind: "star",
    x: rect.x,
    y: rect.y + index * h,
    w: rect.w,
    h: index === n - 1 ? rect.y + rect.h - (rect.y + index * h) : h,
    minArea: item.minArea,
  };
}

function countCutLinks(left: Item[], right: Item[], house: House) {
  const leftIds = new Set(left.map((i) => i.star.id));
  const rightIds = new Set(right.map((i) => i.star.id));
  let n = 0;
  for (const link of house.links) {
    if (link.kind !== "access") continue;
    if (
      (leftIds.has(link.fromId) && rightIds.has(link.toId)) ||
      (leftIds.has(link.toId) && rightIds.has(link.fromId))
    ) {
      n += 1;
    }
  }
  return n;
}

function placeGardens(house: House, gardenStars: Star[], indoor: Room[], module: number): Room[] {
  return gardenStars.map((star) => {
    const minArea = Math.max(MIN_AREA, star.area);
    const neighbor =
      indoor.find((room) =>
        house.links.some(
          (l) =>
            l.kind === "access" &&
            ((l.fromId === star.id && l.toId === room.id) || (l.toId === star.id && l.fromId === room.id)),
        ),
      ) ?? nearestRoom(star, indoor);

    if (!neighbor) {
      const side = Math.max(module, snapUp(Math.sqrt(minArea), module));
      const x = clamp(snapNearest(star.x - side / 2, module), PADDING, house.site.width - side - PADDING);
      const y = clamp(snapNearest(star.y - side / 2, module), PADDING, house.site.height - side - PADDING);
      return { id: star.id, name: star.name, kind: "garden", x, y, w: side, h: side, minArea };
    }

    const dx = star.x - (neighbor.x + neighbor.w / 2);
    const dy = star.y - (neighbor.y + neighbor.h / 2);
    if (Math.abs(dx) >= Math.abs(dy)) {
      const h = Math.max(module, snapUp(neighbor.h, module));
      const w = Math.max(module, snapUp(minArea / h, module));
      const x = dx >= 0 ? neighbor.x + neighbor.w : neighbor.x - w;
      const y = neighbor.y;
      return clampGarden({ id: star.id, name: star.name, kind: "garden", x, y, w, h, minArea }, house);
    }
    const w = Math.max(module, snapUp(neighbor.w, module));
    const h = Math.max(module, snapUp(minArea / w, module));
    const x = neighbor.x;
    const y = dy >= 0 ? neighbor.y + neighbor.h : neighbor.y - h;
    return clampGarden({ id: star.id, name: star.name, kind: "garden", x, y, w, h, minArea }, house);
  });
}

function nearestRoom(star: Star, rooms: Room[]) {
  if (rooms.length === 0) return null;
  return rooms
    .slice()
    .sort((a, b) => {
      const da = Math.hypot(star.x - (a.x + a.w / 2), star.y - (a.y + a.h / 2));
      const db = Math.hypot(star.x - (b.x + b.w / 2), star.y - (b.y + b.h / 2));
      return da - db;
    })[0];
}

function clampGarden(room: Room, house: House): Room {
  const w = Math.min(room.w, house.site.width - PADDING * 2);
  const h = Math.min(room.h, house.site.height - PADDING * 2);
  const x = clamp(room.x, PADDING, house.site.width - w - PADDING);
  const y = clamp(room.y, PADDING, house.site.height - h - PADDING);
  return { ...room, x, y, w, h };
}

function sumMin(items: Item[]) {
  return items.reduce((sum, item) => sum + item.minArea, 0);
}

function spread(ns: number[]) {
  if (ns.length === 0) return 0;
  return Math.max(...ns) - Math.min(...ns);
}

function snapNearest(n: number, module: number) {
  return Math.round(n / module) * module;
}
function snapUp(n: number, module: number) {
  return Math.ceil(n / module - 1e-9) * module;
}
function snapDown(n: number, module: number) {
  return Math.max(module, Math.floor(n / module + 1e-9) * module);
}
function average(ns: number[]) {
  if (ns.length === 0) return 0;
  return ns.reduce((a, b) => a + b, 0) / ns.length;
}
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
