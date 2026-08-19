/**
 * The airbase, as a live top-down view.
 *
 * This is the answer to "it looks like a dashboard, not a simulation". Every
 * aircraft is a physical object that occupies a real place — a turnaround slot, a
 * maintenance bay, the holding point, the runway, the mission area — and moves
 * between them as the state machine advances. Watching it for ten seconds should
 * tell you what kind of thing this is without reading a single number.
 *
 * Rendering approach: the SVG structure is rendered by React (cheap, changes
 * rarely), but the per-frame motion is done by mutating `transform` on element
 * refs inside a requestAnimationFrame loop. React never re-renders for movement.
 *
 * Important: this is presentation only. Positions here are cosmetic — the
 * simulation has no geometry, and nothing drawn here feeds back into it. Aircraft
 * glide toward the place their status implies, which is honest: the sim models
 * *occupancy and time*, not metres.
 */
import { useEffect, useMemo, useRef } from "react";
import type { Aircraft, SimState } from "@/sim/types";
import { fieldStatus } from "@/sim/engine";
import { isAirborne } from "@/sim/types";
import { useLang } from "@/i18n/LangContext";
import { TONE_HSL, type Tone } from "./primitives";

const W = 1000;
const H = 620;

// ── layout ────────────────────────────────────────────────────────────────────
const RWY = { x: 55, y: 196, w: 890, h: 44 };
const TAXI_Y = RWY.y + RWY.h + 34;
const HOLD = { x: RWY.x + 30, y: TAXI_Y };

const SLOT_ROW = { y: 352, w: 96, h: 62 };
const BAY_ROW = { y: 352, w: 74, h: 62 };
const SLOT_X0 = 70;
const BAY_X0 = 560;

const APRON = { x: 70, y: 452, w: 500, h: 140 };
const QUEUE = { x: 600, y: 452, w: 330, h: 140 };

interface Pt {
  x: number;
  y: number;
}

function slotPos(i: number, total: number): Pt {
  const gap = total > 0 ? Math.min(SLOT_ROW.w + 14, (470 - 20) / Math.max(total, 1)) : SLOT_ROW.w;
  return { x: SLOT_X0 + i * gap + SLOT_ROW.w / 2, y: SLOT_ROW.y + SLOT_ROW.h / 2 };
}

function bayPos(i: number, total: number): Pt {
  const gap = total > 0 ? Math.min(BAY_ROW.w + 12, (370 - 16) / Math.max(total, 1)) : BAY_ROW.w;
  return { x: BAY_X0 + i * gap + BAY_ROW.w / 2, y: BAY_ROW.y + BAY_ROW.h / 2 };
}

function gridPos(box: { x: number; y: number; w: number; h: number }, i: number, perRow: number): Pt {
  const cx = box.x + 30 + (i % perRow) * ((box.w - 50) / (perRow - 1 || 1));
  const cy = box.y + 32 + Math.floor(i / perRow) * 42;
  return { x: cx, y: Math.min(cy, box.y + box.h - 16) };
}

/** Racetrack orbit in the mission area, phase-shifted per aircraft. */
function orbitPos(hours: number, index: number, count: number): Pt {
  const cx = W / 2;
  const cy = 92;
  const rx = 400;
  const ry = 56;
  // Each aircraft gets its own phase so they string out rather than stack.
  const speed = 0.55;
  const phase = (index / Math.max(count, 1)) * Math.PI * 2;
  const th = hours * speed * Math.PI * 2 + phase;
  return { x: cx + Math.cos(th) * rx, y: cy + Math.sin(th) * ry };
}

