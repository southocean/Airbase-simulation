import { useState } from "react";
import { clsx } from "clsx";
import type { SimEvent, SimState } from "@/sim/types";
import { Card, TONE_HSL, type Tone } from "./primitives";
import { useLang } from "@/i18n/LangContext";

const SEVERITY_TONE: Record<SimEvent["severity"], Tone> = {
  info: "blue",
  ok: "green",
  warning: "amber",
  critical: "red",
};

const CHANNELS: { id: SimEvent["channel"] | "all"; key: string }[] = [
  { id: "all", key: "log.all" },
  { id: "mission", key: "log.mission" },
  { id: "maintenance", key: "log.maintenance" },
  { id: "weather", key: "log.weather" },
  { id: "logistics", key: "log.logistics" },
  { id: "crew", key: "log.crew" },
];

/** The event log is the spine — everything that happens writes here, and it is
 *  the source for any after-action review. */
export function EventLog({ state }: { state: SimState }) {
  const { t, tm } = useLang();
  const [channel, setChannel] = useState<SimEvent["channel"] | "all">("all");
  const events = channel === "all" ? state.events : state.events.filter((e) => e.channel === channel);

  return (
    <Card
      title={t("log.panel")}
      right={
        <div className="flex gap-0.5 flex-wrap justify-end">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              onClick={() => setChannel(c.id)}
              className={clsx("px-1 py-0.5 rounded text-[8px] font-mono font-bold transition-all duration-100")}
              style={
                channel === c.id
                  ? { background: "hsl(42 64% 53% / 0.3)", color: "hsl(42 64% 78%)", border: "1px solid hsl(42 64% 53% / 0.55)" }
                  : { background: "transparent", color: "hsl(200 12% 62%)", border: "1px solid hsl(200 12% 100% / 0.14)" }
              }
            >
              {t(c.key)}
            </button>
          ))}
        </div>
      }
      dense
      className="min-h-0 flex-1"
    >
      <div className="h-full overflow-y-auto flex flex-col gap-px pr-0.5">
        {events.length === 0 ? (
          <div className="text-[10px] font-mono opacity-40 py-3 text-center">{t("log.none")}</div>
        ) : (
          events.map((e) => {
            const tone = SEVERITY_TONE[e.severity];
            return (
              <div
                key={e.id}
                className="flex items-start gap-1.5 px-1.5 py-1 rounded animate-fade-in"
                style={{ background: `hsl(${TONE_HSL[tone]} / 0.05)` }}
              >
                <span className="text-[9px] font-mono tnum opacity-45 shrink-0 w-14">{stamp(e.atHours)}</span>
                <span
                  className="w-1 self-stretch rounded-full shrink-0"
                  style={{ background: `hsl(${TONE_HSL[tone]})` }}
                />
                <span className="text-[9px] font-mono leading-snug flex-1" style={{ color: "hsl(218 15% 34%)" }}>
                  {tm(e.msg)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

function stamp(hours: number): string {
  const day = Math.floor(hours / 24) + 1;
  const h = Math.floor(hours % 24);
  const m = Math.floor((hours % 1) * 60);
  return `D${day} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
