import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { bayUtilisation, fulfilment, meanAvailability, meanTurnaroundHours, sortieRate } from "@/sim/engine";
import type { PairedRun } from "@/sim/runner";
import type { PolicyId, SimState } from "@/sim/types";
import { Card, Label, toneStyle, TONE_HSL, type Tone } from "./primitives";

/**
 * The effectiveness measurement — Gap C.
 *
 * Both runs share a seed and therefore the identical weather sequence and the
 * identical dice for any given event, so the difference between the two columns
 * is attributable to the policy rather than to luck. That is what makes this a
 * measurement instead of a claim.
 */

interface Metric {
  key: string;
  label: string;
  unit: string;
  /** true when a HIGHER number is better */
  higherBetter: boolean;
  get: (s: SimState) => number | null;
  fmt: (v: number) => string;
}

const METRICS: Metric[] = [
  {
    key: "fulfilment",
    label: "ATO-uppfyllnad",
    unit: "%",
    higherBetter: true,
    get: (s) => fulfilment(s) * 100,
    fmt: (v) => v.toFixed(1),
  },
  {
    key: "availability",
    label: "Medeltillgänglighet",
    unit: "fpl",
    higherBetter: true,
    get: (s) => meanAvailability(s),
    fmt: (v) => v.toFixed(2),
  },
  {
    key: "sorties",
    label: "Företag/fpl/dygn",
    unit: "",
    higherBetter: true,
    get: (s) => sortieRate(s),
    fmt: (v) => v.toFixed(2),
  },
  {
    key: "wait",
    label: "Undvikbar väntetid",
    unit: "fpl-h",
    higherBetter: false,
    get: (s) => s.kpi.avoidableWaitHours,
    fmt: (v) => v.toFixed(1),
  },
  {
    key: "turnaround",
    label: "Medelomloppstid",
    unit: "h",
    higherBetter: false,
    get: (s) => meanTurnaroundHours(s),
    fmt: (v) => v.toFixed(2),
  },
  {
    // The mechanism metric. This is where the policy difference shows up
    // unambiguously, while the throughput metrics above stay inside run-to-run
    // noise over a week — see README.
    key: "forced",
    label: "Tvingade grundstopp",
    unit: "",
    higherBetter: false,
    get: (s) => s.kpi.forcedGroundings,
    fmt: (v) => v.toFixed(0),
  },
  {
    key: "planned",
    label: "Planerade åtgärder",
    unit: "",
    higherBetter: true,
    get: (s) => s.kpi.plannedClearances,
    fmt: (v) => v.toFixed(0),
  },
  {
    key: "deferred",
    label: "Uppskjutna anmärkningar",
    unit: "",
    higherBetter: false,
    get: (s) => s.aircraft.reduce((acc, a) => acc + a.deferredDefects.length, 0),
    fmt: (v) => v.toFixed(0),
  },
  {
    key: "failedMissions",
    label: "Ej genomförda uppdrag",
    unit: "",
    higherBetter: false,
    get: (s) => s.kpi.missionsFailed,
    fmt: (v) => v.toFixed(0),
  },
  {
    key: "stockouts",
    label: "Delbrist-stopp",
    unit: "",
    higherBetter: false,
    get: (s) => s.kpi.stockouts,
    fmt: (v) => v.toFixed(0),
  },
  {
    key: "bay",
    label: "Utnyttjande UH-plats",
    unit: "%",
    higherBetter: true,
    get: (s) => bayUtilisation(s) * 100,
    fmt: (v) => v.toFixed(0),
  },
];

