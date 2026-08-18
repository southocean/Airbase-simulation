import { Dices, Snowflake, Sun } from "lucide-react";
import { TEMPO } from "@/sim/params";
import { PROVENANCE_SUMMARY } from "@/sim/params";
import type { SimConfig } from "@/sim/types";
import { Card, Label, ProvBadge, toneStyle, type Tone } from "./primitives";
import type { SimController } from "./useSimulation";

const SEASONS = [
  { label: "Vinter", day: 15, note: "~6.5 h dagsljus, isrisk", icon: Snowflake },
  { label: "Vår", day: 105, note: "~14 h dagsljus", icon: Sun },
  { label: "Sommar", day: 180, note: "~18 h dagsljus", icon: Sun },
  { label: "Höst", day: 290, note: "~9.5 h, blåsigt", icon: Snowflake },
];

const TEMPO_TONE: Record<string, Tone> = { FRED: "green", KRIS: "amber", KRIG: "red" };

/**
 * Scenario controls. Changing any of these reseeds and restarts BOTH runs, since
 * a paired comparison is only valid when both sides face the same world.
 */
export function ScenarioPanel({ ctl }: { ctl: SimController }) {
  const cfg = ctl.config;
  const set = (patch: Partial<SimConfig>) => ctl.reset(patch);

  return (
    <Card title="Scenario & styrning" dense>
      <div className="flex flex-col gap-2.5">
        {/* Tempo */}
        <div className="flex flex-col gap-1">
          <Label className="!text-[9px]">Insatstakt</Label>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(TEMPO) as (keyof typeof TEMPO)[]).map((t) => {
              const active = cfg.tempo === t;
              return (
                <button
                  key={t}
                  onClick={() => set({ tempo: t })}
                  className="px-1.5 py-1 rounded transition-all duration-100 active:scale-95"
                  style={
                    active
                      ? toneStyle(TEMPO_TONE[t], { bg: 0.16, border: 0.45 })
                      : { background: "hsl(216 18% 96%)", border: "1px solid hsl(215 14% 88%)", color: "hsl(218 15% 48%)" }
                  }
                >
                  <div className="text-[10px] font-mono font-bold">{t}</div>
                  <div className="text-[8px] font-mono opacity-60">{TEMPO[t].sortieDemandPerDay}/dygn</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Season */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Label className="!text-[9px]">Årstid</Label>
            <ProvBadge tag="TIER-A" />
          </div>
          <div className="grid grid-cols-2 gap-1">
            {SEASONS.map((s) => {
              const active = cfg.startDayOfYear === s.day;
              const Icon = s.icon;
              return (
                <button
                  key={s.label}
                  onClick={() => set({ startDayOfYear: s.day })}
                  className="px-1.5 py-1 rounded flex items-center gap-1.5 text-left transition-all duration-100 active:scale-95"
                  style={
                    active
                      ? toneStyle("blue", { bg: 0.14, border: 0.42 })
                      : { background: "hsl(216 18% 96%)", border: "1px solid hsl(215 14% 88%)", color: "hsl(218 15% 48%)" }
                  }
                >
                  <Icon className="h-3 w-3 shrink-0 opacity-70" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono font-bold">{s.label}</div>
                    <div className="text-[8px] font-mono opacity-60 truncate">{s.note}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Base type */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Label className="!text-[9px]">Bastyp</Label>
            <ProvBadge tag="DECK" />
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(["huvudbas", "sidobas", "reservbas"] as const).map((b) => {
              const active = cfg.baseType === b;
              return (
                <button
                  key={b}
                  onClick={() => set({ baseType: b })}
                  className="px-1 py-1 rounded text-[9px] font-mono font-bold transition-all duration-100 active:scale-95"
                  style={
                    active
                      ? toneStyle("green", { bg: 0.14, border: 0.42 })
                      : { background: "hsl(216 18% 96%)", border: "1px solid hsl(215 14% 88%)", color: "hsl(218 15% 48%)" }
                  }
                >
                  {b.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>

        {/* Seed */}
        <div className="flex flex-col gap-1">
          <Label className="!text-[9px]">Slumpfrö — samma frö ger identisk körning</Label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={cfg.seed}
              onChange={(e) => set({ seed: Number(e.target.value) || 1 })}
              className="flex-1 min-w-0 px-2 py-1 rounded text-[10px] font-mono tnum bg-white"
              style={{ border: "1px solid hsl(215 14% 84%)", color: "hsl(220 63% 18%)" }}
            />
            <button
              onClick={() => set({ seed: Math.floor(1 + (cfg.seed * 1103515245 + 12345) % 99999999) })}
              title="Nytt frö"
              className="p-1.5 rounded transition-all duration-100 active:scale-95"
              style={toneStyle("blue", { bg: 0.1, border: 0.3 })}
            >
              <Dices className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Jump */}
        <div className="flex flex-col gap-1">
          <Label className="!text-[9px]">Hoppa framåt (pausat)</Label>
          <div className="grid grid-cols-4 gap-1">
            {[1, 6, 24, 72].map((h) => (
              <button
                key={h}
                onClick={() => ctl.stepBy(h)}
                className="px-1 py-1 rounded text-[9px] font-mono font-bold transition-all duration-100 active:scale-95"
                style={{ background: "hsl(216 18% 96%)", border: "1px solid hsl(215 14% 88%)", color: "hsl(218 15% 42%)" }}
              >
                +{h}h
              </button>
            ))}
          </div>
        </div>

        <div className="h-px" style={{ background: "hsl(215 14% 88%)" }} />

        {/* Provenance legend — design principle 7.2 made visible */}
        <div className="flex flex-col gap-1">
          <Label className="!text-[9px]">Datakvalitet i modellen</Label>
          {PROVENANCE_SUMMARY.map((p) => (
            <div key={p.tag} className="flex items-start gap-1.5">
              <div className="shrink-0 pt-px">
                <ProvBadge tag={p.tag} />
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-mono font-bold" style={{ color: "hsl(218 15% 38%)" }}>
                  {p.label}
                </div>
                <div className="text-[8px] font-mono opacity-55 leading-snug">{p.note}</div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[8px] font-mono leading-relaxed opacity-50">
          Fasta tidssteg om 1 simulerad minut. Tidsskalan styr hur många steg som
          körs per bildruta, aldrig stegets storlek — därför ger 1× och 10800×
          identiskt resultat för samma frö.
        </p>
      </div>
    </Card>
  );
}
