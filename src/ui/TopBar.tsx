import { Languages, Pause, Play, RotateCcw, SkipForward, Sunrise, Sunset } from "lucide-react";
import { clsx } from "clsx";
import { TIMESCALES, type SimController } from "./useSimulation";
import { fulfilment } from "@/sim/engine";
import { isAirborne, isMissionCapable } from "@/sim/types";
import { TONE_HSL } from "./primitives";
import { useLang } from "@/i18n/LangContext";
import { LANGUAGES } from "@/i18n";

function hhmm(hourOfDay: number): { hh: string; mm: string; ss: string } {
  const total = Math.floor(hourOfDay * 3600);
  const hh = String(Math.floor(total / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return { hh, mm, ss };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

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

export function TopBar({ ctl }: { ctl: SimController }) {
  const { t, lang, setLang } = useLang();
  const state = ctl.run[ctl.focus];
  const { hh, mm, ss } = hhmm(state.hourOfDay);
  const day = Math.floor(state.hours / 24) + 1;
  const mc = state.aircraft.filter((a) => isMissionCapable(a.status)).length;
  const air = state.aircraft.filter((a) => isAirborne(a.status)).length;
  const total = state.aircraft.length;
  const ff = fulfilment(state);

  return (
    <header className="relative shrink-0 overflow-hidden" style={{ background: "hsl(220 63% 13%)" }}>
      <div className="absolute inset-0 scanline opacity-30" />

      <div className="relative flex items-center gap-3 px-3 py-2 flex-wrap">
        {/* Identity */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className="h-8 w-8 rounded-lg grid place-items-center font-sans font-black text-sm"
            style={{ background: "var(--gradient-gold)", color: "hsl(220 63% 14%)" }}
          >
            FB
          </div>
          <div className="leading-tight">
            <div className="font-sans font-bold text-[13px] text-white tracking-tight">{t("app.title")}</div>
            <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "hsl(200 12% 66%)" }}>
              {t("app.subtitle")}
            </div>
          </div>
        </div>

        <div className="h-9 w-px shrink-0" style={{ background: "hsl(200 12% 100% / 0.14)" }} />

        {/* Fleet snapshot */}
        <div className="flex items-center gap-4 shrink-0">
          <Pill label={t("app.available")} value={`${mc}`} of={`${total}`} tone="green" />
          <Pill label={t("app.airborne")} value={`${air}`} tone="blue" />
          <Pill
            label={t("app.fulfilment")}
            value={`${(ff * 100).toFixed(0)}%`}
            tone={ff > 0.85 ? "green" : ff > 0.6 ? "amber" : "red"}
          />
        </div>

        <div className="flex-1 min-w-4" />

        {/* Light state + sun times */}
        <div className="hidden 2xl:flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-end leading-tight">
            <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "hsl(200 12% 62%)" }}>
              {t(`light.${state.solar.light}`)}
            </span>
            <span className="text-[10px] font-mono tnum" style={{ color: "hsl(42 64% 68%)" }}>
              {t("app.daylightHours", { h: state.solar.dayLengthHours.toFixed(1) })}
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
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex flex-col items-end leading-tight">
            <span className="text-[10px] font-mono font-bold tracking-widest" style={{ color: "hsl(200 12% 72%)" }}>
              {dateLabel(state.dayOfYear)}
            </span>
            <span className="text-[9px] font-mono tracking-widest" style={{ color: "hsl(200 12% 55%)" }}>
              {t("app.day")} {day}
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
          <div className="flex items-center gap-0.5">
            {TIMESCALES.map((s) => (
              <button
                key={s.value}
                onClick={() => ctl.setTimescale(s.value)}
                title={s.note}
                className="px-1.5 py-1 text-[10px] font-mono font-bold rounded transition-all duration-100 active:scale-95"
                style={
                  ctl.timescale === s.value
                    ? { background: "hsl(42 64% 53% / 0.28)", color: "hsl(42 64% 74%)", border: "1px solid hsl(42 64% 53% / 0.6)" }
                    : { background: "transparent", color: "hsl(200 12% 58%)", border: "1px solid hsl(200 12% 100% / 0.16)" }
                }
              >
                {s.label}
              </button>
            ))}
          </div>

          <IconBtn
            onClick={ctl.toggleRun}
            title={ctl.running ? t("app.pause") : t("app.start")}
            tone={ctl.running ? "hsl(42 64% 66%)" : "hsl(152 60% 58%)"}
            emphasise={!ctl.running}
          >
            {ctl.running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </IconBtn>
          <IconBtn onClick={() => ctl.stepBy(1)} title={t("app.stepHour")} tone="hsl(200 12% 78%)">
            <SkipForward className="h-4 w-4" />
          </IconBtn>
          <IconBtn onClick={() => ctl.reset()} title={t("app.reset")} tone="hsl(200 12% 78%)">
            <RotateCcw className="h-4 w-4" />
          </IconBtn>

          {/* Language */}
          <div
            className="flex items-center gap-0.5 ml-1 pl-1.5"
            style={{ borderLeft: "1px solid hsl(200 12% 100% / 0.14)" }}
            title={t("app.language")}
          >
            <Languages className="h-3.5 w-3.5 mr-0.5" style={{ color: "hsl(200 12% 60%)" }} />
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                onClick={() => setLang(l.id)}
                title={l.label}
                className="px-1.5 py-1 text-[10px] font-mono font-bold rounded transition-all duration-100 active:scale-95"
                style={
                  lang === l.id
                    ? { background: "hsl(42 64% 53% / 0.28)", color: "hsl(42 64% 74%)", border: "1px solid hsl(42 64% 53% / 0.6)" }
                    : { background: "transparent", color: "hsl(200 12% 58%)", border: "1px solid hsl(200 12% 100% / 0.16)" }
                }
              >
                {l.flag}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}

function Pill({ label, value, of, tone }: { label: string; value: string; of?: string; tone: keyof typeof TONE_HSL }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "hsl(200 12% 58%)" }}>
        {label}
      </span>
      <span
        className="font-mono font-black text-base tnum"
        style={{ color: `hsl(${TONE_HSL[tone]})`, filter: "brightness(1.8)" }}
      >
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
  emphasise,
  children,
}: {
  onClick: () => void;
  title: string;
  tone: string;
  emphasise?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx("p-2 rounded-lg transition-all duration-100 hover:bg-white/10 active:scale-95")}
      style={
        emphasise
          ? { color: tone, background: "hsl(152 60% 40% / 0.2)", border: "1px solid hsl(152 60% 45% / 0.5)" }
          : { color: tone }
      }
    >
      {children}
    </button>
  );
}
