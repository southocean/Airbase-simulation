/**
 * Canvas drawing for the base scene.
 *
 * Why canvas and not SVG: the previous version mutated a `transform` attribute
 * on one SVG group per aircraft every frame, plus ~150 precipitation nodes. Every
 * write invalidates layout and style for that element, and the browser recomputes
 * and repaints a retained scene graph it has no reason to keep. That is what the
 * lag was. Canvas draws an immediate-mode frame with no retained nodes, so the
 * cost is proportional to what is actually drawn.
 *
 * The static airfield is rendered once into an offscreen canvas and blitted, so
 * per-frame work is only the moving parts.
 */
import type { SimState } from "@/sim/types";
import { designator, type BaseLayout, type Runway, type Vec } from "./world";

export interface Camera {
  /** Canvas pixels per metre */
  scale: number;
  /** Canvas size in CSS pixels */
  w: number;
  h: number;
}

export function worldToScreen(p: Vec, cam: Camera): Vec {
  return { x: cam.w / 2 + p.x * cam.scale, y: cam.h / 2 + p.y * cam.scale };
}

const TONE = {
  green: "hsl(152 60% 42%)",
  amber: "hsl(42 74% 56%)",
  red: "hsl(353 80% 58%)",
  blue: "hsl(205 75% 62%)",
  grey: "hsl(210 12% 62%)",
};

export type ToneKey = keyof typeof TONE;

export function toneOf(status: string): ToneKey {
  switch (status) {
    case "ready":
    case "awaiting_launch":
      return "green";
    case "recovering":
    case "under_maintenance":
      return "amber";
    case "unavailable":
      return "red";
    default:
      return "blue";
  }
}

// ── static background ───────────────────────────────────────────────────────

