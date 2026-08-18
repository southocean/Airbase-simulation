/**
 * Shared visual primitives, matching the hackathon builds' conventions:
 * the status colour triple (text / 6-8 % background / 20 % border), the 10px
 * uppercase mono label, and the navy-header card.
 */
import type { ReactNode } from "react";
import { clsx } from "clsx";

export type Tone = "green" | "amber" | "red" | "blue" | "neutral";

export const TONE_HSL: Record<Tone, string> = {
  green: "152 60% 32%",
  amber: "42 64% 53%",
  red: "353 74% 47%",
  blue: "220 63% 38%",
  neutral: "218 15% 46%",
};

/** The status recipe: text at full, background at 7 %, border at 20 %. */
export function toneStyle(tone: Tone, opts: { bg?: number; border?: number } = {}) {
  const h = TONE_HSL[tone];
  return {
    color: `hsl(${h})`,
    background: `hsl(${h} / ${opts.bg ?? 0.07})`,
    border: `1px solid hsl(${h} / ${opts.border ?? 0.2})`,
  };
}

export function Card({
  title,
  right,
  children,
  className,
  dense,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <section className={clsx("card-premium rounded-lg overflow-hidden flex flex-col min-h-0", className)}>
      {title && (
        <header className="card-navy-header px-3 py-2 flex items-center justify-between gap-2 shrink-0">
          <h3 className="text-[11px] font-sans font-bold uppercase tracking-wider text-white/95">{title}</h3>
          {right}
        </header>
      )}
      <div className={clsx("min-h-0 flex-1", dense ? "p-2" : "p-3")}>{children}</div>
    </section>
  );
}

export function Chip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wide whitespace-nowrap"
      style={toneStyle(tone, { bg: 0.12, border: 0.28 })}
    >
      {children}
    </span>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("label-xs", className)}>{children}</div>;
}

/** A labelled numeric readout. Mono, tabular, with an optional unit and tone. */
export function Stat({
  label,
  value,
  unit,
  tone = "neutral",
  sub,
  big,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: Tone;
  sub?: string;
  big?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <Label>{label}</Label>
      <div className="flex items-baseline gap-1 min-w-0">
        <span
          className={clsx("font-mono font-black tnum leading-none truncate", big ? "text-2xl" : "text-base")}
          style={{ color: `hsl(${TONE_HSL[tone]})` }}
        >
          {value}
        </span>
        {unit && <span className="text-[10px] font-mono opacity-55 shrink-0">{unit}</span>}
      </div>
      {sub && <div className="text-[9px] font-mono opacity-50 truncate">{sub}</div>}
    </div>
  );
}

/** Horizontal capacity/level bar. */
export function Meter({
  value,
  max,
  tone,
  height = 6,
  showTrack = true,
}: {
  value: number;
  max: number;
  tone: Tone;
  height?: number;
  showTrack?: boolean;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ height, background: showTrack ? "hsl(220 20% 88%)" : "transparent" }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-200"
        style={{ width: `${pct * 100}%`, background: `hsl(${TONE_HSL[tone]})` }}
      />
    </div>
  );
}

export function levelTone(fraction: number): Tone {
  if (fraction <= 0.15) return "red";
  if (fraction <= 0.4) return "amber";
  return "green";
}

/** Provenance badge — makes the honesty of a number visible at the point of use. */
export function ProvBadge({ tag }: { tag: string }) {
  const tone: Tone = tag === "DECK" ? "green" : tag === "TIER-A" ? "blue" : tag === "TIER-C" ? "amber" : "red";
  return (
    <span
      className="px-1 py-px rounded text-[8px] font-mono font-bold tracking-wide"
      style={toneStyle(tone, { bg: 0.13, border: 0.3 })}
      title={
        tag === "DECK"
          ? "Från Saabs underlag — auktoritativt"
          : tag === "TIER-A"
            ? "Öppna auktoritativa data"
            : tag === "TIER-C"
              ? "Analogi från öppen litteratur"
              : "Antagande — kräver SME-validering"
      }
    >
      {tag}
    </span>
  );
}
