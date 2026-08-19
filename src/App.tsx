import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { ConstellationView } from "./ConstellationView";
import { PlanView } from "./PlanView";
import { planify } from "./planify";
import {
  DEFAULT_AREA,
  DEFAULT_AREA_MARGIN,
  DEFAULT_DEPARTMENTS,
  DEFAULT_MODULE_MM,
  DEFAULT_SITE,
  MAX_AREA,
  MIN_AREA,
  newId,
  type House,
  type Link,
  type Mode,
  roomTypeLabel,
  type RoomType,
  type Star,
} from "./types";
import { describeHouse } from "./words";

const emptyHouse = (): House => ({
  site: { ...DEFAULT_SITE },
  siteVisible: true,
  departments: DEFAULT_DEPARTMENTS.map((d) => ({ ...d })),
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
  const [siteHeightDraft, setSiteHeightDraft] = useState(
    String(emptyHouse().site.height),
  );
  const [siteWidthDraft, setSiteWidthDraft] = useState(
    String(emptyHouse().site.width),
  );
  const [moduleMmDraft, setModuleMmDraft] = useState(
    String(emptyHouse().moduleMm),
  );
  const [starAreaDrafts, setStarAreaDrafts] = useState<Record<string, string>>(
    {},
  );

  const words = useMemo(() => describeHouse(house), [house]);

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

  useEffect(() => {
    setSiteHeightDraft(String(house.site.height));
  }, [house.site.height]);

  useEffect(() => {
    setSiteWidthDraft(String(house.site.width));
  }, [house.site.width]);

  useEffect(() => {
    setModuleMmDraft(String(house.moduleMm));
  }, [house.moduleMm]);

  function markEdited(next: House): House {
    return {
      ...next,
      planStale: next.rooms !== null,
    };
  }

  function addStar(x: number, y: number) {
    const name = `部屋${starCount}`;
    const defaultDepartmentId = house.departments[0]?.id ?? "dep-a";
    setStarCount((n) => n + 1);
    const star: Star = {
      id: newId("star"),
      name,
      x,
      y,
      area: DEFAULT_AREA,
      departmentId: defaultDepartmentId,
      roomType: "normal",
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

  function setStarDepartment(starId: string, departmentId: string) {
    setHouse((h) =>
      markEdited({
        ...h,
        stars: h.stars.map((s) =>
          s.id === starId ? { ...s, departmentId } : s,
        ),
      }),
    );
  }

  function setStarRoomType(starId: string, roomType: RoomType) {
    setHouse((h) =>
      markEdited({
        ...h,
        stars: h.stars.map((s) => (s.id === starId ? { ...s, roomType } : s)),
      }),
    );
  }

  function commitStarArea(starId: string, raw: string) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      resizeStar(starId, parsed);
    }
    setStarAreaDrafts((prev) => {
      const next = { ...prev };
      delete next[starId];
      return next;
    });
  }

  function commitSiteHeight(raw: string) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setSiteHeightDraft(String(house.site.height));
      return;
    }
    const height = Math.max(5, parsed);
    setHouse((h) =>
      markEdited({
        ...h,
        site: { ...h.site, height },
      }),
    );
  }

  function commitSiteWidth(raw: string) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setSiteWidthDraft(String(house.site.width));
      return;
    }
    const width = Math.max(5, parsed);
    setHouse((h) =>
      markEdited({
        ...h,
        site: { ...h.site, width },
      }),
    );
  }

  function commitModuleMm(raw: string) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setModuleMmDraft(String(house.moduleMm));
      return;
    }
    const moduleMm = Math.max(300, parsed);
    setHouse((h) =>
      markEdited({
        ...h,
        moduleMm,
      }),
    );
  }

  function renameDepartment(departmentId: string, name: string) {
    setHouse((h) => ({
      ...h,
      departments: h.departments.map((d) =>
        d.id === departmentId ? { ...d, name } : d,
      ),
    }));
  }

  function recolorDepartment(departmentId: string, color: string) {
    setHouse((h) => ({
      ...h,
      departments: h.departments.map((d) =>
        d.id === departmentId ? { ...d, color } : d,
      ),
    }));
  }

  function addDepartment() {
    const idx = house.departments.length + 1;
    const depId = newId("dep");
    setHouse((h) => ({
      ...h,
      departments: [
        ...h.departments,
        {
          id: depId,
          name: `部門${idx}`,
          color: "#e7ddcb",
        },
      ],
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
          要求室の星を部門色でまとめ、図面化で廊下帯と部門塊を作って平面にします。
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
              <span className="plan-note">基準線で部門の左右を保ちながら、同じ部門色をまとめて配置しています。</span>
            ) : null}
          </div>
          <PlanView house={house} />
        </section>

        <aside className="panel words-panel">
          <h2 className="star-list-head">星（要求室）</h2>
          <ul className="star-list">
            {house.stars.map((star) => {
              const dep = house.departments.find((d) => d.id === star.departmentId);
              const depColor = dep?.color ?? "#eadfcb";
              const typeLabel = roomTypeLabel(star.roomType);
              return (
                <li
                  key={star.id}
                  className={
                    selectedStarId === star.id ? "star-row active" : "star-row"
                  }
                  onClick={() => {
                    setMode("select");
                    setLinkFromId(null);
                    setSelectedLinkId(null);
                    setSelectedStarId(star.id);
                  }}
                >
                  <span
                    className="star-dot"
                    style={{ background: depColor }}
                    aria-hidden
                  />
                  <div className="star-row-fields">
                    <input
                      className="star-inline-name"
                      value={star.name}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => renameStar(star.id, e.target.value)}
                    />
                    <div className="star-inline-meta">
                      <label>
                        面積
                        <input
                          type="text"
                          inputMode="decimal"
                          value={starAreaDrafts[star.id] ?? String(star.area)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            setStarAreaDrafts((prev) => ({
                              ...prev,
                              [star.id]: e.target.value,
                            }))
                          }
                          onBlur={(e) => commitStarArea(star.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              (e.currentTarget as HTMLInputElement).blur();
                            }
                          }}
                        />
                      </label>
                      <label>
                        部門
                        <select
                          value={star.departmentId}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            setStarDepartment(star.id, e.target.value)
                          }
                        >
                          {house.departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        種別
                        <select
                          value={star.roomType}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            setStarRoomType(star.id, e.target.value as RoomType)
                          }
                        >
                          <option value="normal">通常室</option>
                          <option value="entrance">玄関</option>
                          <option value="stair">階段室</option>
                          <option value="corridor">廊下</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <span className="star-row-meta">{typeLabel}</span>
                </li>
              );
            })}
          </ul>

          <p className="quiet">星の編集は上のリストから行います。</p>
          <div className="editor layout-settings">
            <div className="department-head">
              <span>部門設定</span>
              <button type="button" className="tool" onClick={addDepartment}>
                部門を追加
              </button>
            </div>
            <div className="department-list">
              {house.departments.map((dep) => (
                <div key={dep.id} className="department-row">
                  <input
                    type="color"
                    value={dep.color}
                    onChange={(e) => recolorDepartment(dep.id, e.target.value)}
                    aria-label={`${dep.name}の色`}
                  />
                  <input
                    type="text"
                    value={dep.name}
                    onChange={(e) => renameDepartment(dep.id, e.target.value)}
                  />
                </div>
              ))}
            </div>
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
                    type="text"
                    inputMode="decimal"
                    value={siteHeightDraft}
                    onChange={(e) => setSiteHeightDraft(e.target.value)}
                    onBlur={(e) => commitSiteHeight(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                  />
                </label>
                <label>
                  横（m）
                  <input
                    type="text"
                    inputMode="decimal"
                    value={siteWidthDraft}
                    onChange={(e) => setSiteWidthDraft(e.target.value)}
                    onBlur={(e) => commitSiteWidth(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.currentTarget as HTMLInputElement).blur();
                      }
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
                type="text"
                inputMode="numeric"
                value={moduleMmDraft}
                onChange={(e) => setModuleMmDraft(e.target.value)}
                onBlur={(e) => commitModuleMm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
            </label>
          </div>
          <details className="words-toggle">
            <summary>言葉（開閉）</summary>
            <ul className="words words-box">
              {words.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
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