/**
 * Render the airfield to an offscreen canvas.
 *
 * Called only when the size, layout or light level changes materially — not per
 * frame. `light` is bucketed by the caller so dawn does not trigger a redraw
 * sixty times a second.
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  layout: BaseLayout,
  cam: Camera,
  light: number,
  labels: { slots: string; maintenance: string; apron: string; queue: string },
): void {
  const L = 0.16 + light * 0.6;
  ctx.clearRect(0, 0, cam.w, cam.h);

  // Ground
  const g = ctx.createLinearGradient(0, 0, 0, cam.h);
  g.addColorStop(0, `hsl(140 16% ${7 + L * 15}%)`);
  g.addColorStop(1, `hsl(145 14% ${4 + L * 10}%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cam.w, cam.h);

  // Faint survey grid, 500 m
  ctx.strokeStyle = `hsl(170 30% 60% / ${0.03 + light * 0.03})`;
  ctx.lineWidth = 1;
  const step = 500 * cam.scale;
  if (step > 8) {
    ctx.beginPath();
    for (let x = (cam.w / 2) % step; x < cam.w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cam.h);
    }
    for (let y = (cam.h / 2) % step; y < cam.h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(cam.w, y);
    }
    ctx.stroke();
  }

  // Taxiways
  for (const path of layout.taxi) {
    ctx.strokeStyle = `hsl(215 8% ${11 + L * 12}%)`;
    ctx.lineWidth = Math.max(3, 55 * cam.scale);
    ctx.lineCap = "round";
    ctx.beginPath();
    path.forEach((p, i) => {
      const s = worldToScreen(p, cam);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.strokeStyle = `hsl(52 70% 62% / 0.2)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 12]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Runways
  layout.runways.forEach((r, i) => drawRunway(ctx, r, cam, L, i));

  // Pads
  for (const [i, pad] of layout.slots.entries()) drawPad(ctx, pad, cam, "hsl(205 60% 60%)", String(i + 1));
  for (const [i, pad] of layout.bays.entries()) drawHangar(ctx, pad, cam, i);

  // Apron and holding outlines
  drawArea(ctx, layout.apron, cam, "hsl(200 20% 60% / 0.16)", "hsl(210 14% 16% / 0.5)");
  drawArea(ctx, layout.queue, cam, "hsl(353 74% 55% / 0.25)", "hsl(353 60% 30% / 0.1)");

  // Labels
  ctx.font = "600 10px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  const lbl = (text: string, at: Vec, colour: string) => {
    const s = worldToScreen(at, cam);
    ctx.fillStyle = colour;
    ctx.fillText(text.toUpperCase(), s.x, s.y);
  };
  if (layout.slots.length) lbl(labels.slots, offsetOf(layout.slots[0].c, -110, -95), "hsl(205 40% 72% / 0.65)");
  if (layout.bays.length) lbl(labels.maintenance, offsetOf(layout.bays[0].c, -110, -100), "hsl(42 50% 72% / 0.65)");
  if (layout.apron.length) lbl(labels.apron, offsetOf(layout.apron[0], -70, -60), "hsl(200 20% 76% / 0.5)");
  if (layout.queue.length) lbl(labels.queue, offsetOf(layout.queue[0], -60, -60), "hsl(353 60% 72% / 0.6)");
}

function offsetOf(p: Vec, dx: number, dy: number): Vec {
  return { x: p.x + dx, y: p.y + dy };
}

function drawRunway(ctx: CanvasRenderingContext2D, r: Runway, cam: Camera, L: number, index: number): void {
  const c = worldToScreen(r.c, cam);
  const len = r.len * cam.scale;
  const wid = Math.max(6, r.width * cam.scale);
  const ang = Math.atan2(r.along.y, r.along.x);

  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(ang);

  // Asphalt
  ctx.fillStyle = `hsl(220 6% ${8 + L * 12}%)`;
  ctx.fillRect(-len / 2, -wid / 2, len, wid);
  ctx.strokeStyle = `hsl(200 15% 70% / 0.28)`;
  ctx.lineWidth = 1;
  ctx.strokeRect(-len / 2, -wid / 2, len, wid);

  // Centreline
  ctx.strokeStyle = "hsl(50 80% 92% / 0.45)";
  ctx.lineWidth = Math.max(1, wid * 0.045);
  ctx.setLineDash([Math.max(6, len * 0.035), Math.max(6, len * 0.028)]);
  ctx.beginPath();
  ctx.moveTo(-len / 2 + len * 0.05, 0);
  ctx.lineTo(len / 2 - len * 0.05, 0);
  ctx.stroke();
  ctx.setLineDash([]);

  // Threshold bars at both ends
  ctx.fillStyle = "hsl(50 70% 92% / 0.4)";
  const bars = 6;
  for (const side of [-1, 1]) {
    for (let i = 0; i < bars; i++) {
      const off = (i - (bars - 1) / 2) * (wid / bars);
      ctx.fillRect(side * (len / 2 - Math.max(6, len * 0.035)) - (side > 0 ? 0 : 0), off - wid / bars / 4, Math.max(4, len * 0.022) * -side, wid / bars / 2);
    }
  }

  // Designators
  if (wid > 12) {
    ctx.fillStyle = "hsl(50 70% 92% / 0.6)";
    ctx.font = `700 ${Math.max(9, Math.min(16, wid * 0.5))}px 'JetBrains Mono', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(-len / 2 + Math.max(18, len * 0.075), 0);
    ctx.rotate(-ang);
    ctx.fillText(r.desigA, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(len / 2 - Math.max(18, len * 0.075), 0);
    ctx.rotate(-ang);
    ctx.fillText(designator(r.hdg + 180), 0, 0);
    ctx.restore();
  }
  ctx.restore();
  void index;
}

function drawPad(ctx: CanvasRenderingContext2D, pad: Pad2, cam: Camera, colour: string, tag: string): void {
  const c = worldToScreen(pad.c, cam);
  const w = Math.max(6, pad.w * cam.scale);
  const h = Math.max(6, pad.h * cam.scale);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate((pad.hdg * Math.PI) / 180);
  ctx.fillStyle = colour.replace(")", " / 0.09)").replace("hsl(", "hsl(");
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = colour.replace(")", " / 0.4)");
  ctx.lineWidth = 1;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  if (w > 22) {
    ctx.fillStyle = colour.replace(")", " / 0.85)");
    ctx.font = "700 9px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(tag, -w / 2 + 3, -h / 2 + 2);
  }
  ctx.restore();
}

interface Pad2 {
  c: Vec;
  w: number;
  h: number;
  hdg: number;
}

function drawHangar(ctx: CanvasRenderingContext2D, pad: Pad2, cam: Camera, i: number): void {
  drawPad(ctx, pad, cam, "hsl(42 70% 60%)", ["S", "S", "L", "L", "H", "H"][i] ?? "S");
}

function drawArea(ctx: CanvasRenderingContext2D, pts: Vec[], cam: Camera, stroke: string, fill: string): void {
  if (pts.length === 0) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    const s = worldToScreen(p, cam);
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x);
    maxY = Math.max(maxY, s.y);
  }
  const pad = 22;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.roundRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2, 6);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}

// ── aircraft ────────────────────────────────────────────────────────────────

export interface Sprite {
  x: number;
  y: number;
  hdg: number;
  climb: number;
  tone: ToneKey;
  tail: string;
  selected: boolean;
  trail: { x: number; y: number }[];
}

export function drawAircraft(ctx: CanvasRenderingContext2D, s: Sprite, showLabel: boolean): void {
  const colour = TONE[s.tone];

  // Trail
  if (s.trail.length > 1) {
    ctx.strokeStyle = colour.replace(")", " / 0.22)");
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(s.trail[0].x, s.trail[0].y);
    for (let i = 1; i < s.trail.length; i++) ctx.lineTo(s.trail[i].x, s.trail[i].y);
    ctx.stroke();
  }

  const size = 7 + s.climb * 3.5;

  ctx.save();
  ctx.translate(s.x, s.y);

  if (s.selected) {
    ctx.strokeStyle = "hsl(42 80% 66%)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, size * 2.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Shadow on the ground, offset with altitude — reads as height.
  if (s.climb > 0.05) {
    ctx.save();
    ctx.translate(s.climb * 9, s.climb * 11);
    ctx.rotate((s.hdg * Math.PI) / 180);
    ctx.fillStyle = "hsl(0 0% 0% / 0.28)";
    jetPath(ctx, size * 0.95);
    ctx.fill();
    ctx.restore();
  }

  ctx.rotate((s.hdg * Math.PI) / 180);
  ctx.fillStyle = colour;
  ctx.strokeStyle = "hsl(0 0% 0% / 0.5)";
  ctx.lineWidth = 0.8;
  jetPath(ctx, size);
  ctx.fill();
  ctx.stroke();

  // Exhaust glow when airborne
  if (s.climb > 0.1) {
    ctx.fillStyle = "hsl(30 95% 66% / 0.75)";
    ctx.beginPath();
    ctx.arc(0, size * 0.95, size * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (showLabel) {
    ctx.fillStyle = s.selected ? "hsl(42 80% 78%)" : "hsl(200 20% 88% / 0.72)";
    ctx.font = "700 9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(s.tail, s.x, s.y - size - 3);
  }
}

/** Slim delta, nose toward −y in local space. */
function jetPath(ctx: CanvasRenderingContext2D, r: number): void {
  const k = r / 11;
  ctx.beginPath();
  ctx.moveTo(0, -11 * k);
  ctx.lineTo(2.6 * k, -1 * k);
  ctx.lineTo(10 * k, 4.2 * k);
  ctx.lineTo(10 * k, 6.2 * k);
  ctx.lineTo(2.8 * k, 4.4 * k);
  ctx.lineTo(2.2 * k, 8.6 * k);
  ctx.lineTo(4.4 * k, 11 * k);
  ctx.lineTo(4.4 * k, 12.4 * k);
  ctx.lineTo(0, 11.2 * k);
  ctx.lineTo(-4.4 * k, 12.4 * k);
  ctx.lineTo(-4.4 * k, 11 * k);
  ctx.lineTo(-2.2 * k, 8.6 * k);
  ctx.lineTo(-2.8 * k, 4.4 * k);
  ctx.lineTo(-10 * k, 6.2 * k);
  ctx.lineTo(-10 * k, 4.2 * k);
  ctx.lineTo(-2.6 * k, -1 * k);
  ctx.closePath();
}

