import { describe, expect, it } from "vitest";
import { validatePlanify } from "./planValidate";
import {
  DEFAULT_AREA_MARGIN,
  DEFAULT_CORRIDOR_MODULES,
  DEFAULT_DEPARTMENTS,
  DEFAULT_MODULE_MM,
  DEFAULT_SITE,
  type House,
} from "./types";

function makeHouse(
  stars: House["stars"],
  links: House["links"] = [],
  site = DEFAULT_SITE,
): House {
  return {
    site: { ...site },
    siteVisible: true,
    departments: DEFAULT_DEPARTMENTS.map((d) => ({ ...d })),
    stars,
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

describe("validatePlanify", () => {
  it("星がないときは ready=false", () => {
    const result = validatePlanify(makeHouse([]));
    expect(result.ready).toBe(false);
    expect(result.items.some((i) => i.title.includes("星がありません"))).toBe(true);
  });

  it("シンプルな配置では ok になる", () => {
    const result = validatePlanify(
      makeHouse([
        {
          id: "a1",
          name: "居間",
          x: 3,
          y: 5,
          area: 14,
          departmentId: "dep-a",
          roomType: "normal",
        },
        {
          id: "b1",
          name: "台所",
          x: 6,
          y: 9,
          area: 12,
          departmentId: "dep-b",
          roomType: "normal",
        },
      ]),
    );
    expect(result.ready).toBe(true);
    expect(result.items.some((i) => i.level === "error")).toBe(false);
  });

  it("同部門3部屋でも重なりがない", () => {
    const result = validatePlanify(
      makeHouse([
        { id: "a1", name: "部屋1", x: 4, y: 8, area: 12, departmentId: "dep-a", roomType: "normal" },
        { id: "a2", name: "部屋2", x: 6, y: 6, area: 12, departmentId: "dep-a", roomType: "normal" },
        { id: "a3", name: "部屋3", x: 5, y: 4, area: 12, departmentId: "dep-a", roomType: "normal" },
      ]),
    );
    expect(
      result.items.some((i) => i.level === "error" && i.title.includes("重なり")),
    ).toBe(false);
  });

  it("敷地より面積が大きいとき error", () => {
    const result = validatePlanify(
      makeHouse([
        {
          id: "a1",
          name: "大広間",
          x: 5,
          y: 7,
          area: 80,
          departmentId: "dep-a",
          roomType: "normal",
        },
        {
          id: "a2",
          name: "大部屋",
          x: 5,
          y: 4,
          area: 80,
          departmentId: "dep-a",
          roomType: "normal",
        },
      ]),
    );
    expect(result.items.some((i) => i.title.includes("多すぎ"))).toBe(true);
  });
});
