import { useRef, type PointerEvent } from "react";
import {
  DEFAULT_AREA,
  ROAD_DEPTH,
  distance,
  isGarden,
  starRadius,
  type House,
  type Mode,
} from "./types";

const MARGIN = 1.2;

type Props = {
  house: House;
  mode: Mode;
  selectedStarId: string | null;
  selectedLinkId: string | null;
  linkFromId: string | null;
  onPlace: (x: number, y: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, area: number) => void;
  onStarClick: (id: string) => void;
  onLinkClick: (id: string) => void;
  onBackground: () => void;
};

export function ConstellationView({
  house,
  mode,
  selectedStarId,
  selectedLinkId,
  linkFromId,
  onPlace,
  onMove,
  onResize,
  onStarClick,
  onLinkClick,
  onBackground,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    id: string;
    kind: "move" | "resize";
    startArea: number;
    startR: number;
  } | null>(null);

  const showSite = house.siteVisible;
  const vbW = house.site.width + MARGIN * 2;
  const vbH = house.site.height + (showSite ? ROAD_DEPTH : 0) + MARGIN * 2;

  function toLocal(e: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const loc = pt.matrixTransform(ctm.inverse());
    return { x: loc.x, y: loc.y };
  }

  function clampStar(x: number, y: number, r: number) {
    return {
      x: Math.min(house.site.width - r * 0.2, Math.max(r * 0.2, x)),
      y: Math.min(house.site.height - r * 0.2, Math.max(r * 0.2, y)),
    };
  }

  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    const p = toLocal(e);
    if (!p) return;
    const target = e.target as SVGElement;
    const handleId = target.dataset.resize;
    const starId = target.dataset.star;
    const linkId = target.dataset.link;

    if (handleId) {
      const star = house.stars.find((s) => s.id === handleId);
      if (!star) return;
      drag.current = {
        id: handleId,
        kind: "resize",
        startArea: star.area,
        startR: starRadius(star.area),
      };
      svgRef.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (starId) {
      onStarClick(starId);
      if (mode === "select") {
        const star = house.stars.find((s) => s.id === starId);
        if (!star) return;
        drag.current = {
          id: starId,
          kind: "move",
          startArea: star.area,
          startR: starRadius(star.area),
        };
        svgRef.current?.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
      return;
    }

    if (linkId) {
      onLinkClick(linkId);
      return;
    }

    if (mode === "place") {
      if (
        p.x >= 0 &&
        p.y >= 0 &&
        p.x <= house.site.width &&
        p.y <= house.site.height
      ) {
        const r = starRadius(DEFAULT_AREA);
        const q = clampStar(p.x, p.y, r);
        onPlace(q.x, q.y);
      }
      return;
    }

    onBackground();
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const p = toLocal(e);
    if (!p) return;
    const star = house.stars.find((s) => s.id === drag.current?.id);
    if (!star) return;

    if (drag.current.kind === "move") {
      const r = starRadius(star.area);
      const q = clampStar(p.x, p.y, r);
      onMove(star.id, q.x, q.y);
      return;
    }

    const r = Math.max(0.6, Math.hypot(p.x - star.x, p.y - star.y));
    onResize(star.id, Math.PI * r * r);
  }

  function onPointerUp() {
    drag.current = null;
  }

  const grid: number[] = [];
  for (let x = 0; x <= house.site.width; x += 1) grid.push(x);

  return (
    <svg
      ref={svgRef}
      className="constellation"
      viewBox={`${-MARGIN} ${-MARGIN} ${vbW} ${vbH}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {showSite ? (
        <>
          <rect
            x={0}
            y={house.site.height}
            width={house.site.width}
            height={ROAD_DEPTH}
            fill="#d9d3c8"
          />
          <text
            x={house.site.width / 2}
            y={house.site.height + ROAD_DEPTH / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            className="label-road"
          >
            道路
          </text>
          <rect
            x={0}
            y={0}
            width={house.site.width}
            height={house.site.height}
            fill="#fbf7f0"
            stroke="#2c2924"
            strokeWidth={0.06}
          />
          {grid.map((x) => (
            <line
              key={`vx-${x}`}
              x1={x}
              y1={0}
              x2={x}
              y2={house.site.height}
              stroke="#e4ddd2"
              strokeWidth={0.02}
            />
          ))}
          {Array.from({ length: house.site.height + 1 }, (_, y) => (
            <line
              key={`hy-${y}`}
              x1={0}
              y1={y}
              x2={house.site.width}
              y2={y}
              stroke="#e4ddd2"
              strokeWidth={0.02}
            />
          ))}
        </>
      ) : (
        <rect
          x={0}
          y={0}
          width={house.site.width}
          height={house.site.height}
          fill="#fbf7f0"
        />
      )}

      {house.links.map((link) => {
        const from = house.stars.find((s) => s.id === link.fromId);
        const to = house.stars.find((s) => s.id === link.toId);
        if (!from || !to) return null;
        const selected = selectedLinkId === link.id;
        return (
          <g key={link.id}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="transparent"
              strokeWidth={0.45}
              data-link={link.id}
            />
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={selected ? "#8a3b24" : "#2c2924"}
              strokeWidth={selected ? 0.1 : 0.07}
              strokeDasharray={link.kind === "sight" ? "0.18 0.14" : undefined}
              data-link={link.id}
            />
            {link.kind === "access" ? (
              <text
                x={(from.x + to.x) / 2}
                y={(from.y + to.y) / 2 - 0.22}
                textAnchor="middle"
                className="label-dist"
              >
                {distance(from, to).toFixed(1)}m
              </text>
            ) : null}
          </g>
        );
      })}

      {house.stars.map((star) => {
        const r = starRadius(star.area);
        const selected =
          selectedStarId === star.id || linkFromId === star.id;
        const garden = isGarden(star.name);
        const handleAngle = -Math.PI / 4;
        const hx = star.x + Math.cos(handleAngle) * r;
        const hy = star.y + Math.sin(handleAngle) * r;
        return (
          <g key={star.id}>
            <circle
              cx={star.x}
              cy={star.y}
              r={r}
              fill={garden ? "#dce8d4" : "#eadfcb"}
              stroke={selected ? "#8a3b24" : "#2c2924"}
              strokeWidth={selected ? 0.1 : 0.06}
              data-star={star.id}
            />
            <text
              x={star.x}
              y={star.y - 0.12}
              textAnchor="middle"
              className="label-star"
              data-star={star.id}
            >
              {star.name}
            </text>
            <text
              x={star.x}
              y={star.y + 0.28}
              textAnchor="middle"
              className="label-area"
              data-star={star.id}
            >
              {star.area.toFixed(0)}㎡〜
            </text>
            {selected && mode === "select" ? (
              <circle
                cx={hx}
                cy={hy}
                r={0.18}
                fill="#8a3b24"
                stroke="#fbf7f0"
                strokeWidth={0.05}
                data-resize={star.id}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