/** Where should this aircraft be, given only its simulation state? */
function targetFor(ac: Aircraft, state: SimState, ctx: { airborneIdx: number; airborneN: number; readyIdx: number; queueIdx: number }): Pt {
  switch (ac.status) {
    case "in_preparation":
      return ac.slot !== null ? slotPos(ac.slot, state.slots.length) : gridPos(APRON, ctx.readyIdx, 8);
    case "under_maintenance":
      return ac.bay !== null ? bayPos(ac.bay, state.bays.length) : gridPos(QUEUE, ctx.queueIdx, 5);
    case "unavailable":
      // Grounded and waiting for capacity — parked in the holding area, visibly stuck.
      return gridPos(QUEUE, ctx.queueIdx, 5);
    case "allocated":
      // Taxiing toward the turnaround slots.
      return { x: SLOT_X0 + 40 + ctx.readyIdx * 26, y: SLOT_ROW.y + SLOT_ROW.h + 34 };
    case "awaiting_launch":
      return { x: HOLD.x + ctx.readyIdx * 30, y: HOLD.y };
    case "on_mission":
      return orbitPos(state.hours, ctx.airborneIdx, ctx.airborneN);
    case "returning":
      // On approach: line up on the runway from the far end.
      return { x: RWY.x + RWY.w - 90, y: RWY.y + RWY.h / 2 };
    case "recovering":
      return { x: RWY.x + 180 + ctx.readyIdx * 26, y: TAXI_Y };
    case "ready":
    default:
      return gridPos(APRON, ctx.readyIdx, 8);
  }
}

const STATUS_TONE: Record<Aircraft["status"], Tone> = {
  ready: "green",
  allocated: "blue",
  in_preparation: "blue",
  awaiting_launch: "green",
  on_mission: "blue",
  returning: "blue",
  recovering: "amber",
  under_maintenance: "amber",
  unavailable: "red",
};

interface Node {
  g: SVGGElement | null;
  x: number;
  y: number;
  hdg: number;
}

