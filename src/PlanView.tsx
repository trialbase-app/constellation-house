import {
  DEFAULT_MODULE_MM,
  ROAD_DEPTH,
  isGarden,
  type House,
  type Opening,
  type Wall,
} from "./types";
import { floorStats } from "./planLayout";

const MARGIN = 1.2;

export function PlanView({ house }: { house: House }) {
  const siteW = house.site.width;
  const siteH = house.site.height;
  const showSite = house.siteVisible;
  const module = (house.moduleMm || DEFAULT_MODULE_MM) / 1000;
  const rooms = house.rooms;
  const walls = house.walls ?? [];
  const openings = house.openings ?? [];
  const stale = Boolean(rooms && house.planStale);
  const starById = new Map(house.stars.map((s) => [s.id, s]));
  const colorByDepartment = new Map(
    house.departments.map((d) => [d.id, d.color]),
  );

  const bounds = planBounds(house, showSite);
  const vbW = bounds.w + MARGIN * 2;
  const vbH = bounds.h + (showSite ? ROAD_DEPTH : 0) + MARGIN * 2;
  const vbX = bounds.x - MARGIN;
  const vbY = bounds.y - MARGIN;

  const stats = floorStats(house);
  const siteArea = siteW * siteH;
  const coverage =
    siteArea > 0 ? (stats.floorArea / siteArea) * 100 : 0;

  return (
    <svg
      className={stale ? "plan stale-plan" : "plan"}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
    >
      <defs>
        <pattern
          id="garden-hatch"
          width="0.35"
          height="0.35"
          patternUnits="userSpaceOnUse"
        >
          <path d="M0 0.35 L0.35 0" stroke="#8aa37a" strokeWidth="0.03" />
        </pattern>
        <pattern
          id="module-grid"
          width={module}
          height={module}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${module} 0 L 0 0 0 ${module}`}
            fill="none"
            stroke="#d5cdc0"
            strokeWidth={0.025}
          />
        </pattern>
      </defs>

      {showSite ? (
        <>
          <rect
            x={0}
            y={siteH}
            width={siteW}
            height={ROAD_DEPTH}
            fill="#d9d3c8"
          />
          <text
            x={siteW / 2}
            y={siteH + ROAD_DEPTH / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            className="label-road"
          >
            道路
          </text>
          <rect
            x={0}
            y={0}
            width={siteW}
            height={siteH}
            fill="#fbf7f0"
            stroke="#b7ae9f"
            strokeWidth={0.04}
            strokeDasharray="0.18 0.12"
          />
          <rect
            x={0}
            y={0}
            width={siteW}
            height={siteH}
            fill="url(#module-grid)"
          />
        </>
      ) : (
        <rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.w}
          height={bounds.h}
          fill="#fbf7f0"
        />
      )}

      {!showSite && rooms ? (
        <rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.w}
          height={bounds.h}
          fill="url(#module-grid)"
        />
      ) : null}

      {!rooms ? (
        <text
          x={(showSite ? siteW : bounds.w) / 2}
          y={(showSite ? siteH : bounds.h) / 2}
          textAnchor="middle"
          className="label-empty"
        >
          図面化を押すと、ここに間取りが出ます
        </text>
      ) : (
        <>
          {rooms.map((room) => (
            <g key={room.id}>
              <rect
                x={room.x}
                y={room.y}
                width={room.w}
                height={room.h}
                fill={
                  room.kind === "corridor"
                    ? "#ebe5da"
                    : isGarden(room.name)
                        ? "url(#garden-hatch)"
                        : colorByDepartment.get(starById.get(room.id)?.departmentId ?? "") ?? "#f4ead8"
                }
                stroke="none"
              />
              {isGarden(room.name) ? (
                <rect
                  x={room.x}
                  y={room.y}
                  width={room.w}
                  height={room.h}
                  fill="#d7e4cc"
                  opacity={0.45}
                  stroke="none"
                />
              ) : null}
            </g>
          ))}

          {walls.map((wall) => (
            <line
              key={wall.id}
              x1={wall.x1}
              y1={wall.y1}
              x2={wall.x2}
              y2={wall.y2}
              stroke="#2c2924"
              strokeWidth={wallWidth(wall)}
              strokeLinecap="square"
              strokeDasharray={wall.kind === "fence" ? "0.12 0.1" : undefined}
            />
          ))}

          {openings.map((opening) => (
            <OpeningMark key={opening.id} opening={opening} />
          ))}

          {rooms.map((room) => (
            <g key={`${room.id}-label`}>
              <text
                x={room.x + room.w / 2}
                y={room.y + room.h / 2 - 0.12}
                textAnchor="middle"
                className="label-star"
              >
                {room.kind === "corridor" ? "廊下" : room.name}
              </text>
              <text
                x={room.x + room.w / 2}
                y={room.y + room.h / 2 + 0.28}
                textAnchor="middle"
                className="label-area"
              >
                {(room.w * room.h).toFixed(0)}㎡
              </text>
            </g>
          ))}
        </>
      )}

      {showSite && stats.roomSum > 0 ? (
        <text
          x={siteW / 2}
          y={-0.45}
          textAnchor="middle"
          className="label-coverage"
        >
          建蔽率 {coverage.toFixed(1)}%（床 {stats.floorArea.toFixed(1)}㎡ / 敷地{" "}
          {siteArea.toFixed(1)}㎡）
        </text>
      ) : null}
    </svg>
  );
}

function planBounds(house: House, showSite: boolean) {
  if (showSite) {
    return { x: 0, y: 0, w: house.site.width, h: house.site.height };
  }
  const rooms = house.rooms;
  if (!rooms || rooms.length === 0) {
    return { x: 0, y: 0, w: 10, h: 10 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of rooms) {
    minX = Math.min(minX, room.x);
    minY = Math.min(minY, room.y);
    maxX = Math.max(maxX, room.x + room.w);
    maxY = Math.max(maxY, room.y + room.h);
  }
  const pad = 0.5;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

function wallWidth(wall: Wall) {
  if (wall.kind === "exterior") return 0.16;
  if (wall.kind === "interior") return 0.08;
  return 0.045;
}

function OpeningMark({ opening }: { opening: Opening }) {
  const span = Math.hypot(opening.x2 - opening.x1, opening.y2 - opening.y1);
  const dx = opening.x2 - opening.x1;
  const dy = opening.y2 - opening.y1;
  const nx = span === 0 ? 0 : -dy / span;
  const ny = span === 0 ? 0 : dx / span;

  if (opening.kind === "window") {
    const o = 0.05;
    return (
      <g>
        <line
          x1={opening.x1 + nx * o}
          y1={opening.y1 + ny * o}
          x2={opening.x2 + nx * o}
          y2={opening.y2 + ny * o}
          stroke="#2c2924"
          strokeWidth={0.035}
        />
        <line
          x1={opening.x1 - nx * o}
          y1={opening.y1 - ny * o}
          x2={opening.x2 - nx * o}
          y2={opening.y2 - ny * o}
          stroke="#2c2924"
          strokeWidth={0.035}
        />
      </g>
    );
  }

  // 扉は円弧ではなく、開口両端の縦棒（｜　｜）表記
  const tick = 0.22;
  return (
    <g>
      <line
        x1={opening.x1 + nx * tick}
        y1={opening.y1 + ny * tick}
        x2={opening.x1 - nx * tick}
        y2={opening.y1 - ny * tick}
        stroke="#2c2924"
        strokeWidth={0.07}
        strokeLinecap="square"
      />
      <line
        x1={opening.x2 + nx * tick}
        y1={opening.y2 + ny * tick}
        x2={opening.x2 - nx * tick}
        y2={opening.y2 - ny * tick}
        stroke="#2c2924"
        strokeWidth={0.07}
        strokeLinecap="square"
      />
    </g>
  );
}