export function ComparePanel({
  run,
  focus,
  setFocus,
}: {
  run: PairedRun;
  focus: PolicyId;
  setFocus: (p: PolicyId) => void;
}) {
  const warmedUp = run.tool.hours > 2;

  return (
    <Card
      title="Effekt av beslutsstöd — parkörning"
      right={
        <span className="text-[9px] font-mono" style={{ color: "hsl(200 12% 70%)" }}>
          samma frö {run.config.seed} · identiskt väder
        </span>
      }
      dense
      className="min-h-0"
    >
      <div className="flex flex-col gap-2 min-h-0">
        {/* Focus selector — which run the rest of the dashboard shows */}
        <div className="grid grid-cols-2 gap-1">
          {(["manual", "tool"] as PolicyId[]).map((p) => {
            const active = focus === p;
            const s = run[p];
            return (
              <button
                key={p}
                onClick={() => setFocus(p)}
                className="px-2 py-1.5 rounded-lg text-left transition-all duration-100 active:scale-[0.98]"
                style={
                  active
                    ? toneStyle(p === "tool" ? "green" : "blue", { bg: 0.14, border: 0.45 })
                    : { background: "hsl(216 18% 96%)", border: "1px solid hsl(215 14% 88%)", color: "hsl(218 15% 46%)" }
                }
              >
                <div className="text-[10px] font-mono font-bold uppercase tracking-wide">
                  {p === "tool" ? "Med beslutsstöd" : "Utan (baslinje)"}
                </div>
                <div className="text-[9px] font-mono opacity-65">
                  {(fulfilment(s) * 100).toFixed(0)} % uppfyllnad · {s.kpi.sortiesFlown} företag
                </div>
              </button>
            );
          })}
        </div>

        {/* Metric table */}
        <div className="flex flex-col gap-0.5">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-1">
            <Label className="!text-[8px]">Mått</Label>
            <Label className="!text-[8px] text-right w-14">Utan</Label>
            <Label className="!text-[8px] text-right w-14">Med</Label>
            <Label className="!text-[8px] text-right w-16">Skillnad</Label>
          </div>
          {METRICS.map((m) => (
            <MetricRow key={m.key} m={m} manual={run.manual} tool={run.tool} enabled={warmedUp} />
          ))}
        </div>

        {!warmedUp && (
          <div className="text-[9px] font-mono opacity-50 px-1">
            Kör minst 2 simulerade timmar innan skillnaderna är meningsfulla.
          </div>
        )}

        <FulfilmentChart run={run} />
        <WaitChart run={run} />

        <div className="flex flex-col gap-1.5 px-1">
          <p className="text-[9px] font-mono leading-relaxed opacity-55">
            Baslinjen tilldelar första lediga flygplan, åtgärdar fel först när de
            tvingar fram ett stopp och beställer reservdelar vid noll. Beslutsstödet
            har samma handlingar och samma information — men prioriterar efter
            deadline, tar korta jobb först i underhållskön, använder tomma
            underhållsplatser till uppskjutna anmärkningar och beställer vid
            beställningspunkt.
          </p>
          <p
            className="text-[9px] font-mono leading-relaxed px-1.5 py-1 rounded"
            style={toneStyle("amber", { bg: 0.07, border: 0.2 })}
          >
            <strong>Läs siffrorna försiktigt.</strong> En enskild körning bevisar
            ingenting — spridningen mellan slumpfrön är stor. Över 60 parvisa frön
            håller effekten på tillgänglighet (+3,6 %), undvikbar väntetid (−25 %)
            och tvingade grundstopp (−49 %), medan ATO-uppfyllnaden ligger kvar inom
            bruset: vid ~92 % finns knappt något utrymme kvar. Kör
            <span className="font-bold"> npm test </span>
            för siffrorna med t-värden.
          </p>
        </div>
      </div>
    </Card>
  );
}

function MetricRow({ m, manual, tool, enabled }: { m: Metric; manual: SimState; tool: SimState; enabled: boolean }) {
  const a = m.get(manual);
  const b = m.get(tool);

  let deltaNode: React.ReactNode = <span className="opacity-30">—</span>;
  let tone: Tone = "neutral";

  if (enabled && a !== null && b !== null) {
    const raw = b - a;
    const better = m.higherBetter ? raw > 0 : raw < 0;
    const negligible = Math.abs(raw) < 1e-6 || (a !== 0 && Math.abs(raw / a) < 0.005);
    tone = negligible ? "neutral" : better ? "green" : "red";
    const pct = a !== 0 ? (raw / Math.abs(a)) * 100 : null;
    deltaNode = (
      <span className="flex items-center justify-end gap-0.5 font-mono font-bold text-[10px] tnum">
        {negligible ? (
          <Minus className="h-2.5 w-2.5" />
        ) : better ? (
          <ArrowUp className="h-2.5 w-2.5" style={{ transform: m.higherBetter ? undefined : "rotate(180deg)" }} />
        ) : (
          <ArrowDown className="h-2.5 w-2.5" style={{ transform: m.higherBetter ? undefined : "rotate(180deg)" }} />
        )}
        {pct !== null && Math.abs(pct) < 1000 ? `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%` : m.fmt(raw)}
      </span>
    );
  }

  return (
    <div
      className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center px-1 py-1 rounded"
      style={{ background: tone === "neutral" ? "transparent" : `hsl(${TONE_HSL[tone]} / 0.05)` }}
    >
      <span className="text-[10px] font-mono truncate" style={{ color: "hsl(218 15% 38%)" }}>
        {m.label}
        {m.unit && <span className="opacity-40"> ({m.unit})</span>}
      </span>
      <span className="text-[10px] font-mono tnum text-right w-14 opacity-70">{a === null ? "—" : m.fmt(a)}</span>
      <span className="text-[10px] font-mono font-bold tnum text-right w-14" style={{ color: "hsl(220 63% 18%)" }}>
        {b === null ? "—" : m.fmt(b)}
      </span>
      <span className="text-right w-16" style={{ color: `hsl(${TONE_HSL[tone]})` }}>
        {deltaNode}
      </span>
    </div>
  );
}

