import { findOverlaps, planify } from "./planify";
import { floorStats } from "./planLayout";
import {
  isGarden,
  MIN_AREA,
  starRadius,
  type House,
  type Link,
  type Room,
  type Star,
} from "./types";

const EPS = 0.08;

export type ValidationLevel = "ok" | "warn" | "error";

export type ValidationItem = {
  level: ValidationLevel;
  title: string;
  detail: string;
};

export type PlanifyValidation = {
  /** 図面化ボタンを押してよいか（事前チェックの致命的エラーがない） */
  ready: boolean;
  /** 試しに図面化した結果、問題がないか */
  ok: boolean;
  /** 図面化を実行したが、行き来などを満たせず中止した */
  cancelled?: boolean;
  items: ValidationItem[];
};

export function validatePlanify(house: House): PlanifyValidation {
  const items: ValidationItem[] = [];

  checkStars(house, items);
  checkSiteCapacity(house, items);
  checkStarPositions(house, items);
  checkDepartments(house, items);
  checkLinks(house, items);

  const ready = !items.some((item) => item.level === "error");

  if (!ready) {
    return { ready, ok: false, items };
  }

  checkDryRunPlanify(house, items);

  const ok = !items.some((item) => item.level === "error" || item.level === "warn");
  return { ready, ok, items };
}

function checkStars(house: House, items: ValidationItem[]) {
  if (house.stars.length === 0) {
    items.push({
      level: "error",
      title: "部屋の星がありません",
      detail: "敷地の中をクリックして、1つ以上の星（要求室）を置いてください。",
    });
    return;
  }

  items.push({
    level: "ok",
    title: `部屋の星：${house.stars.length} 個`,
    detail: "図面化の最低条件を満たしています。",
  });

  const indoor = house.stars.filter((star) => !isGarden(star.name));
  if (indoor.length === 0) {
    items.push({
      level: "error",
      title: "室内の部屋がありません",
      detail: "「庭」だけでは図面化できません。居間など室内の星を1つ以上置いてください。",
    });
  }

  const tooSmall = house.stars.filter((star) => star.area < MIN_AREA);
  if (tooSmall.length > 0) {
    items.push({
      level: "warn",
      title: "面積が小さすぎる星があります",
      detail: `${tooSmall.map((s) => s.name).join("、")} は ${MIN_AREA}㎡ 未満です。自動的に ${MIN_AREA}㎡ として扱われます。`,
    });
  }
}

function checkSiteCapacity(house: House, items: ValidationItem[]) {
  const stats = floorStats(house);
  const siteArea = house.site.width * house.site.height;

  items.push({
    level: "ok",
    title: "要求面積の合計",
    detail: `部屋合計 ${fmt(stats.roomSum)}㎡ × 余裕率 ${fmt(stats.margin)} ＝ 必要床面積 約 ${fmt(stats.floorArea)}㎡（グリッド ${stats.moduleMm}mm）。`,
  });

  if (siteArea <= 0) return;

  if (stats.floorArea > siteArea) {
    items.push({
      level: "error",
      title: "敷地に対して部屋が多すぎます",
      detail: `必要床面積 ${fmt(stats.floorArea)}㎡ が、敷地面積 ${fmt(siteArea)}㎡ を超えています。星の数を減らすか、面積を小さくしてください。`,
    });
  } else if (stats.floorArea > siteArea * 0.85) {
    items.push({
      level: "warn",
      title: "敷地がぎりぎりです",
      detail: `必要床面積 ${fmt(stats.floorArea)}㎡ は敷地 ${fmt(siteArea)}㎡ の ${fmt((stats.floorArea / siteArea) * 100)}% です。重なりが出やすい状態です。`,
    });
  } else {
    items.push({
      level: "ok",
      title: "敷地の広さ",
      detail: `建物に割ける面積はおおむね足りています（${fmt((stats.floorArea / siteArea) * 100)}% 使用予定）。`,
    });
  }
}

