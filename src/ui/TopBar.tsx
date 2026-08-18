import { Pause, Play, RotateCcw, SkipForward, Sunrise, Sunset } from "lucide-react";
import { clsx } from "clsx";
import { TIMESCALES, type SimController } from "./useSimulation";
import { LIGHT_LABEL } from "@/sim/solar";
import { fulfilment } from "@/sim/engine";
import { isAirborne, isMissionCapable } from "@/sim/types";
import { TONE_HSL } from "./primitives";

function hhmm(hourOfDay: number): { hh: string; mm: string; ss: string } {
  const total = Math.floor(hourOfDay * 3600);
  const hh = String(Math.floor(total / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return { hh, mm, ss };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAJ", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEC"];

function dateLabel(dayOfYear: number): string {
  const cum = [31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
  let m = 0;
  while (m < 11 && dayOfYear > cum[m]) m++;
  const dom = dayOfYear - (m === 0 ? 0 : cum[m - 1]);
  return `${String(dom).padStart(2, "0")} ${MONTHS[m]}`;
}

function decimalHour(h: number | null): string {
  if (h === null) return "—";
  const hh = String(Math.floor(h)).padStart(2, "0");
  const mm = String(Math.round((h % 1) * 60)).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * The sky strip is driven directly by the solar model — it is the day/night
 * cycle made visible rather than decorative. At 58°N in January it spends most
 * of the run dark, which is exactly the point.
 */
function skyGradient(daylight: number, elevationDeg: number): string {
  if (daylight <= 0.02) return "linear-gradient(180deg, hsl(226 45% 9%), hsl(222 40% 14%))";
  if (elevationDeg < 4) {
    // Low sun: the long Nordic twilight, warm at the horizon.
    return `linear-gradient(180deg, hsl(${220 - daylight * 10} 45% ${12 + daylight * 22}%), hsl(${28 + daylight * 8} ${55 + daylight * 15}% ${28 + daylight * 22}%))`;
  }
  return `linear-gradient(180deg, hsl(212 ${52 + daylight * 12}% ${28 + daylight * 26}%), hsl(203 ${44 + daylight * 14}% ${52 + daylight * 24}%))`;
}

export function TopBar({ ctl }: { ctl: SimController }) {
  const state = ctl.run[ctl.focus];
  const { hh, mm, ss } = hhmm(state.hourOfDay);
  const day = Math.floor(state.hours / 24) + 1;
  const mc = state.aircraft.filter((a) => isMissionCapable(a.status)).length;
  const air = state.aircraft.filter((a) => isAirborne(a.status)).length;
  const total = state.aircraft.length;
  const ff = fulfilment(state);

  return (
    <header className="relative shrink-0 overflow-hidden" style={{ background: "hsl(220 63% 14%)" }}>
      {/* Sky band — the day/night cycle, from real solar geometry */}
      <div
        className="absolute inset-0 transition-[background] duration-1000"
        style={{ background: skyGradient(state.solar.daylight, state.solar.elevationDeg), opacity: 0.55 }}
      />
      <div className="absolute inset-0 scanline opacity-40" />

      <div className="relative flex items-center gap-4 px-4 py-2.5">
        {/* Identity */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className="h-8 w-8 rounded-lg grid place-items-center font-sans font-black text-sm"
            style={{ background: "var(--gradient-gold)", color: "hsl(220 63% 14%)" }}
          >
            FB
          </div>
          <div className="leading-tight">
            <div className="font-sans font-bold text-[13px] text-white tracking-tight">FLYGBASSIMULERING</div>
            <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "hsl(200 12% 68%)" }}>
              Klargöring · Underhåll · Uthållighet
            </div>
          </div>
        </div>

        <div className="h-9 w-px shrink-0" style={{ background: "hsl(200 12% 100% / 0.14)" }} />

        {/* Fleet snapshot */}
        <div className="flex items-center gap-4 shrink-0">
          <FleetPill label="TILLGÄNGLIGA" value={`${mc}`} of={`${total}`} tone="green" />
          <FleetPill label="I LUFTEN" value={`${air}`} tone="blue" />
          <FleetPill label="UPPFYLLNAD" value={`${(ff * 100).toFixed(0)}%`} tone={ff > 0.85 ? "green" : ff > 0.6 ? "amber" : "red"} />
        </div>

        <div className="flex-1" />

        {/* Light state + sun times */}
        <div className="hidden xl:flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-end leading-tight">
            <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "hsl(200 12% 62%)" }}>
              {LIGHT_LABEL[state.solar.light]}
            </span>
            <span className="text-[10px] font-mono tnum" style={{ color: "hsl(42 64% 68%)" }}>
              {state.solar.dayLengthHours.toFixed(1)} h dagsljus
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1 text-[10px] font-mono tnum" style={{ color: "hsl(200 12% 76%)" }}>
              <Sunrise className="h-3 w-3" /> {decimalHour(state.solar.sunriseHour)}
            </span>
            <span className="flex items-center gap-1 text-[10px] font-mono tnum" style={{ color: "hsl(200 12% 76%)" }}>
              <Sunset className="h-3 w-3" /> {decimalHour(state.solar.sunsetHour)}
            </span>
          </div>
        </div>

        <div className="h-9 w-px shrink-0" style={{ background: "hsl(200 12% 100% / 0.14)" }} />

        {/* Date + clock */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-end leading-tight">
            <span className="text-[10px] font-mono font-bold tracking-widest" style={{ color: "hsl(200 12% 72%)" }}>
              {dateLabel(state.dayOfYear)}
            </span>
            <span className="text-[9px] font-mono tracking-widest" style={{ color: "hsl(200 12% 55%)" }}>
              DYGN {day}
            </span>
          </div>
          <div className="flex items-baseline gap-0.5 font-mono font-black tnum" style={{ color: "hsl(42 64% 66%)" }}>
            <span className="text-3xl leading-none">
              {hh}:{mm}
            </span>
            <span className="text-base leading-none opacity-55">:{ss}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-0.5 mr-1">
            {TIMESCALES.map((t) => (
              <button
                key={t.value}
                onClick={() => ctl.setTimescale(t.value)}
                title={t.note}
                className="px-2 py-1 text-[10px] font-mono font-bold rounded transition-all duration-100 active:scale-95"
                style={
                  ctl.timescale === t.value
                    ? {
                        background: "hsl(42 64% 53% / 0.28)",
                        color: "hsl(42 64% 74%)",
                        border: "1px solid hsl(42 64% 53% / 0.6)",
                      }
                    : {
                        background: "transparent",
                        color: "hsl(200 12% 58%)",
                        border: "1px solid hsl(200 12% 100% / 0.16)",
                      }
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          <IconBtn
            onClick={ctl.toggleRun}
            title={ctl.running ? "Pausa" : "Starta"}
            tone={ctl.running ? "hsl(42 64% 66%)" : "hsl(152 60% 58%)"}
          >
            {ctl.running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </IconBtn>
          <IconBtn onClick={() => ctl.stepBy(1)} title="Stega 1 timme" tone="hsl(200 12% 78%)">
            <SkipForward className="h-4 w-4" />
          </IconBtn>
          <IconBtn onClick={() => ctl.reset()} title="Återställ" tone="hsl(200 12% 78%)">
            <RotateCcw className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>
    </header>
  );
}

function FleetPill({
  label,
  value,
  of,
  tone,
}: {
  label: string;
  value: string;
  of?: string;
  tone: keyof typeof TONE_HSL;
}) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "hsl(200 12% 58%)" }}>
        {label}
      </span>
      <span className="font-mono font-black text-base tnum" style={{ color: `hsl(${TONE_HSL[tone]} / 0.95)`, filter: "brightness(1.75)" }}>
        {value}
        {of && <span className="text-[10px] opacity-50">/{of}</span>}
      </span>
    </div>
  );
}

function IconBtn({
  onClick,
  title,
  tone,
  children,
}: {
  onClick: () => void;
  title: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx("p-2 rounded-lg transition-all duration-100 hover:bg-white/10 active:scale-95")}
      style={{ color: tone }}
    >
      {children}
    </button>
  );
}
