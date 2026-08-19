import { CheckCircle2, CircleSlash, Lightbulb } from "lucide-react";
import type { SimState } from "@/sim/types";
import { Card, Chip, toneStyle, TONE_HSL, type Tone } from "./primitives";
import { useLang } from "@/i18n/LangContext";

const PRIORITY_TONE: Record<string, Tone> = {
  critical: "red",
  high: "amber",
  medium: "blue",
  low: "neutral",
};

/**
 * Decision support.
 *
 * Every item carries a benefit AND a trade-off — that requirement is inherited
 * from the hackathon builds' Recommendation type and is the strongest design idea
 * in either of them. Advice without its cost is not decision support.
 *
 * The "GENOMFÖRD"/"IGNORERAD" flag is the honest part: in the baseline run the
 * same advice is generated and visibly NOT acted on, which is precisely the
 * difference the comparison panel is measuring.
 */
export function AdvicePanel({ state }: { state: SimState }) {
  const { t, tm } = useLang();
  const acting = state.config.policy === "tool";

  return (
    <Card
      title={t("adv.panel")}
      right={
        <Chip tone={acting ? "green" : "red"}>
          {acting ? t("adv.active") : t("adv.passive")}
        </Chip>
      }
      dense
      className="min-h-0"
    >
      {state.advice.length === 0 ? (
        <div className="flex items-center gap-2 px-2 py-3 rounded" style={toneStyle("green", { bg: 0.07 })}>
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="text-[10px] font-mono">{t("adv.none")}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[26rem] overflow-y-auto pr-0.5">
          {state.advice.map((a) => {
            const tone = PRIORITY_TONE[a.priority];
            return (
              <div
                key={a.id}
                className="rounded-lg px-2 py-1.5 flex flex-col gap-1 animate-fade-in"
                style={toneStyle(tone, { bg: 0.06, border: 0.22 })}
              >
                <div className="flex items-start gap-1.5">
                  <Lightbulb className="h-3 w-3 mt-0.5 shrink-0 opacity-70" />
                  <span className="text-[10px] font-mono font-bold leading-snug flex-1" style={{ color: "hsl(220 63% 18%)" }}>
                    {tm(a.title)}
                  </span>
                  {acting ? (
                    <span
                      className="flex items-center gap-0.5 text-[8px] font-mono font-bold shrink-0 px-1 py-px rounded"
                      style={toneStyle("green", { bg: 0.15, border: 0.35 })}
                    >
                      <CheckCircle2 className="h-2.5 w-2.5" /> {t("adv.applied")}
                    </span>
                  ) : (
                    <span
                      className="flex items-center gap-0.5 text-[8px] font-mono font-bold shrink-0 px-1 py-px rounded"
                      style={toneStyle("red", { bg: 0.15, border: 0.35 })}
                    >
                      <CircleSlash className="h-2.5 w-2.5" /> {t("adv.ignored")}
                    </span>
                  )}
                </div>

                <p className="text-[9px] font-mono leading-relaxed" style={{ color: "hsl(218 15% 42%)" }}>
                  {tm(a.detail)}
                </p>

                {/* Benefit and trade-off are mandatory, never optional. */}
                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[8px] font-mono font-bold uppercase tracking-wide" style={{ color: `hsl(${TONE_HSL.green})` }}>
                      {t("adv.benefit")}
                    </span>
                    <span className="text-[9px] font-mono leading-snug opacity-70">{tm(a.benefit)}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[8px] font-mono font-bold uppercase tracking-wide" style={{ color: `hsl(${TONE_HSL.amber})` }}>
                      {t("adv.tradeoff")}
                    </span>
                    <span className="text-[9px] font-mono leading-snug opacity-70">{tm(a.tradeoff)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
