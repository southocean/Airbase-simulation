import { CloudSnow, Eye, Snowflake, Thermometer, Wind } from "lucide-react";
import { braking, crosswindKts, headwindKts, PRECIP_LABEL } from "@/sim/weather";
import { fieldStatus, prepEnvMultiplier } from "@/sim/engine";
import { errorMultiplier } from "@/sim/policy";
import { ENV_EFFECTS } from "@/sim/params";
import type { SimState } from "@/sim/types";
import { Card, Chip, Label, Meter, ProvBadge, toneStyle, TONE_HSL, type Tone } from "./primitives";

/**
 * Weather and light, with their CONSEQUENCES alongside the values.
 *
 * This is the panel that closes Gap D visibly: in both hackathon builds weather
 * existed only as map eye-candy with no engine coupling. Every row here feeds a
 * real gate or multiplier in the engine, and says which.
 */
export function EnvPanel({ state }: { state: SimState }) {
  const w = state.weather;
  const rwy = state.config.runwayHeadingDeg;
  const xw = crosswindKts(w, rwy);
  const hw = headwindKts(w, rwy);
  const brk = braking(w);
  const field = fieldStatus(state);
  const prepMult = prepEnvMultiplier(state);
  const errMult = errorMultiplier(state);
  const deicing = w.icingRisk > ENV_EFFECTS.deiceThreshold;

  return (
    <Card
      title="Väder & ljus"
      right={
        field.open ? (
          <Chip tone="green">FÄLT ÖPPET</Chip>
        ) : (
          <span className="animate-pulse-red">
            <Chip tone="red">STARTFÖRBUD</Chip>
          </span>
        )
      }
      dense
    >
      <div className="flex flex-col gap-2">
        {!field.open && (
          <div
            className="px-2 py-1.5 rounded text-[10px] font-mono font-bold"
            style={toneStyle("red", { bg: 0.1, border: 0.28 })}
          >
            {field.reason}
          </div>
        )}

        {/* Wind + runway */}
        <div className="grid grid-cols-2 gap-2">
          <Row icon={<Wind className="h-3 w-3" />} label="VIND">
            <span className="font-mono font-bold text-[11px] tnum">
              {w.windDirDeg.toFixed(0).padStart(3, "0")}° / {w.windKts.toFixed(0)} kt
            </span>
            <span className="text-[9px] font-mono opacity-50"> byar {w.gustKts.toFixed(0)}</span>
          </Row>
          <Row icon={<Thermometer className="h-3 w-3" />} label="TEMP">
            <span className="font-mono font-bold text-[11px] tnum" style={{ color: w.tempC < 0 ? `hsl(${TONE_HSL.blue})` : undefined }}>
              {w.tempC.toFixed(1)} °C
            </span>
            <span className="text-[9px] font-mono opacity-50"> dp {w.dewPointC.toFixed(0)}</span>
          </Row>
        </div>

        {/* Crosswind — the actual launch gate */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Label>SIDVIND BANA {String(rwy / 10).padStart(2, "0")}</Label>
            <span className="font-mono font-bold text-[11px] tnum" style={{ color: `hsl(${TONE_HSL[xw > 20 ? "red" : xw > 14 ? "amber" : "green"]})` }}>
              {xw.toFixed(1)} kt
            </span>
          </div>
          <Meter value={xw} max={25} tone={xw > 20 ? "red" : xw > 14 ? "amber" : "green"} height={4} />
          <div className="flex justify-between text-[9px] font-mono opacity-45">
            <span>{hw >= 0 ? "motvind" : "medvind"} {Math.abs(hw).toFixed(0)} kt</span>
            <span>gräns 25 kt</span>
          </div>
        </div>

        {/* Ceiling / visibility */}
        <div className="grid grid-cols-2 gap-2">
          <Row icon={<CloudSnow className="h-3 w-3" />} label="MOLNBAS">
            <span className="font-mono font-bold text-[11px] tnum">
              {w.ceilingFt >= 19000 ? "obeg." : `${w.ceilingFt.toFixed(0)} ft`}
            </span>
          </Row>
          <Row icon={<Eye className="h-3 w-3" />} label="SIKT">
            <span className="font-mono font-bold text-[11px] tnum">
              {w.visibilityM >= 9900 ? "10 km+" : `${(w.visibilityM / 1000).toFixed(1)} km`}
            </span>
          </Row>
        </div>

        {/* Precip + runway state */}
        <div className="flex items-center gap-2 flex-wrap">
          <Chip tone={w.precip === "none" ? "green" : w.precip === "snow" || w.precip === "freezing_rain" ? "red" : "amber"}>
            {PRECIP_LABEL[w.precip]}
            {w.precip !== "none" && ` ${w.precipRate.toFixed(1)} mm/h`}
          </Chip>
          <Chip tone={brk.factor > 0.8 ? "green" : brk.factor > 0.55 ? "amber" : "red"}>BROMS {brk.label}</Chip>
          {w.runwayContamMm > 1 && <Chip tone="amber">BANA {w.runwayContamMm.toFixed(0)} mm</Chip>}
          {deicing && (
            <Chip tone="red">
              <Snowflake className="h-2.5 w-2.5 inline mr-0.5" />
              AVISNING KRÄVS
            </Chip>
          )}
        </div>

        <div className="h-px" style={{ background: "hsl(215 14% 88%)" }} />

        {/* The couplings — what the weather and light are DOING to the base */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Label>Operativ påverkan</Label>
            <ProvBadge tag="ASSUMED" />
          </div>
          <Coupling
            label="Klargöringstid"
            value={`×${prepMult.toFixed(2)}`}
            tone={prepMult > 1.35 ? "red" : prepMult > 1.12 ? "amber" : "green"}
            note={`kyla ${w.tempC.toFixed(0)} °C + mörker`}
          />
          <Coupling
            label="Felsannolikhet klargöring"
            value={`×${errMult.toFixed(2)}`}
            tone={errMult > 2.2 ? "red" : errMult > 1.5 ? "amber" : "green"}
            note="utmattning + mörker"
          />
          <Coupling
            label="Isrisk"
            value={`${(w.icingRisk * 100).toFixed(0)} %`}
            tone={w.icingRisk > 0.5 ? "red" : w.icingRisk > ENV_EFFECTS.deiceThreshold ? "amber" : "green"}
            note={deicing ? "avisningssteg tillagt" : "under tröskel"}
          />
          <Coupling
            label="Dagsljus"
            value={`${(state.solar.daylight * 100).toFixed(0)} %`}
            tone={state.solar.daylight > 0.6 ? "green" : state.solar.daylight > 0.15 ? "amber" : "blue"}
            note={`sol ${state.solar.elevationDeg.toFixed(0)}° · måne ${(state.solar.moonIllumination * 100).toFixed(0)} %`}
          />
        </div>
      </div>
    </Card>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center gap-1 opacity-55">
        {icon}
        <Label className="!text-[8px]">{label}</Label>
      </div>
      <div className="truncate" style={{ color: "hsl(220 63% 18%)" }}>
        {children}
      </div>
    </div>
  );
}

function Coupling({ label, value, tone, note }: { label: string; value: string; tone: Tone; note: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-mono truncate" style={{ color: "hsl(218 15% 38%)" }}>
          {label}
        </div>
        <div className="text-[8px] font-mono opacity-45 truncate">{note}</div>
      </div>
      <span
        className="px-1.5 py-0.5 rounded font-mono font-bold text-[10px] tnum shrink-0"
        style={toneStyle(tone, { bg: 0.12, border: 0.28 })}
      >
        {value}
      </span>
    </div>
  );
}