// ── weather overlay ─────────────────────────────────────────────────────────

export interface Particle {
  x: number;
  y: number;
  sway: number;
}

export function drawPrecip(
  ctx: CanvasRenderingContext2D,
  parts: Particle[],
  snowy: boolean,
  cam: Camera,
): void {
  if (parts.length === 0) return;
  if (snowy) {
    ctx.fillStyle = "hsl(200 30% 97% / 0.8)";
    for (const p of parts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = "hsl(205 60% 85% / 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of parts) {
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 1.5, p.y + 8);
    }
    ctx.stroke();
  }
  void cam;
}

export function drawHaze(ctx: CanvasRenderingContext2D, cam: Camera, visibilityM: number): void {
  if (visibilityM >= 4000) return;
  ctx.fillStyle = `hsl(210 18% 78% / ${Math.min(0.4, (4000 - visibilityM) / 9500)})`;
  ctx.fillRect(0, 0, cam.w, cam.h);
}

/** Sky band above the field, lit from the solar model. */
export function skyColours(daylight: number, elevationDeg: number): [string, string] {
  if (daylight <= 0.02) return ["hsl(226 44% 7%)", "hsl(224 38% 12%)"];
  if (elevationDeg < 4) {
    return [
      `hsl(${218 - daylight * 8} 42% ${9 + daylight * 20}%)`,
      `hsl(${26 + daylight * 10} ${52 + daylight * 18}% ${22 + daylight * 22}%)`,
    ];
  }
  return [
    `hsl(212 ${50 + daylight * 12}% ${22 + daylight * 26}%)`,
    `hsl(203 ${42 + daylight * 14}% ${46 + daylight * 24}%)`,
  ];
}

