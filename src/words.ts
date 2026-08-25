import { distance, roomTypeLabel, type House } from "./types";
import { floorStats } from "./planLayout";

export function describeHouse(house: House): string[] {
  const lines: string[] = [];

  if (house.siteVisible) {
    lines.push(
      `敷地は 縦 ${house.site.height}m × 横 ${house.site.width}m。道路は南側。`,
    );
  } else {
    lines.push("敷地枠は非表示です。");
  }

  if (house.stars.length === 0) {
    lines.push("まだ部屋の星はありません。敷地の中に星を置いてください。");
    return lines;
  }

  const stats = floorStats(house);
  if (stats.roomSum > 0) {
    lines.push(
      `部屋の合計 ${formatNum(stats.roomSum)}㎡ × 余裕率 ${formatNum(stats.margin)} ＝ 床面積 ${formatNum(stats.floorArea)}㎡。グリッドは ${stats.moduleMm}mm。廊下幅はモジュール ${house.corridorModules} 個。`,
    );
    lines.push(
      "図面化は、部門ごとに部屋を置き、行き来を隣接または共通廊下でつなぎます。",
    );
    if (house.siteVisible) {
      const siteArea = house.site.width * house.site.height;
      const coverage = siteArea > 0 ? (stats.floorArea / siteArea) * 100 : 0;
      lines.push(
        `建蔽率 ${formatNum(coverage)}%（床面積 ${formatNum(stats.floorArea)}㎡ ÷ 敷地面積 ${formatNum(siteArea)}㎡）。`,
      );
    }
  }

  for (const star of house.stars) {
    const typeLabel = roomTypeLabel(star.roomType);
    const room =
      house.rooms && !house.planStale
        ? house.rooms.find((r) => r.id === star.id)
        : undefined;
    if (room) {
      lines.push(
        `${star.name}（${typeLabel}）の広さは ${formatNum(star.area)}㎡以上（図面 ${formatNum(room.w * room.h)}㎡）。`,
      );
    } else {
      lines.push(`${star.name}（${typeLabel}）の広さは ${formatNum(star.area)}㎡以上。`);
    }
  }

  for (const link of house.links) {
    if (link.kind !== "access") continue;
    const from = house.stars.find((s) => s.id === link.fromId);
    const to = house.stars.find((s) => s.id === link.toId);
    if (!from || !to) continue;
    lines.push(
      `${from.name}と${to.name}は行き来できる（${formatNum(distance(from, to))}m）。`,
    );
  }

  return lines;
}

function formatNum(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