export function BaseScene({
  state,
  selected,
  onSelect,
}: {
  state: SimState;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useLang();
  const nodes = useRef(new Map<string, Node>());
  const stateRef = useRef(state);
  stateRef.current = state;

  const field = fieldStatus(state);
  const day = state.solar.daylight;

  // Sky and ground respond to the solar model, so the scene visibly moves
  // through dawn, day, dusk and a long Nordic night.
  const sky = useMemo(() => {
    const el = state.solar.elevationDeg;
    if (day <= 0.02) return ["hsl(226 44% 8%)", "hsl(224 38% 13%)"];
    if (el < 4) return [`hsl(${218 - day * 8} 42% ${10 + day * 20}%)`, `hsl(${26 + day * 10} ${52 + day * 18}% ${24 + day * 22}%)`];
    return [`hsl(212 ${50 + day * 12}% ${24 + day * 26}%)`, `hsl(203 ${42 + day * 14}% ${48 + day * 24}%)`];
  }, [day, state.solar.elevationDeg]);

  const groundLight = 0.2 + day * 0.62;

  /**
   * Move every aircraft toward the position its state implies.
   *
   * `dt === null` snaps instantly instead of easing. That path matters because a
   * hidden or throttled tab receives no animation frames at all, so without it
   * the scene would show a stale layout and then visibly slide into place the
   * moment the page is looked at.
   */
  const applyPositions = (dt: number | null) => {
    const s = stateRef.current;
    const airborne = s.aircraft.filter((a) => isAirborne(a.status));
    let readyN = 0;
    let queueN = 0;

    for (const ac of s.aircraft) {
      const node = nodes.current.get(ac.id);
      if (!node || !node.g) continue;

      // Recompute packing indices each pass so aircraft close ranks as the
      // fleet shifts between states.
      let idx = 0;
      if (ac.status === "unavailable" || (ac.status === "under_maintenance" && ac.bay === null)) idx = queueN++;
      else if (
        ac.status === "ready" ||
        ac.status === "allocated" ||
        ac.status === "awaiting_launch" ||
        ac.status === "recovering" ||
        (ac.status === "in_preparation" && ac.slot === null)
      ) {
        idx = readyN++;
      }

      const tgt = targetFor(ac, s, {
        airborneIdx: airborne.indexOf(ac),
        airborneN: Math.max(airborne.length, 1),
        readyIdx: idx,
        queueIdx: idx,
      });

      // Airborne aircraft follow their orbit exactly (already smooth); ground
      // movement eases, which reads as taxiing.
      const k = dt === null || isAirborne(ac.status) ? 1 : 1 - Math.exp(-dt * 2.6);
      const nx = node.x + (tgt.x - node.x) * k;
      const ny = node.y + (tgt.y - node.y) * k;
      const dx = nx - node.x;
      const dy = ny - node.y;
      if (dt !== null && Math.hypot(dx, dy) > 0.12) {
        const want = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
        const diff = ((want - node.hdg + 540) % 360) - 180;
        node.hdg += diff * Math.min(1, dt * 6);
      }
      node.x = nx;
      node.y = ny;
      node.g.setAttribute("transform", `translate(${nx.toFixed(1)} ${ny.toFixed(1)}) rotate(${node.hdg.toFixed(1)})`);
    }
  };
  const applyRef = useRef(applyPositions);
  applyRef.current = applyPositions;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      applyRef.current(dt);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keep positions truthful when no animation frames are arriving.
  useEffect(() => {
    if (document.hidden) applyRef.current(null);
  });

  /**
   * Stable ref callback per aircraft id.
   *
   * This must be memoised. An inline `ref={(el) => ...}` is a new function on
   * every render, so React detaches (calls with null) and reattaches on each of
   * the ~20 renders per second — which dropped the position state and left the
   * transform unset, so nothing moved at all.
   */
  const refCbs = useRef(new Map<string, (el: SVGGElement | null) => void>());
  const getRefCb = (id: string, initial: Pt) => {
    let cb = refCbs.current.get(id);
    if (!cb) {
      cb = (el: SVGGElement | null) => {
        // Ignore detach: the element is replaced, not gone, and the motion state
        // must survive.
        if (!el) return;
        const existing = nodes.current.get(id);
        if (existing) {
          existing.g = el;
          el.setAttribute("transform", `translate(${existing.x.toFixed(1)} ${existing.y.toFixed(1)}) rotate(${existing.hdg.toFixed(1)})`);
          return;
        }
        nodes.current.set(id, { g: el, x: initial.x, y: initial.y, hdg: 90 });
        // Place it immediately. requestAnimationFrame does not fire while the tab
        // is hidden, so without this the whole fleet renders stacked at the SVG
        // origin until the page is first looked at.
        el.setAttribute("transform", `translate(${initial.x.toFixed(1)} ${initial.y.toFixed(1)}) rotate(90)`);
      };
      refCbs.current.set(id, cb);
    }
    return cb;
  };

  return (
    <div className="relative w-full h-full min-h-0 rounded-lg overflow-hidden" style={{ background: "hsl(226 40% 10%)" }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sky[0]} />
            <stop offset="100%" stopColor={sky[1]} />
          </linearGradient>
          <linearGradient id="groundGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`hsl(150 14% ${8 + groundLight * 16}%)`} />
            <stop offset="100%" stopColor={`hsl(150 12% ${5 + groundLight * 11}%)`} />
          </linearGradient>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0 L0 0 0 40" fill="none" stroke="hsl(180 30% 60% / 0.05)" strokeWidth="1" />
          </pattern>
        </defs>

        {/* sky + mission area */}
        <rect x="0" y="0" width={W} height="168" fill="url(#skyGrad)" />
        <ellipse cx={W / 2} cy="92" rx="400" ry="56" fill="none" stroke="hsl(200 60% 70% / 0.14)" strokeWidth="1" strokeDasharray="6 8" />
        <text x="20" y="26" className="font-mono" fontSize="11" fill="hsl(200 30% 78% / 0.6)" letterSpacing="2">
          {t("scene.missionArea").toUpperCase()}
        </text>

        {/* ground */}
        <rect x="0" y="168" width={W} height={H - 168} fill="url(#groundGrad)" />
        <rect x="0" y="168" width={W} height={H - 168} fill="url(#grid)" />

        {/* runway */}
        <g>
          <rect
            x={RWY.x}
            y={RWY.y}
            width={RWY.w}
            height={RWY.h}
            rx="3"
            fill={`hsl(220 8% ${9 + groundLight * 14}%)`}
            stroke={field.open ? "hsl(200 20% 70% / 0.35)" : `hsl(${TONE_HSL.red})`}
            strokeWidth={field.open ? 1 : 2}
          />
          {/* centreline */}
          <line
            x1={RWY.x + 24}
            y1={RWY.y + RWY.h / 2}
            x2={RWY.x + RWY.w - 24}
            y2={RWY.y + RWY.h / 2}
            stroke="hsl(50 80% 88% / 0.5)"
            strokeWidth="2"
            strokeDasharray="26 22"
          />
          {/* thresholds */}
          {[0, 1].map((side) => (
            <g key={side}>
              {[0, 1, 2, 3].map((i) => (
                <rect
                  key={i}
                  x={side === 0 ? RWY.x + 6 : RWY.x + RWY.w - 20}
                  y={RWY.y + 6 + i * 9}
                  width="14"
                  height="5"
                  fill="hsl(50 70% 90% / 0.42)"
                />
              ))}
            </g>
          ))}
          <text
            x={RWY.x + 34}
            y={RWY.y + RWY.h - 12}
            className="font-mono"
            fontSize="15"
            fontWeight="700"
            fill="hsl(50 70% 90% / 0.65)"
          >
            {String(Math.round(state.config.runwayHeadingDeg / 10)).padStart(2, "0")}
          </text>
          <text
            x={RWY.x + RWY.w - 52}
            y={RWY.y + 22}
            className="font-mono"
            fontSize="15"
            fontWeight="700"
            fill="hsl(50 70% 90% / 0.65)"
          >
            {String((Math.round(state.config.runwayHeadingDeg / 10) + 18) % 36 || 36).padStart(2, "0")}
          </text>

          {!field.open && (
            <g>
              <rect x={W / 2 - 150} y={RWY.y + RWY.h / 2 - 15} width="300" height="30" rx="4" fill="hsl(0 0% 0% / 0.6)" />
              <text
                x={W / 2}
                y={RWY.y + RWY.h / 2 + 5}
                textAnchor="middle"
                className="font-mono animate-pulse-red"
                fontSize="13"
                fontWeight="700"
                fill={`hsl(${TONE_HSL.red})`}
                letterSpacing="1.5"
              >
                {state.runwayClosedUntil !== null && state.hours < state.runwayClosedUntil
                  ? t("scene.runwayClosed")
                  : t("scene.launchBan")}
              </text>
            </g>
          )}
        </g>

        {/* taxiway */}
        <line x1="40" y1={TAXI_Y} x2={W - 40} y2={TAXI_Y} stroke={`hsl(220 8% ${11 + groundLight * 12}%)`} strokeWidth="20" strokeLinecap="round" />
        <line x1="40" y1={TAXI_Y} x2={W - 40} y2={TAXI_Y} stroke="hsl(50 70% 70% / 0.18)" strokeWidth="1.5" strokeDasharray="10 14" />
        <circle cx={HOLD.x} cy={HOLD.y} r="4" fill={`hsl(${TONE_HSL.green})`} opacity="0.5" />
        <text x={HOLD.x + 12} y={HOLD.y - 12} className="font-mono" fontSize="9" fill="hsl(200 20% 76% / 0.5)" letterSpacing="1">
          {t("scene.holding").toUpperCase()}
        </text>

        {/* turnaround slots */}
        <SectionLabel x={SLOT_X0} y={SLOT_ROW.y - 12} text={t("scene.prepSlots")} />
        {state.slots.map((s, i) => {
          const p = slotPos(i, state.slots.length);
          const down = s.gseDownUntil !== null && state.hours < s.gseDownUntil;
          const tone: Tone = down ? "red" : s.occupiedBy ? "blue" : "green";
          return (
            <g key={`slot-${i}`}>
              <rect
                x={p.x - SLOT_ROW.w / 2}
                y={p.y - SLOT_ROW.h / 2}
                width={SLOT_ROW.w}
                height={SLOT_ROW.h}
                rx="4"
                fill={`hsl(${TONE_HSL[tone]} / ${s.occupiedBy || down ? 0.14 : 0.05})`}
                stroke={`hsl(${TONE_HSL[tone]} / ${down ? 0.75 : 0.35})`}
                strokeWidth="1"
                strokeDasharray={down ? "4 3" : undefined}
              />
              <text x={p.x - SLOT_ROW.w / 2 + 6} y={p.y - SLOT_ROW.h / 2 + 14} className="font-mono" fontSize="10" fontWeight="700" fill={`hsl(${TONE_HSL[tone]})`}>
                {i + 1}
              </text>
              {down && (
                <text x={p.x} y={p.y + SLOT_ROW.h / 2 - 6} textAnchor="middle" className="font-mono" fontSize="8" fill={`hsl(${TONE_HSL.red})`}>
                  GSE
                </text>
              )}
            </g>
          );
        })}

        {/* maintenance bays */}
        <SectionLabel x={BAY_X0} y={BAY_ROW.y - 12} text={t("scene.maintenance")} />
        {state.bays.map((b, i) => {
          const p = bayPos(i, state.bays.length);
          const tone: Tone = b.occupiedBy ? "amber" : "green";
          const lvl = b.level === "major_workshop" ? "H" : b.level === "minor_workshop" ? "L" : "S";
          return (
            <g key={`bay-${i}`}>
              <rect
                x={p.x - BAY_ROW.w / 2}
                y={p.y - BAY_ROW.h / 2}
                width={BAY_ROW.w}
                height={BAY_ROW.h}
                rx="4"
                fill={`hsl(${TONE_HSL[tone]} / ${b.occupiedBy ? 0.14 : 0.05})`}
                stroke={`hsl(${TONE_HSL[tone]} / 0.35)`}
                strokeWidth="1"
              />
              {/* hangar roof hint */}
              <path
                d={`M${p.x - BAY_ROW.w / 2} ${p.y - BAY_ROW.h / 2} L${p.x} ${p.y - BAY_ROW.h / 2 - 9} L${p.x + BAY_ROW.w / 2} ${p.y - BAY_ROW.h / 2}`}
                fill="none"
                stroke={`hsl(${TONE_HSL[tone]} / 0.3)`}
                strokeWidth="1"
              />
              <text x={p.x - BAY_ROW.w / 2 + 5} y={p.y - BAY_ROW.h / 2 + 13} className="font-mono" fontSize="9" fontWeight="700" fill={`hsl(${TONE_HSL[tone]})`}>
                {lvl}
              </text>
            </g>
          );
        })}

        {/* apron + waiting area */}
        <SectionLabel x={APRON.x} y={APRON.y - 8} text={t("scene.apron")} />
        <rect x={APRON.x} y={APRON.y} width={APRON.w} height={APRON.h} rx="6" fill="hsl(220 10% 14% / 0.5)" stroke="hsl(200 20% 60% / 0.14)" />
        <SectionLabel x={QUEUE.x} y={QUEUE.y - 8} text={t("scene.queue")} tone="red" />
        <rect x={QUEUE.x} y={QUEUE.y} width={QUEUE.w} height={QUEUE.h} rx="6" fill={`hsl(${TONE_HSL.red} / 0.06)`} stroke={`hsl(${TONE_HSL.red} / 0.2)`} strokeDasharray="5 4" />

        {/* wind indicator */}
        <WindArrow state={state} />

        {/* aircraft */}
        {state.aircraft.map((ac, acIndex) => {
          const tone = STATUS_TONE[ac.status];
          const isSel = selected === ac.id;
          // Spread the initial parking positions so a first paint before any
          // animation frame still looks like a parked fleet.
          const initial = gridPos(APRON, acIndex, 8);
          return (
            <g
              key={ac.id}
              ref={getRefCb(ac.id, initial)}
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(isSel ? null : ac.id);
              }}
            >
              {isSel && <circle r="17" fill="none" stroke={`hsl(42 64% 60%)`} strokeWidth="1.5" strokeDasharray="3 3" />}
              {/* jet glyph: slim delta, nose up in local coords */}
              <path
                d="M0,-11 L3.2,-1 L10,4 L10,6.4 L3.2,4.6 L2.4,9 L4.6,11.4 L4.6,12.8 L0,11.6 L-4.6,12.8 L-4.6,11.4 L-2.4,9 L-3.2,4.6 L-10,6.4 L-10,4 L-3.2,-1 Z"
                fill={`hsl(${TONE_HSL[tone]})`}
                stroke="hsl(0 0% 0% / 0.45)"
                strokeWidth="0.6"
              />
              {isAirborne(ac.status) && (
                <circle r="2" cy="13" fill={`hsl(42 80% 70% / 0.75)`} />
              )}
              <text
                y="-16"
                textAnchor="middle"
                className="font-mono pointer-events-none"
                fontSize="8"
                fontWeight="700"
                fill={isSel ? "hsl(42 64% 76%)" : "hsl(200 20% 82% / 0.72)"}
                transform="rotate(0)"
              >
                {ac.tail}
              </text>
            </g>
          );
        })}

        <Precip state={state} />
      </svg>

      {/* Selected-aircraft readout */}
      {selected && <SelectedCard state={state} id={selected} onClose={() => onSelect(null)} />}

      <div className="absolute bottom-1.5 right-2 text-[9px] font-mono pointer-events-none" style={{ color: "hsl(200 20% 80% / 0.4)" }}>
        {t("scene.legend")}
      </div>
    </div>
  );
}

