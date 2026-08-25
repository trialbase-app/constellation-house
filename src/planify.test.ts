import { describe, expect, it } from "vitest";
import { findOverlaps, planify } from "./planify";
import { layoutRooms } from "./planLayout";
import { enforceMinAreas, moduleSize } from "./roomArea";
import { indoorFrame, stretchOutline } from "./planStretch";
import {
  DEFAULT_AREA_MARGIN,
  DEFAULT_CORRIDOR_MODULES,
  DEFAULT_DEPARTMENTS,
  DEFAULT_MODULE_MM,
  DEFAULT_SITE,
  type House,
  type Link,
  type Room,
  type Star,
} from "./types";

type StarInput = Pick<Star, "id" | "name" | "x" | "y" | "area" | "departmentId"> &
  Partial<Pick<Star, "roomType">>;

function makeHouse(stars: StarInput[], links: Link[] = []): House {
  return {
    site: { ...DEFAULT_SITE },
    siteVisible: true,
    departments: DEFAULT_DEPARTMENTS.map((d) => ({ ...d })),
    stars: stars.map((s) => ({
      roomType: "normal" as const,
      ...s,
    })),
    links,
    rooms: null,
    walls: null,
    openings: null,
    planStale: false,
    areaMargin: DEFAULT_AREA_MARGIN,
    moduleMm: DEFAULT_MODULE_MM,
    corridorModules: DEFAULT_CORRIDOR_MODULES,
  };
}

function totalOverlapArea(rooms: Room[]) {
  return findOverlaps(rooms).reduce((sum, hit) => sum + hit.area, 0);
}

function expectPlanOk(house: House) {
  const result = planify(house);
  expect(result.ok).toBe(true);
  if (!result.ok) return null;
  expect(totalOverlapArea(result.rooms)).toBe(0);
  return result;
}

describe("findOverlaps", () => {
  it("重なりがないとき空配列を返す", () => {
    const house = makeHouse([
      { id: "a1", name: "居間", x: 2, y: 4, area: 12, departmentId: "dep-a" },
      { id: "b1", name: "台所", x: 6, y: 8, area: 12, departmentId: "dep-b" },
    ]);
    const rooms = layoutRooms(house);
    enforceMinAreas(rooms, moduleSize(house.moduleMm));
    expect(findOverlaps(rooms)).toHaveLength(0);
  });
});

describe("planify simple chain", () => {
  it("3部屋の直列行き来は成功する", () => {
    const house = makeHouse(
      [
        { id: "1", name: "部屋1", x: 8, y: 10, area: 12, departmentId: "dep-a" },
        { id: "2", name: "部屋2", x: 5, y: 6, area: 12, departmentId: "dep-a" },
        { id: "3", name: "部屋3", x: 5, y: 14, area: 12, departmentId: "dep-a" },
      ],
      [
        { id: "l1", fromId: "2", toId: "1", kind: "access" },
        { id: "l2", fromId: "1", toId: "3", kind: "access" },
      ],
    );
    house.site = { width: 20, height: 20 };
    const result = planify(house);
    expect(result.ok).toBe(true);
  });

  it("中心1部屋に3方向の行き来は成功する", () => {
    const house = makeHouse(
      [
        { id: "1", name: "部屋1", x: 8, y: 12, area: 12, departmentId: "dep-b" },
        { id: "2", name: "部屋2", x: 14, y: 12, area: 12, departmentId: "dep-b" },
        { id: "3", name: "部屋3", x: 14, y: 6, area: 12, departmentId: "dep-b" },
        { id: "4", name: "部屋4", x: 14, y: 18, area: 12, departmentId: "dep-b" },
      ],
      [
        { id: "l1", fromId: "1", toId: "2", kind: "access" },
        { id: "l2", fromId: "3", toId: "2", kind: "access" },
        { id: "l3", fromId: "4", toId: "2", kind: "access" },
      ],
    );
    house.site = { width: 50, height: 50 };
    const result = planify(house);
    expect(result.ok).toBe(true);
  });
});

