import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { ConstellationView } from "./ConstellationView";
import { PlanView } from "./PlanView";
import { planify } from "./planify";
import {
  DEFAULT_AREA,
  DEFAULT_AREA_MARGIN,
  DEFAULT_MODULE_MM,
  DEFAULT_SITE,
  MAX_AREA,
  MIN_AREA,
  newId,
  type House,
  type Link,
  type Mode,
  type Star,
} from "./types";
import { describeHouse } from "./words";

const emptyHouse = (): House => ({
  site: { ...DEFAULT_SITE },
  siteVisible: true,
  stars: [],
  links: [],
  rooms: null,
  walls: null,
  openings: null,
  planStale: false,
  areaMargin: DEFAULT_AREA_MARGIN,
  moduleMm: DEFAULT_MODULE_MM,
});

export default function App() {
  const [house, setHouse] = useState<House>(emptyHouse);
  const [mode, setMode] = useState<Mode>("place");
  const [selectedStarId, setSelectedStarId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [linkFromId, setLinkFromId] = useState<string | null>(null);
  const [starCount, setStarCount] = useState(1);

  const words = useMemo(() => describeHouse(house), [house]);
  const selectedStar = house.stars.find((s) => s.id === selectedStarId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (selectedStarId) {
        removeStar(selectedStarId);
      } else if (selectedLinkId) {
        removeLink(selectedLinkId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedStarId, selectedLinkId]);

  function markEdited(next: House): House {
    return {
      ...next,
      planStale: next.rooms !== null,
    };
  }

  function addStar(x: number, y: number) {
    const name = `部屋${starCount}`;
    setStarCount((n) => n + 1);
    const star: Star = {
      id: newId("star"),
      name,
      x,
      y,
      area: DEFAULT_AREA,
    };
    setHouse((h) =>
      markEdited({
        ...h,
        stars: [...h.stars, star],
      }),
    );
    setSelectedStarId(star.id);
    setSelectedLinkId(null);
    setMode("select");
  }

  function moveStar(id: string, x: number, y: number) {
    setHouse((h) =>
      markEdited({
        ...h,
        stars: h.stars.map((s) => (s.id === id ? { ...s, x, y } : s)),
      }),
    );
  }

  function resizeStar(id: string, area: number) {
    const nextArea = Math.min(MAX_AREA, Math.max(MIN_AREA, area));
    setHouse((h) =>
      markEdited({
        ...h,
        stars: h.stars.map((s) => (s.id === id ? { ...s, area: nextArea } : s)),
      }),
    );
  }

  function renameStar(id: string, name: string) {
    setHouse((h) => ({
      ...h,
      stars: h.stars.map((s) => (s.id === id ? { ...s, name } : s)),
      rooms: h.rooms
        ? h.rooms.map((r) => (r.id === id ? { ...r, name } : r))
        : h.rooms,
    }));
  }

  function removeStar(id: string) {
    setHouse((h) =>
      markEdited({
        ...h,
        stars: h.stars.filter((s) => s.id !== id),
        links: h.links.filter((l) => l.fromId !== id && l.toId !== id),
        rooms: h.rooms ? h.rooms.filter((r) => r.id !== id) : h.rooms,
      }),
    );
    setSelectedStarId(null);
    if (linkFromId === id) setLinkFromId(null);
  }

  function removeLink(id: string) {
    setHouse((h) =>
      markEdited({
        ...h,
        links: h.links.filter((l) => l.id !== id),
      }),
    );
    setSelectedLinkId(null);
  }

  function onStarClick(id: string) {
    if (mode === "access" || mode === "sight") {
      if (!linkFromId) {
        setLinkFromId(id);
        setSelectedStarId(id);
        return;
      }
      if (linkFromId === id) {
        setLinkFromId(null);
        return;
      }
      const kind = mode === "access" ? "access" : "sight";
      setHouse((h) => {
        const exists = h.links.some(
          (l) =>
            l.kind === kind &&
            ((l.fromId === linkFromId && l.toId === id) ||
              (l.fromId === id && l.toId === linkFromId)),
        );
        if (exists) return h;
        const link: Link = {
          id: newId("link"),
          fromId: linkFromId,
          toId: id,
          kind,
        };
        return markEdited({ ...h, links: [...h.links, link] });
      });
      setLinkFromId(null);
      setSelectedStarId(id);
      setMode("select");
      return;
    }
    setSelectedStarId(id);
    setSelectedLinkId(null);
  }

  function runPlanify() {
    if (house.stars.length === 0) return;
    const { rooms, walls, openings } = planify(house);
    setHouse({
      ...house,
      rooms,
      walls,
      openings,
      planStale: false,
    });
    setMode("select");
  }

  const hint =
    mode === "place"
      ? "敷地の中をクリックして、部屋の星を置きます。"
      : mode === "access"
        ? linkFromId
          ? "行き来先の星をクリックします。"
          : "行き来の始点になる星をクリックします。"
        : mode === "sight"
          ? linkFromId
            ? "見える先の星をクリックします。"
            : "視線の始点になる星をクリックします。"
          : "星を動かしたり、大きさを変えたりできます。";

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="eyebrow">設計スケッチ</p>
          <h1>星座の家</h1>
        </div>
        <p className="lead">
          円の星で部屋の関係を置き、「図面化」で壁を共有した間取りと出入り口にします。
        </p>
      </header>

      <div className="toolbar">
        <Tool
          active={mode === "select"}
          onClick={() => {
            setMode("select");
            setLinkFromId(null);
          }}
        >
          動かす
        </Tool>
        <Tool
          active={mode === "place"}
          onClick={() => {
            setMode("place");
            setLinkFromId(null);
          }}
        >
          星を置く
        </Tool>
        <Tool
          active={mode === "access"}
          onClick={() => {
            setMode("access");
            setLinkFromId(null);
          }}
        >
          行き来（実線）
        </Tool>
        <Tool
          active={mode === "sight"}
          onClick={() => {
            setMode("sight");
            setLinkFromId(null);
          }}
        >
          見える（破線）
        </Tool>
        <button
          className="tool danger"
          disabled={!selectedStarId && !selectedLinkId}
          onClick={() => {
            if (selectedStarId) removeStar(selectedStarId);
            else if (selectedLinkId) removeLink(selectedLinkId);
          }}
        >
          消す
        </button>
        <button
          className="tool primary"
          disabled={house.stars.length === 0}
          onClick={runPlanify}
        >
          図面化
        </button>
      </div>

      <p className="hint">{hint}</p>

      <div className="workspace">
        <section className="panel canvas-panel">
          <h2>星座</h2>
          <ConstellationView
            house={house}
            mode={mode}
            selectedStarId={selectedStarId}
            selectedLinkId={selectedLinkId}
            linkFromId={linkFromId}
            onPlace={addStar}
            onMove={moveStar}
            onResize={resizeStar}
            onStarClick={onStarClick}
            onLinkClick={(id) => {
              setSelectedLinkId(id);
              setSelectedStarId(null);
            }}
            onBackground={() => {
              setSelectedStarId(null);
              setSelectedLinkId(null);
            }}
          />
        </section>

        <section className="panel plan-panel">
          <div className="panel-head">
            <h2>図面</h2>
            {house.rooms && house.planStale ? (
              <span className="stale">古い図面です。もう一度図面化してください。</span>
            ) : house.rooms ? (
              <span className="plan-note">太い線が外壁、細い線が間仕切り、｜　｜がドアです。</span>
            ) : null}
          </div>
          <PlanView house={house} />
        </section>

        <aside className="panel words-panel">
          <h2>言葉</h2>
          <ul className="words">
            {words.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {selectedStar ? (
            <div className="editor">
              <label>
                名前
                <input
                  value={selectedStar.name}
                  onChange={(e) => renameStar(selectedStar.id, e.target.value)}
                />
              </label>
              <label>
                広さ（最小） {selectedStar.area.toFixed(1)}㎡
                <input
                  type="range"
                  min={MIN_AREA}
                  max={MAX_AREA}
                  step={0.5}
                  value={selectedStar.area}
                  onChange={(e) =>
                    resizeStar(selectedStar.id, Number(e.target.value))
                  }
                />
              </label>
            </div>
          ) : (
            <p className="quiet">星を選ぶと、名前と広さを変えられます。</p>
          )}
          <div className="editor layout-settings">
            <label className="toggle-row">
              <span>敷地枠</span>
              <button
                type="button"
                className={house.siteVisible ? "tool active" : "tool"}
                onClick={() =>
                  setHouse((h) => ({ ...h, siteVisible: !h.siteVisible }))
                }
              >
                {house.siteVisible ? "表示" : "非表示"}
              </button>
            </label>
            {house.siteVisible ? (
              <div className="site-size">
                <label>
                  縦（m）
                  <input
                    type="number"
                    min={5}
                    max={50}
                    step={0.5}
                    value={house.site.height}
                    onChange={(e) => {
                      const height = Math.max(5, Number(e.target.value) || 5);
                      setHouse((h) =>
                        markEdited({
                          ...h,
                          site: { ...h.site, height },
                        }),
                      );
                    }}
                  />
                </label>
                <label>
                  横（m）
                  <input
                    type="number"
                    min={5}
                    max={50}
                    step={0.5}
                    value={house.site.width}
                    onChange={(e) => {
                      const width = Math.max(5, Number(e.target.value) || 5);
                      setHouse((h) =>
                        markEdited({
                          ...h,
                          site: { ...h.site, width },
                        }),
                      );
                    }}
                  />
                </label>
              </div>
            ) : null}
            <label>
              余裕率 {house.areaMargin.toFixed(2)}
              <input
                type="range"
                min={1}
                max={1.5}
                step={0.05}
                value={house.areaMargin}
                onChange={(e) =>
                  setHouse((h) =>
                    markEdited({ ...h, areaMargin: Number(e.target.value) }),
                  )
                }
              />
            </label>
            <label>
              グリッド（mm）
              <input
                type="number"
                min={300}
                max={2000}
                step={10}
                value={house.moduleMm}
                onChange={(e) =>
                  setHouse((h) =>
                    markEdited({
                      ...h,
                      moduleMm: Math.max(300, Number(e.target.value) || 910),
                    }),
                  )
                }
              />
            </label>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Tool({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button className={active ? "tool active" : "tool"} onClick={onClick}>
      {children}
    </button>
  );
}
