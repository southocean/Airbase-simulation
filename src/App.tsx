import { useSimulation } from "./ui/useSimulation";
import { TopBar } from "./ui/TopBar";
import { FleetPanel } from "./ui/FleetPanel";
import { EnvPanel } from "./ui/EnvPanel";
import { ResourcePanel, MissionQueue } from "./ui/ResourcePanel";
import { ComparePanel } from "./ui/ComparePanel";
import { AdvicePanel } from "./ui/AdvicePanel";
import { EventLog } from "./ui/EventLog";
import { ScenarioPanel } from "./ui/ScenarioPanel";

export default function App() {
  const ctl = useSimulation();
  const state = ctl.run[ctl.focus];

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar ctl={ctl} />

      {/* Focus banner — makes it unmistakable which of the two paired runs the
          dashboard below is showing. */}
      <div
        className="shrink-0 px-4 py-1 flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest"
        style={
          ctl.focus === "tool"
            ? { background: "hsl(152 60% 32% / 0.12)", color: "hsl(152 60% 26%)", borderBottom: "1px solid hsl(152 60% 32% / 0.3)" }
            : { background: "hsl(220 63% 38% / 0.12)", color: "hsl(220 63% 30%)", borderBottom: "1px solid hsl(220 63% 38% / 0.3)" }
        }
      >
        <span>Visar körning: {ctl.focus === "tool" ? "med beslutsstöd" : "utan beslutsstöd (baslinje)"}</span>
        <span className="opacity-50 normal-case tracking-normal font-normal">
          · {ctl.run.manual.hours.toFixed(1)} simulerade timmar på {ctl.wallSeconds.toFixed(0)} s verklig tid
        </span>
      </div>

      <main className="flex-1 min-h-0 grid gap-2 p-2 overflow-hidden grid-cols-1 lg:grid-cols-[19rem_minmax(0,1fr)_20rem] xl:grid-cols-[20rem_minmax(0,1fr)_23rem]">
        {/* Left column — the world */}
        <div className="flex flex-col gap-2 min-h-0 overflow-y-auto">
          <EnvPanel state={state} />
          <ResourcePanel state={state} />
        </div>

        {/* Centre column — the fleet, which is the thing being managed */}
        <div className="flex flex-col gap-2 min-h-0">
          <FleetPanel state={state} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 shrink-0" style={{ maxHeight: "38%" }}>
            <MissionQueue state={state} />
            <EventLog state={state} />
          </div>
        </div>

        {/* Right column — the tool, its measurement, and the controls */}
        <div className="flex flex-col gap-2 min-h-0 overflow-y-auto">
          <ComparePanel run={ctl.run} focus={ctl.focus} setFocus={ctl.setFocus} />
          <AdvicePanel state={state} />
          <ScenarioPanel ctl={ctl} />
        </div>
      </main>
    </div>
  );
}
