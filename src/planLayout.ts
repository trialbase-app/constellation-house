import {
  DEFAULT_AREA_MARGIN,
  DEFAULT_MODULE_MM,
  MIN_AREA,
  isGarden,
  type House,
  type Room,
  type Star,
} from "./types";

const PADDING = 0.2;

type Rect = { x: number; y: number; w: number; h: number };

type Item = {
  star: Star;
  minArea: number;
};

export function layoutRooms(house: House): Room[] {
  const module = (house.moduleMm || DEFAULT_MODULE_MM) / 1000;
  const indoorStars = house.stars.filter((s) => !isGarden(s.name));
  const gardenStars = house.stars.filter((s) => isGarden(s.name));

  const indoor = indoorStars.length
    ? partitionBuilding(house, indoorStars, module)
    : [];
  const gardens = placeGardens(house, gardenStars, indoor, module);
  return [...indoor, ...gardens];
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

function partitionBuilding(house: House, stars: Star[], module: number): Room[] {
  const items: Item[] = stars.map((star) => ({
    star,
    minArea: Math.max(MIN_AREA, star.area),
  }));
  const stats = floorStats(house);
  const aspect = aspectFromStars(stars);
  const footprint = fitFootprint(house, stats.floorArea, aspect, module, stars);
  return splitRect(footprint, items, house, module);
}

function aspectFromStars(stars: Star[]) {
  if (stars.length === 0) return 1;
  const xs = stars.map((s) => s.x);
  const ys = stars.map((s) => s.y);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const h = Math.max(...ys) - Math.min(...ys) + 1;
  return clamp(w / h, 0.55, 1.8);
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
  x = Math.max(0, x);
  y = Math.max(0, y);
  return { x, y, w, h };
}

function splitRect(
  rect: Rect,
  items: Item[],
  house: House,
  module: number,
): Room[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    const item = items[0];
    return [
      {
        id: item.star.id,
        name: item.star.name,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        minArea: item.minArea,
      },
    ];
  }

  const vertical = chooseAxis(rect, items);
  const { leftItems, rightItems, split } = chooseSplit(
    rect,
    items,
    house,
    vertical,
    module,
  );
  if (split == null) {
    return items.map((_, index) => stackFallback(rect, items, index, module));
  }

  const leftRect = vertical
    ? { x: rect.x, y: rect.y, w: split - rect.x, h: rect.h }
    : { x: rect.x, y: rect.y, w: rect.w, h: split - rect.y };
  const rightRect = vertical
    ? { x: split, y: rect.y, w: rect.x + rect.w - split, h: rect.h }
    : { x: rect.x, y: split, w: rect.w, h: rect.y + rect.h - split };

  return [
    ...splitRect(leftRect, leftItems, house, module),
    ...splitRect(rightRect, rightItems, house, module),
  ];
}

function chooseAxis(rect: Rect, items: Item[]) {
  const xs = items.map((i) => i.star.x);
  const ys = items.map((i) => i.star.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  if (spreadX > spreadY + 0.4) return true;
  if (spreadY > spreadX + 0.4) return false;
  return rect.w >= rect.h;
}

function chooseSplit(
  rect: Rect,
  items: Item[],
  house: House,
  vertical: boolean,
  module: number,
) {
  const axis = vertical ? "x" : "y" as const;
  const sorted = [...items].sort(
    (a, b) => a.star[axis] - b.star[axis] || a.star.id.localeCompare(b.star.id),
  );
  const total = sumMin(sorted);
  const span = vertical ? rect.w : rect.h;
  const modules = Math.max(2, Math.round(span / module));

  let bestK = 1;
  let bestScore = Infinity;
  for (let k = 1; k < sorted.length; k++) {
    const leftMin = sumMin(sorted.slice(0, k));
    const frac = leftMin / total;
    const cuts = countCutLinks(sorted.slice(0, k), sorted.slice(k), house);
    const score = Math.abs(frac - 0.5) + cuts * 0.35;
    if (score < bestScore) {
      bestScore = score;
      bestK = k;
    }
  }

  const leftItems = sorted.slice(0, bestK);
  const rightItems = sorted.slice(bestK);
  const frac = sumMin(leftItems) / total;
  let kMod = Math.round(modules * frac);
  kMod = clamp(kMod, 1, modules - 1);

  const minLeft = vertical
    ? sumMin(leftItems) / rect.h
    : sumMin(leftItems) / rect.w;
  const minRight = vertical
    ? sumMin(rightItems) / rect.h
    : sumMin(rightItems) / rect.w;

  const origin = vertical ? rect.x : rect.y;
  for (let shift = 0; shift < modules; shift++) {
    for (const dir of [0, 1, -1] as const) {
      const tryK = kMod + dir * shift;
      if (tryK < 1 || tryK > modules - 1) continue;
      const split = origin + tryK * module;
      const leftSpan = tryK * module;
      const rightSpan = span - leftSpan;
      if (leftSpan + 1e-6 >= minLeft && rightSpan + 1e-6 >= minRight) {
        return { leftItems, rightItems, split };
      }
    }
  }

  const split = origin + kMod * module;
  if (split <= origin + 0.01 || split >= origin + span - 0.01) {
    return { leftItems, rightItems, split: null as number | null };
  }
  return { leftItems, rightItems, split };
}

function stackFallback(
  rect: Rect,
  items: Item[],
  index: number,
  module: number,
): Room {
  const item = items[index];
  const n = items.length;
  const h = Math.max(module, rect.h / n);
  return {
    id: item.star.id,
    name: item.star.name,
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

function placeGardens(
  house: House,
  gardenStars: Star[],
  indoor: Room[],
  module: number,
): Room[] {
  return gardenStars.map((star) => {
    const minArea = Math.max(MIN_AREA, star.area);
    const neighbor =
      indoor.find((room) =>
        house.links.some(
          (l) =>
            l.kind === "access" &&
            ((l.fromId === star.id && l.toId === room.id) ||
              (l.toId === star.id && l.fromId === room.id)),
        ),
      ) ?? nearestRoom(star, indoor);

    if (!neighbor) {
      const side = Math.max(module, snapUp(Math.sqrt(minArea), module));
      let x = clamp(snapNearest(star.x - side / 2, module), PADDING, house.site.width - side - PADDING);
      let y = clamp(snapNearest(star.y - side / 2, module), PADDING, house.site.height - side - PADDING);
      return { id: star.id, name: star.name, x, y, w: side, h: side, minArea };
    }

    const dx = star.x - (neighbor.x + neighbor.w / 2);
    const dy = star.y - (neighbor.y + neighbor.h / 2);
    if (Math.abs(dx) >= Math.abs(dy)) {
      const h = Math.max(module, snapUp(neighbor.h, module));
      const w = Math.max(module, snapUp(minArea / h, module));
      const x = dx >= 0 ? neighbor.x + neighbor.w : neighbor.x - w;
      const y = neighbor.y;
      return clampGarden({ id: star.id, name: star.name, x, y, w, h, minArea }, house);
    }
    const w = Math.max(module, snapUp(neighbor.w, module));
    const h = Math.max(module, snapUp(minArea / w, module));
    const x = neighbor.x;
    const y = dy >= 0 ? neighbor.y + neighbor.h : neighbor.y - h;
    return clampGarden({ id: star.id, name: star.name, x, y, w, h, minArea }, house);
  });
}

function nearestRoom(star: Star, rooms: Room[]) {
  if (rooms.length === 0) return null;
  return rooms.slice().sort((a, b) => {
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