function checkStarPositions(house: House, items: ValidationItem[]) {
  const outside: Star[] = [];
  for (const star of house.stars) {
    const r = starRadius(star.area);
    if (
      star.x - r < 0 ||
      star.y - r < 0 ||
      star.x + r > house.site.width ||
      star.y + r > house.site.height
    ) {
      outside.push(star);
    }
  }

  if (outside.length > 0) {
    items.push({
      level: "warn",
      title: "敷地の外にかかっている星があります",
      detail: `${outside.map((s) => s.name).join("、")} が敷地枠からはみ出しています。星座ビューで敷地内に移動してください。`,
    });
  }
}

function checkDepartments(house: House, items: ValidationItem[]) {
  const depIds = new Set(house.departments.map((d) => d.id));
  const missing = house.stars.filter((star) => !depIds.has(star.departmentId));

  if (missing.length > 0) {
    items.push({
      level: "warn",
      title: "部門が不明な星があります",
      detail: `${missing.map((s) => s.name).join("、")} に部門色が割り当てられていません。`,
    });
  }

  const byDep = new Map<string, number>();
  for (const star of house.stars.filter((s) => !isGarden(s.name))) {
    byDep.set(star.departmentId, (byDep.get(star.departmentId) ?? 0) + 1);
  }
  const crowded = [...byDep.entries()].filter(([, count]) => count >= 4);
  if (crowded.length > 0) {
    const names = crowded
      .map(([id]) => house.departments.find((d) => d.id === id)?.name ?? id)
      .join("、");
    items.push({
      level: "warn",
      title: "1つの部門に部屋が集中しています",
      detail: `${names} に4室以上あります。同じ色の部屋同士が重なりやすくなります。`,
    });
  }
}

function checkLinks(house: House, items: ValidationItem[]) {
  const starIds = new Set(house.stars.map((s) => s.id));
  const broken = house.links.filter(
    (link) => !starIds.has(link.fromId) || !starIds.has(link.toId),
  );

  if (broken.length > 0) {
    items.push({
      level: "error",
      title: "消えた星につながった線があります",
      detail: "不要な線を削除するか、星を置き直してください。",
    });
  }

  const accessLinks = house.links.filter((link) => link.kind === "access");
  if (accessLinks.length === 0) {
    items.push({
      level: "ok",
      title: "行き来の線",
      detail: "行き来（実線）は未設定です。隣接の強制は行われず、重なりにくい配置になります。",
    });
    return;
  }

  items.push({
    level: "ok",
    title: `行き来の線：${accessLinks.length} 本`,
    detail:
      "図面化では、まず直接隣接を試し、足りなければ長い線から共通廊下でつなぎます。満たせなければ図面化を中止します。",
  });

  const farPairs = accessLinks
    .map((link) => pairForLink(house, link))
    .filter((pair): pair is [Star, Star] => pair !== null)
    .filter(([a, b]) => Math.hypot(a.x - b.x, a.y - b.y) > 8);

  if (farPairs.length > 0) {
    items.push({
      level: "ok",
      title: "離れた行き来があります",
      detail: `${farPairs.map(([a, b]) => `${a.name}↔${b.name}`).join("、")} は星座上で離れています。必要なら廊下でつなぎます。`,
    });
  }
}