function SectionLabel({ x, y, text, tone = "neutral" }: { x: number; y: number; text: string; tone?: Tone }) {
  return (
    <text x={x} y={y} className="font-mono" fontSize="9" fontWeight="700" letterSpacing="1.4" fill={`hsl(${TONE_HSL[tone]} / ${tone === "neutral" ? 0.55 : 0.7})`}>
      {text.toUpperCase()}
    </text>
  );
}

function WindArrow({ state }: { state: SimState }) {
  const { t } = useLang();
  const cx = W - 78;
  const cy = 236;
  // Wind direction is where it blows FROM, so the arrow points the opposite way.
  const rot = state.weather.windDirDeg + 180;
  return (
    <g>
      <circle cx={cx} cy={cy} r="26" fill="hsl(220 20% 10% / 0.55)" stroke="hsl(200 25% 70% / 0.22)" />
      <g transform={`translate(${cx} ${cy}) rotate(${rot})`}>
        <path d="M0,-17 L5,6 L0,2 L-5,6 Z" fill="hsl(200 45% 78% / 0.85)" />
      </g>
      <text x={cx} y={cy + 40} textAnchor="middle" className="font-mono" fontSize="9" fill="hsl(200 25% 80% / 0.65)">
        {t("scene.wind", { dir: state.weather.windDirDeg.toFixed(0).padStart(3, "0"), kts: state.weather.windKts.toFixed(0) })}
      </text>
    </g>
  );
}