describe("planify overlap resolution", () => {
  it("初期配置と最小面積適用後は重なりがない", () => {
    const house = makeHouse([
      { id: "a1", name: "居間", x: 2, y: 4, area: 12, departmentId: "dep-a" },
      { id: "a2", name: "寝室", x: 6, y: 4, area: 12, departmentId: "dep-a" },
      { id: "b1", name: "台所", x: 4, y: 9, area: 12, departmentId: "dep-b" },
    ]);
    const rooms = layoutRooms(house);
    enforceMinAreas(rooms, moduleSize(house.moduleMm));
    expect(totalOverlapArea(rooms)).toBe(0);
  });

  it("行き来リンクがある配置でも重なりがない", () => {
    const house = makeHouse(
      [
        { id: "ent", name: "玄関", x: 5, y: 12, area: 8, departmentId: "dep-a", roomType: "entrance" },
        { id: "liv", name: "居間", x: 5, y: 7, area: 16, departmentId: "dep-a" },
        { id: "kit", name: "台所", x: 2, y: 7, area: 14, departmentId: "dep-b" },
        { id: "bed", name: "寝室", x: 8, y: 4, area: 12, departmentId: "dep-c" },
        { id: "bath", name: "浴室", x: 2, y: 4, area: 10, departmentId: "dep-b" },
      ],
      [
        { id: "l1", fromId: "ent", toId: "liv", kind: "access" },
        { id: "l2", fromId: "liv", toId: "kit", kind: "access" },
        { id: "l3", fromId: "liv", toId: "bed", kind: "access" },
        { id: "l4", fromId: "kit", toId: "bath", kind: "access" },
      ],
    );

    const result = expectPlanOk(house);
    expect(result).not.toBeNull();
  });

  it("行き来がすべて隣接か廊下でつながる", () => {
    const house = makeHouse(
      [
        { id: "a", name: "居間", x: 2, y: 4, area: 12, departmentId: "dep-a" },
        { id: "b", name: "寝室", x: 8, y: 12, area: 12, departmentId: "dep-b" },
      ],
      [{ id: "l1", fromId: "a", toId: "b", kind: "access" }],
    );
    const result = expectPlanOk(house);
    expect(result).not.toBeNull();
    if (!result) return;
    const ra = result.rooms.find((r) => r.id === "a");
    const rb = result.rooms.find((r) => r.id === "b");
    expect(ra && rb).toBeTruthy();
    const corridors = result.rooms.filter((r) => r.kind === "corridor");
    const direct =
      ra &&
      rb &&
      ((Math.abs(ra.x + ra.w - rb.x) < 0.1 &&
        Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y) > 0.08) ||
        (Math.abs(rb.x + rb.w - ra.x) < 0.1 &&
          Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y) > 0.08) ||
        (Math.abs(ra.y + ra.h - rb.y) < 0.1 &&
          Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x) > 0.08) ||
        (Math.abs(rb.y + rb.h - ra.y) < 0.1 &&
          Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x) > 0.08));
    const via =
      corridors.length > 0 &&
      ra &&
      rb &&
      corridors.some((c) => {
        const touch = (room: Room, corr: Room) => {
          const yo = Math.min(room.y + room.h, corr.y + corr.h) - Math.max(room.y, corr.y);
          const xo = Math.min(room.x + room.w, corr.x + corr.w) - Math.max(room.x, corr.x);
          return (
            (yo > 0.08 && Math.abs(room.x + room.w - corr.x) < 0.1) ||
            (yo > 0.08 && Math.abs(corr.x + corr.w - room.x) < 0.1) ||
            (xo > 0.08 && Math.abs(room.y + room.h - corr.y) < 0.1) ||
            (xo > 0.08 && Math.abs(corr.y + corr.h - room.y) < 0.1)
          );
        };
        return touch(ra, c) && touch(rb, c);
      });
    expect(direct || via).toBe(true);
  });

  it("同部門2部屋の配置でも重なりがない", () => {
    const house = makeHouse([
      { id: "a1", name: "居間", x: 3, y: 5, area: 14, departmentId: "dep-a" },
      { id: "a2", name: "寝室", x: 7, y: 5, area: 12, departmentId: "dep-a" },
      { id: "b1", name: "台所", x: 4, y: 9, area: 12, departmentId: "dep-b" },
    ]);

    expectPlanOk(house);
  });
});

describe("stretchOutline overlap resolution", () => {
  it("外枠を伸ばしたあとも重なりがない", () => {
    const house = makeHouse([
      { id: "a1", name: "居間", x: 3, y: 5, area: 14, departmentId: "dep-a" },
      { id: "a2", name: "寝室", x: 7, y: 5, area: 12, departmentId: "dep-a" },
      { id: "b1", name: "台所", x: 4, y: 9, area: 12, departmentId: "dep-b" },
    ]);

    const planned = expectPlanOk(house);
    expect(planned).not.toBeNull();
    if (!planned) return;

    const frame = indoorFrame(planned.rooms);
    expect(frame).not.toBeNull();

    const stretched = stretchOutline(
      {
        ...house,
        rooms: planned.rooms,
        walls: planned.walls,
        openings: planned.openings,
      },
      "right",
      frame!.x + frame!.w + 1.8,
    );

    expect(stretched).not.toBeNull();
    expect(totalOverlapArea(stretched!.rooms)).toBe(0);
  });
});
