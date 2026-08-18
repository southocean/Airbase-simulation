/**
 * The React binding.
 *
 * Note what this file does NOT do: it never decides how big a simulation step is.
 * It accumulates real elapsed time, converts it to simulation time via the
 * timescale, and asks the engine for that many FIXED steps. The engine owns time;
 * the render loop only samples it.
 *
 * That inversion is what closes Gap F — in hackathon v2 the tick size was derived
 * from wall-clock frame timing, so results depended on frame rate and the same
 * seed at 1x and 3600x gave different answers.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createPairedRun, stepPaired, type PairedRun } from "@/sim/runner";
import { MAX_STEPS_PER_FRAME, STEP_HOURS } from "@/sim/engine";
import { DEFAULT_CONFIG } from "@/sim/init";
import type { PolicyId, SimConfig } from "@/sim/types";

export const TIMESCALES = [
  { label: "1×", value: 1, note: "realtid" },
  { label: "60×", value: 60, note: "1 s = 1 min" },
  { label: "600×", value: 600, note: "1 s = 10 min" },
  { label: "3600×", value: 3600, note: "1 s = 1 h" },
  { label: "10800×", value: 10800, note: "1 s = 3 h" },
];

export interface SimController {
  run: PairedRun;
  /** Which run the UI is focused on */
  focus: PolicyId;
  setFocus: (p: PolicyId) => void;
  running: boolean;
  timescale: number;
  config: SimConfig;
  toggleRun: () => void;
  setTimescale: (t: number) => void;
  reset: (patch?: Partial<SimConfig>) => void;
  /** Advance a fixed amount of simulation time while paused */
  stepBy: (hours: number) => void;
  /** Real seconds of wall clock elapsed, for the "cost of a demo" readout */
  wallSeconds: number;
}

export function useSimulation(): SimController {
  const [config, setConfig] = useState<SimConfig>(DEFAULT_CONFIG);
  const runRef = useRef<PairedRun>(createPairedRun(DEFAULT_CONFIG));
  const [running, setRunning] = useState(false);
  const [timescale, setTimescale] = useState(600);
  const [focus, setFocus] = useState<PolicyId>("tool");
  const [wallSeconds, setWallSeconds] = useState(0);
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const lastPaintRef = useRef(0);

  const reset = useCallback((patch?: Partial<SimConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    runRef.current = createPairedRun(next);
    accRef.current = 0;
    lastRef.current = null;
    setWallSeconds(0);
    setRunning(false);
    forceRender();
  }, [config]);

  const stepBy = useCallback((hours: number) => {
    const steps = Math.min(Math.round(hours / STEP_HOURS), 60 * 24 * 14);
    stepPaired(runRef.current, steps);
    forceRender();
  }, []);

  useEffect(() => {
    if (!running) {
      lastRef.current = null;
      return;
    }

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      if (lastRef.current === null) {
        lastRef.current = now;
        return;
      }
      // Clamp the real delta so a backgrounded tab does not dump a huge burst.
      const realDt = Math.min((now - lastRef.current) / 1000, 0.25);
      lastRef.current = now;
      setWallSeconds((s) => s + realDt);

      // Real seconds → simulated hours → whole fixed steps.
      accRef.current += (realDt * timescale) / 3600;
      let steps = Math.floor(accRef.current / STEP_HOURS);
      if (steps <= 0) return;
      if (steps > MAX_STEPS_PER_FRAME) steps = MAX_STEPS_PER_FRAME;
      accRef.current -= steps * STEP_HOURS;

      stepPaired(runRef.current, steps);

      // Repaint at ~20 Hz rather than every frame: the sim is cheap, React is not.
      if (now - lastPaintRef.current > 50) {
        lastPaintRef.current = now;
        forceRender();
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [running, timescale]);

  return {
    run: runRef.current,
    focus,
    setFocus,
    running,
    timescale,
    config,
    toggleRun: () => setRunning((r) => !r),
    setTimescale,
    reset,
    stepBy,
    wallSeconds,
  };
}