function chartData(run: PairedRun) {
  const n = Math.min(run.manual.kpi.history.length, run.tool.kpi.history.length);
  const stride = Math.max(1, Math.floor(n / 260));
  const out: { h: number; manual: number; tool: number; waitM: number; waitT: number }[] = [];
  for (let i = 0; i < n; i += stride) {
    const m = run.manual.kpi.history[i];
    const t = run.tool.kpi.history[i];
    out.push({
      h: Number(m.hours.toFixed(2)),
      manual: Number((m.fulfilment * 100).toFixed(1)),
      tool: Number((t.fulfilment * 100).toFixed(1)),
      waitM: Number(m.avoidableWaitHours.toFixed(1)),
      waitT: Number(t.avoidableWaitHours.toFixed(1)),
    });
  }
  return out;
}

const AXIS = { fontSize: 8, fontFamily: "JetBrains Mono, monospace", fill: "hsl(218 15% 50%)" };

function FulfilmentChart({ run }: { run: PairedRun }) {
  const data = chartData(run);
  if (data.length < 3) return null;
  return (
    <div className="flex flex-col gap-1">
      <Label className="!text-[8px]">ATO-uppfyllnad över tid (%)</Label>
      <div style={{ height: 96 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
            <CartesianGrid stroke="hsl(215 14% 90%)" strokeDasharray="2 3" />
            <XAxis dataKey="h" tick={AXIS} stroke="hsl(215 14% 84%)" tickFormatter={(v) => `${v}h`} minTickGap={28} />
            <YAxis domain={[0, 100]} tick={AXIS} stroke="hsl(215 14% 84%)" width={34} />
            <Tooltip
              contentStyle={{
                background: "hsl(220 63% 14%)",
                border: "1px solid hsl(42 64% 53% / 0.4)",
                borderRadius: 6,
                fontSize: 10,
                fontFamily: "JetBrains Mono, monospace",
                color: "white",
              }}
              labelFormatter={(v) => `t = ${v} h`}
            />
            <Line type="monotone" dataKey="manual" name="utan" stroke={`hsl(${TONE_HSL.blue})`} strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="tool" name="med" stroke={`hsl(${TONE_HSL.green})`} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function WaitChart({ run }: { run: PairedRun }) {
  const data = chartData(run);
  if (data.length < 3) return null;
  return (
    <div className="flex flex-col gap-1">
      <Label className="!text-[8px]">Ackumulerad undvikbar väntetid (fpl-h) — lägre är bättre</Label>
      <div style={{ height: 88 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
            <defs>
              <linearGradient id="gWaitM" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`hsl(${TONE_HSL.red})`} stopOpacity={0.35} />
                <stop offset="100%" stopColor={`hsl(${TONE_HSL.red})`} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gWaitT" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`hsl(${TONE_HSL.green})`} stopOpacity={0.35} />
                <stop offset="100%" stopColor={`hsl(${TONE_HSL.green})`} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(215 14% 90%)" strokeDasharray="2 3" />
            <XAxis dataKey="h" tick={AXIS} stroke="hsl(215 14% 84%)" tickFormatter={(v) => `${v}h`} minTickGap={28} />
            <YAxis tick={AXIS} stroke="hsl(215 14% 84%)" width={34} />
            <Tooltip
              contentStyle={{
                background: "hsl(220 63% 14%)",
                border: "1px solid hsl(42 64% 53% / 0.4)",
                borderRadius: 6,
                fontSize: 10,
                fontFamily: "JetBrains Mono, monospace",
                color: "white",
              }}
              labelFormatter={(v) => `t = ${v} h`}
            />
            <Area type="monotone" dataKey="waitM" name="utan" stroke={`hsl(${TONE_HSL.red})`} strokeWidth={1.5} fill="url(#gWaitM)" />
            <Area type="monotone" dataKey="waitT" name="med" stroke={`hsl(${TONE_HSL.green})`} strokeWidth={2} fill="url(#gWaitT)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