// ── minimap ─────────────────────────────────────────────────────────────────

/**
 * Wide-area view. Aircraft leave this too — the outer ring is the edge of the
 * drawn world, and anything beyond it is still being simulated, just not shown.
 */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  state: SimState,
  sprites: { x: number; y: number; hdg: number; tone: ToneKey; range: number }[],
  cam: Camera,
  rangeM: number,
  baseViewHalfM: number,
  offMapCount: number,
  offMapLabel: string,
): void {
  ctx.clearRect(0, 0, cam.w, cam.h);
  const cx = cam.w / 2;
  const cy = cam.h / 2;
  const r = Math.min(cam.w, cam.h) / 2 - 6;

  ctx.fillStyle = "hsl(210 40% 7% / 0.92)";
  ctx.beginPath();
  ctx.roundRect(0, 0, cam.w, cam.h, 8);
  ctx.fill();

  // Range rings, labelled in km
  ctx.font = "600 8px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const frac of [0.33, 0.66, 1]) {
    ctx.strokeStyle = `hsl(180 45% 62% / ${frac === 1 ? 0.28 : 0.14})`;
    ctx.lineWidth = 1;
    ctx.setLineDash(frac === 1 ? [] : [3, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * frac, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "hsl(180 30% 66% / 0.4)";
    ctx.fillText(`${Math.round((rangeM * frac) / 1000)}`, cx, cy - r * frac + 7);
  }

  // Cardinal ticks
  ctx.strokeStyle = "hsl(180 40% 60% / 0.16)";
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();

  const k = r / rangeM;

  // The base-view footprint, so the relationship between the two views is legible.
  const boxHalf = Math.max(2, baseViewHalfM * k);
  ctx.strokeStyle = "hsl(42 74% 60% / 0.75)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(cx - boxHalf, cy - boxHalf, boxHalf * 2, boxHalf * 2);

  // Base
  ctx.fillStyle = "hsl(42 80% 62%)";
  ctx.beginPath();
  ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
  ctx.fill();

  // Aircraft
  for (const s of sprites) {
    const px = cx + s.x * k;
    const py = cy + s.y * k;
    if (Math.hypot(px - cx, py - cy) > r - 1) continue;
    ctx.fillStyle = TONE[s.tone];
    ctx.beginPath();
    ctx.arc(px, py, 2.1, 0, Math.PI * 2);
    ctx.fill();
    // Heading tick
    const a = ((s.hdg - 90) * Math.PI) / 180;
    ctx.strokeStyle = TONE[s.tone];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(a) * 5, py + Math.sin(a) * 5);
    ctx.stroke();
  }

  if (offMapCount > 0) {
    ctx.fillStyle = "hsl(200 25% 82% / 0.75)";
    ctx.font = "700 9px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${offMapCount} ${offMapLabel}`, 7, cam.h - 6);
  }
}
