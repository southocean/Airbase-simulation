import { useState } from "react";
import { LangProvider, useLang } from "./i18n/LangContext";
import { useSimulation } from "./ui/useSimulation";
import { TopBar } from "./ui/TopBar";
import { BaseCanvas } from "./ui/BaseCanvas";
import { FleetPanel } from "./ui/FleetPanel";
import { EnvPanel } from "./ui/EnvPanel";
import { ResourcePanel, MissionQueue } from "./ui/ResourcePanel";
import { ComparePanel } from "./ui/ComparePanel";
import { AdvicePanel } from "./ui/AdvicePanel";
import { EventLog } from "./ui/EventLog";
import { ScenarioPanel } from "./ui/ScenarioPanel";
import { TONE_HSL } from "./ui/primitives";

type Tab = "scene" | "fleet" | "effect";

export default function App() {
  return (
    <LangProvider>
      <Shell />
    </LangProvider>
  );
}

function Shell() {
  const { t } = useLang();
  const ctl = useSimulation();
  const state = ctl.run[ctl.focus];
  const [tab, setTab] = useState<Tab>("scene");
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar ctl={ctl} />

      {/* Which of the two paired runs is on screen. */}
      <div
        className="shrink-0 px-3 py-1 flex items-center gap-2 flex-wrap text-[10px] font-mono"
        style={
          ctl.focus === "tool"
            ? { background: "hsl(152 60% 32% / 0.12)", color: "hsl(152 60% 24%)", borderBottom: "1px solid hsl(152 60% 32% / 0.3)" }
            : { background: "hsl(220 63% 38% / 0.12)", color: "hsl(220 63% 28%)", borderBottom: "1px solid hsl(220 63% 38% / 0.3)" }
        }
      >
        <span className="font-bold uppercase tracking-widest">
          {t("app.viewing")} {ctl.focus === "tool" ? t("app.viewingTool") : t("app.viewingManual")}
        </span>
        <span className="opacity-55">
          · {t("app.elapsed", { sim: ctl.run.manual.hours.toFixed(1), real: ctl.wallSeconds.toFixed(0) })}
        </span>

        {/* Tabs — the scene is the default view; the numbers are one click away. */}
        <div className="ml-auto flex items-center gap-1">
          {(
            [
              { id: "scene" as Tab, label: t("scene.title") },
              { id: "fleet" as Tab, label: t("fleet.panel") },
              { id: "effect" as Tab, label: t("cmp.panel") },
            ]
          ).map((x) => (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all duration-100 active:scale-95"
              style={
                tab === x.id
                  ? { background: "hsl(220 63% 18%)", color: "white", border: "1px solid hsl(220 63% 18%)" }
                  : { background: "hsl(0 0% 100% / 0.55)", color: "hsl(218 15% 40%)", border: "1px solid hsl(215 14% 82%)" }
              }
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 min-h-0 grid gap-2 p-2 overflow-hidden grid-cols-1 lg:grid-cols-[17.5rem_minmax(0,1fr)_20rem]">
        {/* Left — the world */}
        <div className="hidden lg:flex flex-col gap-2 min-h-0 overflow-y-auto">
          <EnvPanel state={state} />
          <ResourcePanel state={state} />
        </div>

        {/* Centre — the simulation itself */}
        <div className="flex flex-col gap-2 min-h-0">
          {tab === "scene" && (
            <>
              <div className="flex-1 min-h-0">
                <BaseCanvas state={state} selected={selected} onSelect={setSelected} />
              </div>
              <div className="shrink-0 grid grid-cols-1 md:grid-cols-2 gap-2" style={{ height: "34%" }}>
                <MissionQueue state={state} />
                <EventLog state={state} />
              </div>
            </>
          )}

          {tab === "fleet" && (
            <>
              <FleetPanel state={state} />
              <div className="shrink-0" style={{ height: "30%" }}>
                <EventLog state={state} />
              </div>
            </>
          )}

          {tab === "effect" && (
            <div className="min-h-0 overflow-y-auto">
              <ComparePanel run={ctl.run} focus={ctl.focus} setFocus={ctl.setFocus} />
            </div>
          )}
        </div>

        {/* Right — the tool and the controls */}
        <div className="flex flex-col gap-2 min-h-0 overflow-y-auto">
          <RunSwitch ctl={ctl} />
          <AdvicePanel state={state} />
          <ScenarioPanel ctl={ctl} />
        </div>
      </main>
    </div>
  );
}

/** Compact with/without switch, so the comparison is always one click away
 *  even when the effect tab is not open. */
function RunSwitch({ ctl }: { ctl: ReturnType<typeof useSimulation> }) {
  const { t } = useLang();
  const forcedM = ctl.run.manual.kpi.forcedGroundings;
  const forcedT = ctl.run.tool.kpi.forcedGroundings;

  return (
    <div className="card-premium rounded-lg p-2 flex flex-col gap-1.5 shrink-0">
      <div className="grid grid-cols-2 gap-1">
        {(["manual", "tool"] as const).map((p) => {
          const active = ctl.focus === p;
          const tone = p === "tool" ? "green" : "blue";
          return (
            <button
              key={p}
              onClick={() => ctl.setFocus(p)}
              className="px-2 py-1.5 rounded-lg text-left transition-all duration-100 active:scale-[0.98]"
              style={
                active
                  ? {
                      background: `hsl(${TONE_HSL[tone]} / 0.14)`,
                      border: `1px solid hsl(${TONE_HSL[tone]} / 0.5)`,
                      color: `hsl(${TONE_HSL[tone]})`,
                    }
                  : { background: "hsl(216 18% 96%)", border: "1px solid hsl(215 14% 88%)", color: "hsl(218 15% 46%)" }
              }
            >
              <div className="text-[10px] font-mono font-bold uppercase tracking-wide leading-tight">
                {p === "tool" ? t("cmp.withTool") : t("cmp.withoutTool")}
              </div>
              <div className="text-[9px] font-mono opacity-70 tnum">
                {t("cmp.m.forced")}: {p === "tool" ? forcedT : forcedM}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
