import { Fuel, Package, Users, Warehouse } from "lucide-react";
import { FACILITY_LABEL_KEY } from "@/sim/tables";
import type { SimState } from "@/sim/types";
import { Card, Chip, Label, levelTone, Meter, ProvBadge, toneStyle, TONE_HSL } from "./primitives";
import { useLang } from "@/i18n/LangContext";

/**
 * Resources as first-class constraints — bays, prep slots, crew, spares, fuel.
 * The deck is explicit (pp.2–3, 8, 10) that resource availability is a hard
 * constraint rather than background bookkeeping, so every row here is something
 * the engine will actually block on.
 */
export function ResourcePanel({ state }: { state: SimState }) {
  const { t } = useLang();
  const slotsBusy = state.slots.filter((s) => s.occupiedBy !== null).length;
  const slotsDown = state.slots.filter((s) => s.gseDownUntil !== null && state.hours < s.gseDownUntil).length;
  const baysBusy = state.bays.filter((b) => b.occupiedBy !== null).length;

  return (
    <Card title={t("res.panel")} dense>
      <div className="flex flex-col gap-2.5">
        {/* Prep slots */}
        <Block icon={<Warehouse className="h-3 w-3" />} label={t("res.prepSlots")}>
          <div className="flex gap-1">
            {state.slots.map((s) => {
              const down = s.gseDownUntil !== null && state.hours < s.gseDownUntil;
              const tone = down ? "red" : s.occupiedBy ? "blue" : "green";
              return (
                <div
                  key={s.index}
                  className="flex-1 rounded px-1 py-1 text-center"
                  style={toneStyle(tone, { bg: 0.12, border: 0.28 })}
                  title={down ? "GSE" : s.occupiedBy ?? t("res.free")}
                >
                  <div className="text-[9px] font-mono font-bold">{s.index + 1}</div>
                  <div className="text-[8px] font-mono opacity-70 truncate">
                    {down ? "GSE" : s.occupiedBy ? tailOf(state, s.occupiedBy) : "—"}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[9px] font-mono opacity-50">
            <span>{t("res.occupied", { n: slotsBusy, total: state.slots.length })}</span>
            {slotsDown > 0 && <span style={{ color: `hsl(${TONE_HSL.red})` }}>{t("res.gseDown", { n: slotsDown })}</span>}
          </div>
        </Block>

        {/* Maintenance bays */}
        <Block icon={<Warehouse className="h-3 w-3" />} label={t("res.bays")}>
          <div className="flex flex-col gap-1">
            {state.bays.map((b) => (
              <div key={b.index} className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono opacity-55 w-24 shrink-0 truncate">
                  {t(FACILITY_LABEL_KEY[b.level])}
                </span>
                <div className="flex-1">
                  <Meter value={b.occupiedBy ? 1 : 0} max={1} tone={b.occupiedBy ? "amber" : "green"} height={4} />
                </div>
                <span className="text-[9px] font-mono tnum w-12 text-right shrink-0">
                  {b.occupiedBy ? tailOf(state, b.occupiedBy) : t("res.free")}
                </span>
              </div>
            ))}
          </div>
          <div className="text-[9px] font-mono opacity-50">
            {t("res.occupied", { n: baysBusy, total: state.bays.length })}
          </div>
        </Block>

        {/* Crew */}
        <Block icon={<Users className="h-3 w-3" />} label={t("res.crew")}>
          {state.crew.map((c) => {
            const onDuty = Math.floor(c.total / 2);
            return (
              <div key={c.id} className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="truncate" style={{ color: "hsl(218 15% 38%)" }}>
                    {t(c.label)}
                  </span>
                  <span className="tnum opacity-60 shrink-0">
                    {c.busy}/{onDuty} · {t("res.shift", { n: c.onShift })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1">
                    <Meter value={c.busy} max={onDuty} tone={c.busy >= onDuty ? "red" : "blue"} height={3} />
                  </div>
                  <div className="flex-1">
                    <Meter
                      value={c.fatigue}
                      max={1}
                      tone={c.fatigue > 0.75 ? "red" : c.fatigue > 0.5 ? "amber" : "green"}
                      height={3}
                    />
                  </div>
                  <span
                    className="text-[8px] font-mono tnum w-7 text-right shrink-0"
                    style={{ color: `hsl(${TONE_HSL[c.fatigue > 0.75 ? "red" : c.fatigue > 0.5 ? "amber" : "green"]})` }}
                  >
                    {(c.fatigue * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </Block>

        {/* Spares */}
        <Block
          icon={<Package className="h-3 w-3" />}
          label={t("res.spares")}
          badge={<ProvBadge tag="DECK" />}
        >
          {state.spares.map((p) => {
            const frac = p.qty / p.max;
            return (
              <div key={p.id} className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono w-24 shrink-0 truncate" style={{ color: "hsl(218 15% 38%)" }}>
                  {t(p.label)}
                </span>
                <div className="flex-1">
                  <Meter value={p.qty} max={p.max} tone={levelTone(frac)} height={4} />
                </div>
                <span className="text-[9px] font-mono tnum w-8 text-right shrink-0">
                  {p.qty}/{p.max}
                </span>
                {p.inbound.length > 0 && (
                  <span className="text-[8px] font-mono shrink-0" style={{ color: `hsl(${TONE_HSL.blue})` }} title={t("res.inbound")}>
                    +{p.inbound.length}
                  </span>
                )}
                {p.stockouts > 0 && (
                  <span className="text-[8px] font-mono shrink-0" style={{ color: `hsl(${TONE_HSL.red})` }} title={t("res.stockout")}>
                    !{p.stockouts}
                  </span>
                )}
              </div>
            );
          })}
        </Block>

        {/* Bulk */}
        <Block icon={<Fuel className="h-3 w-3" />} label={t("res.bulk")}>
          <BulkRow label={t("res.fuel")} value={state.fuelM3} max={state.fuelMaxM3} unit="m³" />
          <BulkRow label={t("res.ammo")} value={state.munitions} max={state.munitionsMax} unit="" />
        </Block>
      </div>
    </Card>
  );
}

function BulkRow({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const frac = value / max;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-mono w-24 shrink-0 truncate" style={{ color: "hsl(218 15% 38%)" }}>
        {label}
      </span>
      <div className="flex-1">
        <Meter value={value} max={max} tone={levelTone(frac)} height={4} />
      </div>
      <span className="text-[9px] font-mono tnum w-16 text-right shrink-0">
        {value.toFixed(0)} {unit}
      </span>
    </div>
  );
}

function Block({
  icon,
  label,
  badge,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 opacity-60">
        {icon}
        <Label className="!text-[9px]">{label}</Label>
        {badge}
      </div>
      {children}
    </div>
  );
}

function tailOf(state: SimState, id: string): string {
  return state.aircraft.find((a) => a.id === id)?.tail ?? id;
}

export function MissionQueue({ state }: { state: SimState }) {
  const { t } = useLang();
  const active = state.missions
    .filter((m) => m.status === "pending" || m.status === "assigned" || m.status === "launched")
    .slice(-9)
    .reverse();

  return (
    <Card title={t("ato.panel")} right={<Chip tone="blue">{t("ato.active", { n: active.length })}</Chip>} dense>
      {active.length === 0 ? (
        <div className="text-[10px] font-mono opacity-45 py-2 text-center">{t("ato.none")}</div>
      ) : (
        <div className="flex flex-col gap-1">
          {active.map((m) => {
            const late = state.hours > m.deadlineHours - 0.5;
            const tone = m.status === "launched" ? "blue" : late ? "red" : m.status === "assigned" ? "green" : "amber";
            return (
              <div
                key={m.id}
                className="flex items-center gap-1.5 px-1.5 py-1 rounded"
                style={toneStyle(tone, { bg: 0.07, border: 0.2 })}
              >
                <span className="font-mono font-bold text-[10px] w-14 shrink-0">{t(`mission.${m.type}`)}</span>
                <span className="text-[9px] font-mono opacity-55 shrink-0">
                  {m.assigned.length}/{m.requiredCount}
                </span>
                <span className="text-[9px] font-mono opacity-45 flex-1 truncate">{m.requiredType}</span>
                <span className="text-[9px] font-mono tnum shrink-0" style={{ color: `hsl(${TONE_HSL[tone]})` }}>
                  {m.status === "launched" ? t("ato.airborne") : `${Math.max(0, m.deadlineHours - state.hours).toFixed(1)} h`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