/**
 * Precipitation, driven by the same weather state the engine reads.
 *
 * Deliberately literal: when you see snow here, the engine is accumulating
 * contamination on that runway and will close it for clearance. It is not decor.
 */
function Precip({ state }: { state: SimState }) {
  const ref = useRef<SVGGElement | null>(null);
  const partsRef = useRef<{ x: number; y: number; v: number; sway: number }[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.08);
      last = now;
      const s = stateRef.current;
      const g = ref.current;
      if (!g) return;

      const want = s.weather.precip === "none" ? 0 : Math.round(Math.min(150, 22 + s.weather.precipRate * 22));
      const parts = partsRef.current;
      while (parts.length < want) {
        parts.push({ x: Math.random() * W, y: Math.random() * H, v: 0, sway: Math.random() * Math.PI * 2 });
      }
      if (parts.length > want) parts.length = want;

      const snowy = s.weather.precip === "snow" || s.weather.precip === "sleet";
      const fall = snowy ? 70 : 420;
      const drift = (s.weather.windKts / 30) * (snowy ? 90 : 40);

      const children = g.childNodes;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.sway += dt * 2;
        p.y += (fall + p.v) * dt;
        p.x += (drift + (snowy ? Math.sin(p.sway) * 14 : 0)) * dt;
        if (p.y > H) {
          p.y = -8;
          p.x = Math.random() * W;
        }
        if (p.x > W + 10) p.x -= W + 20;
        if (p.x < -10) p.x += W + 20;
        const el = children[i] as SVGElement | undefined;
        if (el) el.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      }
      // Hide unused nodes.
      for (let i = parts.length; i < children.length; i++) {
        (children[i] as SVGElement).setAttribute("transform", "translate(-50 -50)");
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const snowy = state.weather.precip === "snow" || state.weather.precip === "sleet";
  const n = state.weather.precip === "none" ? 0 : Math.round(Math.min(150, 22 + state.weather.precipRate * 22));

  return (
    <>
      {/* Low visibility reads as haze over the whole field. */}
      {state.weather.visibilityM < 4000 && (
        <rect
          x="0"
          y="0"
          width={W}
          height={H}
          fill="hsl(210 18% 76%)"
          opacity={Math.min(0.42, (4000 - state.weather.visibilityM) / 9000)}
          pointerEvents="none"
        />
      )}
      <g ref={ref} pointerEvents="none">
        {Array.from({ length: n }, (_, i) =>
          snowy ? (
            <circle key={i} r="1.5" fill="hsl(200 30% 96% / 0.75)" />
          ) : (
            <line key={i} x1="0" y1="0" x2="1.2" y2="7" stroke="hsl(205 55% 82% / 0.5)" strokeWidth="1" />
          ),
        )}
      </g>
    </>
  );
}

