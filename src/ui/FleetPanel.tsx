import { AlertTriangle, Plane, Wrench } from "lucide-react";
import { AIRCRAFT_SPECS, SERVICE_INTERVAL_HOURS } from "@/sim/params";
import type { Aircraft, AircraftStatus, SimState } from "@/sim/types";
import { Card, Chip, Label, Meter, toneStyle, TONE_HSL, type Tone } from "./primitives";
import { useLang } from "@/i18n/LangContext";

const STATUS_TONE: Record<AircraftStatus, Tone> = {
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

/** Order the fleet by where each airframe is in the cycle, so the panel reads
 *  as a pipeline rather than an arbitrary list. */
const STATUS_ORDER: AircraftStatus[] = [
  "on_mission",
  "returning",
  "recovering",
  "awaiting_launch",
  "in_preparation",
  "allocated",
  "unavailable",
  "under_maintenance",
  "ready",
];

export function FleetPanel({ state }: { state: SimState }) {
  const { t } = useLang();
  const sorted = [...state.aircraft].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.tail.localeCompare(b.tail),
  );

  const counts = STATUS_ORDER.map((s) => ({
    status: s,
    n: state.aircraft.filter((a) => a.status === s).length,
  })).filter((x) => x.n > 0);

  return (
    <Card
      title={t("fleet.panel")}
      right={
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {counts.map(({ status, n }) => (
            <span
              key={status}
              className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold"
              style={{
                background: `hsl(${TONE_HSL[STATUS_TONE[status]]} / 0.25)`,
                color: "white",
                border: `1px solid hsl(${TONE_HSL[STATUS_TONE[status]]} / 0.5)`,
              }}
              title={t(`status.${status}`)}
            >
              {n} {t(`short.${status}`)}
            </span>
          ))}
        </div>
      }
      className="flex-1"
      dense
    >
      <div className="h-full overflow-y-auto grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5 pr-0.5 content-start">
        {sorted.map((ac) => (
          <AircraftCard key={ac.id} ac={ac} state={state} />
        ))}
      </div>
    </Card>
  );
}

function AircraftCard({ ac, state }: { ac: Aircraft; state: SimState }) {
  const { t, tm } = useLang();
  const tone = STATUS_TONE[ac.status];
  const spec = AIRCRAFT_SPECS[ac.type];
  const svcFrac = ac.hoursToService / SERVICE_INTERVAL_HOURS;
  const svcTone: Tone = svcFrac < 0.05 ? "red" : svcFrac < 0.15 ? "amber" : "green";

  // Progress through the current timed activity.
  let progress: number | null = null;
  if (ac.activityEndsAt !== null && ac.job === null) {
    // We do not store the activity start, so infer from the remaining time
    // against a nominal duration — good enough for a progress affordance.
    const remain = Math.max(0, ac.activityEndsAt - state.hours);
    const nominalHours =
      ac.status === "in_preparation"
        ? 0.75
        : ac.status === "recovering"
          ? 0.5
          : ac.status === "on_mission"
            ? 1.5
            : 0.3;
    progress = Math.max(0, Math.min(1, 1 - remain / nominalHours));
  } else if (ac.job && ac.job.totalHours > 0) {
    progress = Math.min(1, ac.job.doneHours / ac.job.totalHours);
  }

  const blocked = ac.status === "unavailable" && ac.job?.blockedBy;

  return (
    <div
      className="rounded-lg px-2 py-1.5 flex flex-col gap-1 transition-colors duration-150"
      style={toneStyle(tone, { bg: 0.06, border: 0.22 })}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {ac.status === "unavailable" || ac.status === "under_maintenance" ? (
          <Wrench className="h-3 w-3 shrink-0 opacity-70" />
        ) : (
          <Plane className="h-3 w-3 shrink-0 opacity-70" />
        )}
        <span className="font-mono font-bold text-[11px] tnum" style={{ color: "hsl(220 63% 18%)" }}>
          {ac.tail}
        </span>
        <span className="text-[9px] font-mono opacity-45 truncate">{spec.label}</span>
        <div className="flex-1" />
        <Chip tone={tone}>{t(`status.${ac.status}`)}</Chip>
      </div>

      {/* Current activity + progress */}
      <div className="flex items-center gap-1.5 min-w-0">
        {blocked ? (
          <AlertTriangle className="h-3 w-3 shrink-0 animate-pulse-red" style={{ color: `hsl(${TONE_HSL.red})` }} />
        ) : null}
        <span
          className="text-[9px] font-mono truncate flex-1"
          style={{ color: blocked ? `hsl(${TONE_HSL.red})` : "hsl(218 15% 42%)" }}
        >
          {ac.activity ? tm(ac.activity) : t("fleet.onApron")}
        </span>
        {ac.activityEndsAt !== null && (
          <span className="text-[9px] font-mono tnum opacity-55 shrink-0">
            {formatRemaining(ac.activityEndsAt - state.hours)}
          </span>
        )}
      </div>

      {progress !== null && <Meter value={progress} max={1} tone={tone} height={3} />}

      {/* Airframe vitals */}
      <div className="grid grid-cols-3 gap-1.5">
        <Vital label={t("fleet.health")} value={`${ac.health.toFixed(0)}`} unit="%" frac={ac.health / 100} />
        <Vital
          label={t("fleet.toService")}
          value={ac.hoursToService.toFixed(1)}
          unit="h"
          frac={svcFrac}
          tone={svcTone}
        />
        <Vital label={t("fleet.flightHours")} value={ac.flightHours.toFixed(0)} unit="h" frac={null} />
      </div>

      {ac.deferredDefects.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {ac.deferredDefects.map((d, i) => (
            <span
              key={i}
              className="px-1 py-px rounded text-[8px] font-mono font-bold"
              style={toneStyle(
                (d.deferUntilHours ?? Infinity) - state.hours < 12 ? "red" : "amber",
                { bg: 0.13, border: 0.3 },
              )}
              title={t("fleet.deferredTitle", { label: t(d.label), h: Math.max(0, (d.deferUntilHours ?? 0) - state.hours).toFixed(0) })}
            >
              {t("fleet.deferred", { h: Math.max(0, (d.deferUntilHours ?? 0) - state.hours).toFixed(0) })}
            </span>
          ))}
        </div>
      )}

      {ac.avoidableWaitHours > 0.25 && (
        <div className="flex items-center justify-between text-[9px] font-mono">
          <span className="opacity-45">{t("fleet.avoidableWait")}</span>
          <span className="tnum font-bold" style={{ color: `hsl(${TONE_HSL.amber})` }}>
            {ac.avoidableWaitHours.toFixed(1)} h
          </span>
        </div>
      )}
    </div>
  );
}

function Vital({
  label,
  value,
  unit,
  frac,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  frac: number | null;
  tone?: Tone;
}) {
  const t: Tone = tone ?? (frac === null ? "neutral" : frac < 0.2 ? "red" : frac < 0.5 ? "amber" : "green");
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <Label className="!text-[8px] !tracking-wide">{label}</Label>
      <div className="flex items-baseline gap-0.5">
        <span className="font-mono font-bold text-[11px] tnum" style={{ color: `hsl(${TONE_HSL[t]})` }}>
          {value}
        </span>
        <span className="text-[8px] font-mono opacity-45">{unit}</span>
      </div>
    </div>
  );
}

function formatRemaining(hours: number): string {
  if (hours <= 0) return "0m";
  if (hours < 1) return `${Math.ceil(hours * 60)}m`;
  return `${Math.floor(hours)}h${String(Math.round((hours % 1) * 60)).padStart(2, "0")}`;
}