function checkDryRunPlanify(house: House, items: ValidationItem[]) {
  let rooms: Room[];
  try {
    const result = planify(house);
    if (!result.ok) {
      items.push({
        level: "error",
        title: "図面化を中止する内容です",
        detail:
          "行き来の線について、部屋を隣同士にすることも、共通の廊下でつなぐこともできませんでした。",
      });
      for (const failure of result.failures) {
        items.push({
          level: "error",
          title:
            failure.fromName && failure.toName
              ? `${failure.fromName} と ${failure.toName}`
              : "配置の失敗",
          detail: failure.detail,
        });
      }
      items.push({
        level: "warn",
        title: "試せること",
        detail:
          "行き来の線を減らす、離れた星を近づける、部門色を分ける、余裕率を下げる、のいずれかを試してください。",
      });
      return;
    }
    rooms = result.rooms;
  } catch (error) {
    items.push({
      level: "error",
      title: "図面化に失敗しました",
      detail: error instanceof Error ? error.message : "不明なエラーが発生しました。",
    });
    return;
  }

  items.push({
    level: "ok",
    title: "試しの図面化",
    detail: `${rooms.length} 個の矩形（部屋・庭・廊下）を配置できました。`,
  });

  const overlaps = findOverlaps(rooms);
  if (overlaps.length > 0) {
    const total = overlaps.reduce((sum, hit) => sum + hit.area, 0);
    const sameDeptHint = overlaps.some((hit) => {
      const a = house.stars.find((s) => s.id === hit.a.id);
      const b = house.stars.find((s) => s.id === hit.b.id);
      return a && b && a.departmentId === b.departmentId && !isGarden(a.name) && !isGarden(b.name);
    });
    items.push({
      level: "error",
      title: `部屋の重なり：${overlaps.length} か所`,
      detail: `${overlaps.map((hit) => `${hit.a.name}×${hit.b.name}(${fmt(hit.area)}㎡)`).join("、")} — 合計 約 ${fmt(total)}㎡。${
        sameDeptHint
          ? "同じ部門色の部屋が多いと重なりやすいです。部門を分けるか、面積を小さくしてみてください。"
          : "部屋数・面積を減らすか、行き来の線を見直してください。"
      }`,
    });
  } else {
    items.push({
      level: "ok",
      title: "部屋の重なりなし",
      detail: "試しの図面化では、部屋同士が重なっていません。",
    });
  }

  const underMin = rooms.filter(
    (room) =>
      (room.kind === "star" || room.kind === "garden") &&
      room.w * room.h + 1e-6 < room.minArea,
  );
  if (underMin.length > 0) {
    items.push({
      level: "warn",
      title: "要求面積を満たせない部屋があります",
      detail: `${underMin.map((r) => `${r.name}(${fmt(r.w * r.h)}㎡/${fmt(r.minArea)}㎡)`).join("、")} — グリッドと敷地の都合で、希望より小さくなる場合があります。`,
    });
  }

  const accessLinks = house.links.filter((link) => link.kind === "access");
  const corridors = rooms.filter((room) => room.kind === "corridor");
  const notConnected = accessLinks
    .map((link) => {
      const pair = pairForLink(house, link);
      if (!pair) return null;
      const [a, b] = pair;
      const roomA = rooms.find((r) => r.id === a.id);
      const roomB = rooms.find((r) => r.id === b.id);
      if (!roomA || !roomB) return null;
      if (roomsShareWall(roomA, roomB)) return null;
      const viaCorridor = corridors.some(
        (c) => roomsShareWall(roomA, c) && roomsShareWall(roomB, c),
      );
      return viaCorridor ? null : `${a.name}↔${b.name}`;
    })
    .filter((label): label is string => label !== null);

  if (notConnected.length > 0) {
    items.push({
      level: "error",
      title: "行き来が図面でつながっていません",
      detail: `${notConnected.join("、")} — 隣接も廊下経由もできていません。星の配置や行き来の線を見直してください。`,
    });
  } else if (accessLinks.length > 0) {
    items.push({
      level: "ok",
      title: "行き来の接続",
      detail: corridors.length > 0
        ? `行き来は隣接または廊下（${corridors.length}本）でつながっています。`
        : "行き来は部屋の隣接でつながっています。",
    });
  }
}

function pairForLink(house: House, link: Link): [Star, Star] | null {
  const from = house.stars.find((s) => s.id === link.fromId);
  const to = house.stars.find((s) => s.id === link.toId);
  if (!from || !to) return null;
  return [from, to];
}

function roomsShareWall(a: Room, b: Room): boolean {
  const yo = overlapY(a, b);
  const xo = overlapX(a, b);
  if (yo > EPS && nearly(a.x + a.w, b.x)) return true;
  if (yo > EPS && nearly(b.x + b.w, a.x)) return true;
  if (xo > EPS && nearly(a.y + a.h, b.y)) return true;
  if (xo > EPS && nearly(b.y + b.h, a.y)) return true;
  return false;
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

function fmt(n: number) {
  return (Math.round(n * 10) / 10).toString();
}