function SelectedCard({ state, id, onClose }: { state: SimState; id: string; onClose: () => void }) {
  const { t, tm } = useLang();
  const ac = state.aircraft.find((a) => a.id === id);
  if (!ac) return null;
  const tone = STATUS_TONE[ac.status];
  return (
    <div
      className="absolute top-2 right-2 rounded-lg px-2.5 py-2 backdrop-blur-sm w-52"
      style={{ background: "hsl(226 40% 10% / 0.88)", border: `1px solid hsl(${TONE_HSL[tone]} / 0.5)` }}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono font-bold text-[12px] text-white">{ac.tail}</span>
        <span className="text-[9px] font-mono px-1 py-px rounded" style={{ background: `hsl(${TONE_HSL[tone]} / 0.25)`, color: `hsl(${TONE_HSL[tone]})` }}>
          {t(`status.${ac.status}`)}
        </span>
        <button onClick={onClose} className="ml-auto text-[11px] leading-none opacity-50 hover:opacity-100" style={{ color: "white" }}>
          ✕
        </button>
      </div>
      <div className="mt-1 text-[9px] font-mono" style={{ color: "hsl(200 20% 78%)" }}>
        {ac.activity ? tm(ac.activity) : t("fleet.onApron")}
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {[
          { l: t("fleet.health"), v: `${ac.health.toFixed(0)}%` },
          { l: t("fleet.toService"), v: `${ac.hoursToService.toFixed(1)}h` },
          { l: t("fleet.flightHours"), v: `${ac.flightHours.toFixed(0)}h` },
        ].map((x) => (
          <div key={x.l}>
            <div className="text-[7px] font-mono uppercase tracking-wide" style={{ color: "hsl(200 15% 60%)" }}>
              {x.l}
            </div>
            <div className="font-mono font-bold text-[11px] tnum text-white">{x.v}</div>
          </div>
        ))}
      </div>
      {ac.deferredDefects.length > 0 && (
        <div className="mt-1.5 text-[9px] font-mono" style={{ color: `hsl(${TONE_HSL.amber})` }}>
          {t("act.deferredCount", { n: ac.deferredDefects.length })}
        </div>
      )}
    </div>
  );
}
