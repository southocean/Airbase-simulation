/**
 * The base scene, on canvas.
 *
 * One requestAnimationFrame loop draws everything. The static airfield is cached
 * in an offscreen canvas and blitted; only aircraft, weather and the minimap are
 * redrawn per frame. React renders the surrounding chrome and never participates
 * in the animation.
 */
import { useEffect, useRef, useState } from "react";
import type { SimState } from "@/sim/types";
import { fieldStatus } from "@/sim/engine";
import { useLang } from "@/i18n/LangContext";
import { TONE_HSL, type Tone } from "./primitives";
import { buildLayout, isFlying, trackFor, type BaseLayout } from "./scene/world";
import {
  drawAircraft,
  drawBackground,
  drawHaze,
  drawMinimap,
  drawPrecip,
  skyColours,
  toneOf,
  worldToScreen,
  type Camera,
  type Particle,
  type Sprite,
  type ToneKey,
} from "./scene/draw";

/** Wide-area radius shown on the minimap, metres. */
const MINIMAP_RANGE_M = 320_000;
const TRAIL_LEN = 26;

interface TrailStore {
  [id: string]: { x: number; y: number }[];
}

export function BaseCanvas({
  state,
  selected,
  onSelect,
}: {
  state: SimState;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useLang();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const selRef = useRef(selected);
  selRef.current = selected;

  const layoutRef = useRef<BaseLayout | null>(null);
  const camRef = useRef<Camera>({ scale: 0.1, w: 300, h: 200 });
  const trailsRef = useRef<TrailStore>({});
  const particlesRef = useRef<Particle[]>([]);
  const bgKeyRef = useRef("");
  /** Screen positions from the last frame, for hit-testing clicks. */
  const hitsRef = useRef<{ id: string; x: number; y: number }[]>([]);
  /** The draw function, so it can be invoked outside the animation loop. */
  const drawRef = useRef<((dt: number) => void) | null>(null);

  const [offMap, setOffMap] = useState(0);

  // Rebuild the layout when the base configuration changes.
  const layoutKey = `${state.config.baseType}|${state.config.runwayHeadingDeg}|${state.slots.length}|${state.bays.length}|${state.aircraft.length}`;
  const layoutKeyRef = useRef("");
  if (layoutKeyRef.current !== layoutKey) {
    layoutKeyRef.current = layoutKey;
    layoutRef.current = buildLayout(state);
    bgKeyRef.current = "";
    trailsRef.current = {};
  }

  useEffect(() => {
    const wrap = wrapRef.current;
    const main = mainRef.current;
    const mini = miniRef.current;
    if (!wrap || !main || !mini) return;

    const bg = document.createElement("canvas");
    bgRef.current = bg;

    let raf = 0;
    let lastPaint = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      for (const cv of [main, bg]) {
        cv.width = Math.floor(w * dpr);
        cv.height = Math.floor(h * dpr);
      }
      main.style.width = `${w}px`;
      main.style.height = `${h}px`;
      const mw = Math.min(230, Math.max(150, Math.floor(w * 0.24)));
      mini.width = Math.floor(mw * dpr);
      mini.height = Math.floor(mw * dpr);
      mini.style.width = `${mw}px`;
      mini.style.height = `${mw}px`;

      const layout = layoutRef.current!;
      // Fit the base view to the airfield with a margin.
      const scale = Math.min(w, h) / (layout.viewHalf * 2.25);
      camRef.current = { scale, w, h };
      const ctx = main.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bg.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
      mini.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
      bgKeyRef.current = "";
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const draw = (dt: number) => {

      const s = stateRef.current;
      const layout = layoutRef.current!;
      const cam = camRef.current;
      const ctx = main.getContext("2d");
      const mctx = mini.getContext("2d");
      if (!ctx || !mctx) return;

      // ── background, cached ──────────────────────────────────────────────
      const lightBucket = Math.round(s.solar.daylight * 12) / 12;
      const bgKey = `${cam.w}x${cam.h}|${lightBucket}|${layoutKeyRef.current}`;
      if (bgKeyRef.current !== bgKey) {
        bgKeyRef.current = bgKey;
        drawBackground(bg.getContext("2d")!, layout, cam, lightBucket, {
          slots: t("scene.prepSlots"),
          maintenance: t("scene.maintenance"),
          apron: t("scene.apron"),
          queue: t("scene.queue"),
        });
      }

      const [skyTop] = skyColours(s.solar.daylight, s.solar.elevationDeg);
      ctx.fillStyle = skyTop;
      ctx.fillRect(0, 0, cam.w, cam.h);
      ctx.drawImage(bg, 0, 0, cam.w, cam.h);

      // ── aircraft ────────────────────────────────────────────────────────
      let readyN = 0;
      let queueN = 0;
      const hits: { id: string; x: number; y: number }[] = [];
      const miniSprites: { x: number; y: number; hdg: number; tone: ToneKey; range: number }[] = [];
      let off = 0;

      for (const ac of s.aircraft) {
        const tr = trackFor(ac, s, layout);
        let world = tr.pos;

        // Parked aircraft need an index-assigned spot; the flight model returns a
        // placeholder for those states.
        if (!isFlying(ac) && ac.status !== "recovering" && ac.status !== "awaiting_launch") {
          if (ac.status === "unavailable" || (ac.status === "under_maintenance" && ac.bay === null)) {
            world = layout.queue[queueN % layout.queue.length] ?? world;
            queueN++;
          } else if (ac.status === "in_preparation" && ac.slot !== null) {
            world = layout.slots[ac.slot].c;
          } else if (ac.status === "under_maintenance" && ac.bay !== null) {
            world = layout.bays[ac.bay].c;
          } else {
            world = layout.apron[readyN % layout.apron.length] ?? world;
            readyN++;
          }
        }

        const tone = toneOf(ac.status) as ToneKey;
        if (isFlying(ac)) {
          miniSprites.push({ x: world.x, y: world.y, hdg: tr.hdg, tone, range: tr.range });
          if (Math.hypot(world.x, world.y) > MINIMAP_RANGE_M) off++;
        }

        const scr = worldToScreen(world, cam);
        const margin = 40;
        const visible = scr.x > -margin && scr.x < cam.w + margin && scr.y > -margin && scr.y < cam.h + margin;

        // Trails only for airborne aircraft inside the view.
        const trail = (trailsRef.current[ac.id] ??= []);
        if (isFlying(ac) && visible) {
          trail.push({ x: scr.x, y: scr.y });
          if (trail.length > TRAIL_LEN) trail.shift();
        } else if (trail.length) {
          trail.length = 0;
        }

        if (!visible) continue;

        const sprite: Sprite = {
          x: scr.x,
          y: scr.y,
          hdg: tr.hdg,
          climb: tr.climb,
          tone,
          tail: ac.tail,
          selected: selRef.current === ac.id,
          trail,
        };
        drawAircraft(ctx, sprite, cam.scale > 0.03);
        hits.push({ id: ac.id, x: scr.x, y: scr.y });
      }
      hitsRef.current = hits;
      if (off !== offMap) setOffMap(off);

      // ── weather ─────────────────────────────────────────────────────────
      const want = s.weather.precip === "none" ? 0 : Math.round(Math.min(220, 30 + s.weather.precipRate * 28));
      const parts = particlesRef.current;
      while (parts.length < want) parts.push({ x: Math.random() * cam.w, y: Math.random() * cam.h, sway: Math.random() * 6.28 });
      if (parts.length > want) parts.length = want;
      const snowy = s.weather.precip === "snow" || s.weather.precip === "sleet";
      const fall = snowy ? 70 : 430;
      const drift = (s.weather.windKts / 30) * (snowy ? 95 : 45);
      for (const p of parts) {
        p.sway += dt * 2;
        p.y += (fall + (snowy ? Math.sin(p.sway) * 6 : 0)) * dt;
        p.x += (drift + (snowy ? Math.sin(p.sway) * 16 : 0)) * dt;
        if (p.y > cam.h) {
          p.y = -6;
          p.x = Math.random() * cam.w;
        }
        if (p.x > cam.w + 8) p.x -= cam.w + 16;
        if (p.x < -8) p.x += cam.w + 16;
      }
      drawPrecip(ctx, parts, snowy, cam);
      drawHaze(ctx, cam, s.weather.visibilityM);

      // ── field status banner ─────────────────────────────────────────────
      const field = fieldStatus(s);
      if (!field.open) {
        const closed = s.runwayClosedUntil !== null && s.hours < s.runwayClosedUntil;
        const label = closed ? t("scene.runwayClosed") : t("scene.launchBan");
        ctx.font = "700 12px 'JetBrains Mono', monospace";
        const wTxt = ctx.measureText(label).width + 26;
        ctx.fillStyle = "hsl(0 0% 0% / 0.6)";
        ctx.beginPath();
        ctx.roundRect(cam.w / 2 - wTxt / 2, 10, wTxt, 26, 4);
        ctx.fill();
        ctx.strokeStyle = `hsl(${TONE_HSL.red})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "hsl(353 85% 68%)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, cam.w / 2, 24);
      }

      // ── minimap ─────────────────────────────────────────────────────────
      const mcam: Camera = { scale: 1, w: mini.clientWidth, h: mini.clientHeight };
      drawMinimap(mctx, s, miniSprites, mcam, MINIMAP_RANGE_M, layout.viewHalf, off, t("scene.offMap"));
    };

    drawRef.current = draw;

    // Paint immediately so the canvas is never blank — animation frames do not
    // arrive at all while the tab is hidden, and a canvas has no DOM fallback.
    draw(0);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // Cap the draw rate. The simulation advances independently of this.
      if (now - lastPaint < 1000 / 45) return;
      const dt = lastPaint === 0 ? 0 : Math.min((now - lastPaint) / 1000, 0.1);
      lastPaint = now;
      draw(dt);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      drawRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (document.hidden) drawRef.current?.(0);
  });

  const onClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    let best: { id: string; d: number } | null = null;
    for (const h of hitsRef.current) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < 18 && (!best || d < best.d)) best = { id: h.id, d };
    }
    onSelect(best ? (best.id === selected ? null : best.id) : null);
  };

  return (
    <div ref={wrapRef} className="relative w-full h-full min-h-0 rounded-lg overflow-hidden" style={{ background: "hsl(226 40% 9%)" }}>
      <canvas ref={mainRef} onClick={onClick} className="block cursor-pointer" />

      {/* Minimap, bottom right */}
      <div className="absolute bottom-2 right-2">
        <canvas ref={miniRef} className="block rounded-lg" style={{ border: "1px solid hsl(180 40% 60% / 0.25)" }} />
        <div
          className="absolute -top-4 left-0 text-[8px] font-mono font-bold tracking-widest"
          style={{ color: "hsl(180 30% 70% / 0.6)" }}
        >
          {t("scene.wideArea", { km: Math.round(MINIMAP_RANGE_M / 1000) })}
        </div>
      </div>

      {/* Wind + runway count */}
      <div className="absolute top-2 left-2 flex flex-col gap-1 pointer-events-none">
        <div className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(226 40% 8% / 0.7)", color: "hsl(200 25% 82%)" }}>
          {t("scene.wind", {
            dir: state.weather.windDirDeg.toFixed(0).padStart(3, "0"),
            kts: state.weather.windKts.toFixed(0),
          })}
        </div>
        <div className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(226 40% 8% / 0.7)", color: "hsl(200 25% 82%)" }}>
          {t("scene.runwayCount", { n: layoutRef.current?.runways.length ?? 1 })}
        </div>
      </div>

      {selected && <SelectedCard state={state} id={selected} onClose={() => onSelect(null)} />}

      <div className="absolute bottom-1.5 left-2 text-[9px] font-mono pointer-events-none" style={{ color: "hsl(200 20% 80% / 0.4)" }}>
        {t("scene.legend")}
      </div>
    </div>
  );
}

function SelectedCard({ state, id, onClose }: { state: SimState; id: string; onClose: () => void }) {
  const { t, tm } = useLang();
  const ac = state.aircraft.find((a) => a.id === id);
  if (!ac) return null;
  const tone = toneOf(ac.status) as Tone;
  const layout = buildLayout(state);
  const tr = trackFor(ac, state, layout);
  const flying = isFlying(ac);

  return (
    <div
      className="absolute top-2 right-2 rounded-lg px-2.5 py-2 backdrop-blur-sm w-52"
      style={{ background: "hsl(226 40% 10% / 0.9)", border: `1px solid hsl(${TONE_HSL[tone]} / 0.55)` }}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono font-bold text-[12px] text-white">{ac.tail}</span>
        <span
          className="text-[9px] font-mono px-1 py-px rounded"
          style={{ background: `hsl(${TONE_HSL[tone]} / 0.25)`, color: `hsl(${TONE_HSL[tone]})` }}
        >
          {t(`status.${ac.status}`)}
        </span>
        <button onClick={onClose} className="ml-auto text-[11px] leading-none opacity-50 hover:opacity-100 text-white">
          ✕
        </button>
      </div>
      <div className="mt-1 text-[9px] font-mono" style={{ color: "hsl(200 20% 78%)" }}>
        {ac.activity ? tm(ac.activity) : t("fleet.onApron")}
      </div>
      {flying && (
        <div className="mt-1 text-[9px] font-mono tnum" style={{ color: "hsl(42 64% 70%)" }}>
          {t("scene.rangeBearing", { km: (tr.range / 1000).toFixed(0), brg: tr.hdg.toFixed(0).padStart(3, "0") })}
        </div>
      )}
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
