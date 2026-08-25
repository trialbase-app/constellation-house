import { useCallback, useEffect, useState, type RefObject } from "react";

const MIN = 0.5;
const MAX = 4;

export function useViewZoom(svgRef: RefObject<SVGSVGElement | null>) {
  const [zoom, setZoom] = useState(1);

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(MAX, Math.round(z * 1.25 * 100) / 100));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN, Math.round(z / 1.25 * 100) / 100));
  }, []);

  const resetZoom = useCallback(() => setZoom(1), []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / 1.12 : 1.12;
      setZoom((z) => {
        const next = z * factor;
        return Math.min(MAX, Math.max(MIN, Math.round(next * 100) / 100));
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [svgRef]);

  return { zoom, zoomIn, zoomOut, resetZoom };
}

export function ZoomToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="zoom-toolbar" role="group" aria-label="拡大縮小">
      <button type="button" className="zoom-btn" onClick={onZoomOut} title="縮小">
        −
      </button>
      <button type="button" className="zoom-btn zoom-label" onClick={onReset} title="等倍に戻す">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className="zoom-btn" onClick={onZoomIn} title="拡大">
        ＋
      </button>
    </div>
  );
}

/** viewBox 文字列からズーム済み viewBox を作る */
export function zoomedViewBox(
  x: number,
  y: number,
  w: number,
  h: number,
  zoom: number,
): string {
  const zw = w / zoom;
  const zh = h / zoom;
  const zx = x + (w - zw) / 2;
  const zy = y + (h - zh) / 2;
  return `${zx} ${zy} ${zw} ${zh}`;
}
