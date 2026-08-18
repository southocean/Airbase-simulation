/**
 * Weather — closes Gap D.
 *
 * In both hackathon builds weather is Perlin-noise map decoration with zero
 * engine coupling: a search for weather/wind/cloud across src/core, src/types
 * and src/data/config returns nothing. Here weather is a first-class state that
 * the engine READS, so it can gate launches, extend turnaround, and degrade
 * sensors.
 *
 * This is a stochastic generator with seasonal means and AR(1) persistence
 * (weather is autocorrelated — today looks like yesterday), calibrated to the
 * shape of Swedish climate normals rather than to a specific station record.
 *
 * @source SEASONAL MEANS — approximated from SMHI 1991–2020 climate normals for
 *         southern/central Sweden. Tier A data exists (SMHI Open Data API is free
 *         and needs no key); wiring the real feed is a follow-up, and the shape
 *         of the model is already correct for it.
 * @source PERSISTENCE / AR(1) — ASSUMED. Standard practice in stochastic weather
 *         generators; the coefficient is a reasoned guess, not measured.
 */
import type { Rng } from "./rng";
import { clamp, lerp } from "./dist";

export type PrecipType = "none" | "rain" | "sleet" | "snow" | "freezing_rain";

export interface Weather {
  /** °C at 2 m */
  tempC: number;
  /** Dew point °C — with tempC gives icing risk */
  dewPointC: number;
  /** Mean wind direction, degrees from north (the direction it blows FROM) */
  windDirDeg: number;
  /** Mean wind speed, knots */
  windKts: number;
  /** Gust, knots */
  gustKts: number;
  /** Cloud base above ground, feet. 20000 = effectively unlimited. */
  ceilingFt: number;
  /** Horizontal visibility, metres. 10000 = 10 km+. */
  visibilityM: number;
  precip: PrecipType;
  /** mm/h liquid equivalent */
  precipRate: number;
  /** Accumulated contaminant on the runway, mm. Drives clearance tasks. */
  runwayContamMm: number;
  /** Derived: airframe/engine icing risk 0–1 */
  icingRisk: number;
}

/** Latent AR(1) drivers, kept out of the display type. */
export interface WeatherState {
  w: Weather;
  zTemp: number;
  zWind: number;
  zCloud: number;
  zFront: number;
}

interface SeasonNormals {
  tempMean: number;
  tempSd: number;
  windMean: number;
  cloudiness: number; // 0–1 probability mass toward low ceiling
  precipProb: number;
}

/**
 * Monthly normals, index 0 = January.
 * @source Approximated from SMHI 1991–2020 normals, southern/central Sweden.
 */
const MONTHLY: SeasonNormals[] = [
  { tempMean: -2.5, tempSd: 5.0, windMean: 11, cloudiness: 0.78, precipProb: 0.42 },
  { tempMean: -2.8, tempSd: 5.2, windMean: 11, cloudiness: 0.74, precipProb: 0.38 },
  { tempMean: 0.6, tempSd: 4.6, windMean: 10, cloudiness: 0.68, precipProb: 0.35 },
  { tempMean: 5.4, tempSd: 4.0, windMean: 9, cloudiness: 0.6, precipProb: 0.3 },
  { tempMean: 11.0, tempSd: 4.0, windMean: 8, cloudiness: 0.52, precipProb: 0.28 },
  { tempMean: 15.2, tempSd: 3.6, windMean: 8, cloudiness: 0.5, precipProb: 0.3 },
  { tempMean: 17.4, tempSd: 3.4, windMean: 7, cloudiness: 0.5, precipProb: 0.33 },
  { tempMean: 16.4, tempSd: 3.4, windMean: 7, cloudiness: 0.54, precipProb: 0.34 },
  { tempMean: 12.2, tempSd: 3.8, windMean: 9, cloudiness: 0.6, precipProb: 0.36 },
  { tempMean: 7.2, tempSd: 4.2, windMean: 10, cloudiness: 0.7, precipProb: 0.4 },
  { tempMean: 2.8, tempSd: 4.4, windMean: 11, cloudiness: 0.78, precipProb: 0.44 },
  { tempMean: -0.8, tempSd: 4.8, windMean: 11, cloudiness: 0.8, precipProb: 0.44 },
];

function monthOf(dayOfYear: number): number {
  const cum = [31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
  for (let m = 0; m < 12; m++) if (dayOfYear <= cum[m]) return m;
  return 11;
}

export function initWeather(dayOfYear: number, rng: Rng): WeatherState {
  const st: WeatherState = {
    zTemp: rng.normal(),
    zWind: rng.normal(),
    zCloud: rng.normal(),
    zFront: rng.normal(),
    w: {
      tempC: 0,
      dewPointC: 0,
      windDirDeg: rng.range(0, 360),
      windKts: 8,
      gustKts: 12,
      ceilingFt: 8000,
      visibilityM: 10000,
      precip: "none",
      precipRate: 0,
      runwayContamMm: 0,
      icingRisk: 0,
    },
  };
  return stepWeather(st, dayOfYear, 12, 1 / 60, rng);
}

/**
 * Advance weather.
 *
 * AR(1) on latent drivers with a persistence set by the elapsed time, so the
 * result is timescale-invariant: stepping 1 h as sixty 1-min steps gives the
 * same statistical behaviour as one 1-h step. That property is required for
 * the paired A/B runs in docs/03 §7 to mean anything.
 */
export function stepWeather(
  st: WeatherState,
  dayOfYear: number,
  hourLocal: number,
  dtHours: number,
  rng: Rng,
): WeatherState {
  const n = MONTHLY[monthOf(dayOfYear)];

  // Persistence: ~12 h e-folding time for synoptic drivers.
  const keep = Math.exp(-dtHours / 12);
  const shock = Math.sqrt(1 - keep * keep);

  const zTemp = st.zTemp * keep + rng.normal() * shock;
  const zWind = st.zWind * keep + rng.normal() * shock;
  const zCloud = st.zCloud * keep + rng.normal() * shock;
  // Fronts move faster — ~5 h e-folding.
  const keepF = Math.exp(-dtHours / 5);
  const zFront = st.zFront * keepF + rng.normal() * Math.sqrt(1 - keepF * keepF);

  // Diurnal temperature cycle: minimum ~05:00, maximum ~15:00.
  const diurnalAmp = lerp(2.0, 6.0, 1 - n.cloudiness);
  const diurnal = -Math.cos(((hourLocal - 5) / 24) * 2 * Math.PI) * diurnalAmp;
  const tempC = n.tempMean + zTemp * n.tempSd + diurnal;

  // Wind: lognormal-ish around the seasonal mean, gusts scale with speed.
  const windKts = clamp(n.windMean * Math.exp(0.35 * zWind), 0, 55);
  const gustKts = windKts * (1.25 + 0.25 * clamp(zFront, 0, 3));
  // Direction drifts slowly, with a westerly prevailing bias (Sweden).
  const windDirDeg = (st.w.windDirDeg + zFront * 6 * dtHours + 0.6 * dtHours + 360) % 360;

  // Cloud / ceiling: a frontal driver pushes the ceiling down hard.
  const cloudDrive = clamp(zCloud * 0.5 + zFront * 0.5 + (n.cloudiness - 0.5) * 2, -3, 3);
  const ceilingFt = clamp(Math.exp(lerp(9.9, 5.2, (cloudDrive + 3) / 6)), 150, 20000);

  // Precipitation when the frontal driver is high enough and the season allows.
  const precipDrive = clamp((zFront + 1.2) / 2.4, 0, 1);
  const raining = precipDrive > 1 - n.precipProb;
  let precip: PrecipType = "none";
  let precipRate = 0;
  if (raining) {
    precipRate = clamp(Math.exp(lerp(-2.0, 1.8, precipDrive)), 0.05, 12);
    // Type is a deterministic function of temperature. An earlier version rolled
    // the sleet/freezing-rain split every step, which made the type flicker
    // several times a minute — a sampling artifact, not weather.
    if (tempC <= -1.5) precip = "snow";
    else if (tempC <= -0.4) precip = "sleet";
    else if (tempC <= 0.8) precip = "freezing_rain";
    else precip = "rain";
  }

  // Visibility: driven by precipitation, plus radiation fog on calm clear nights.
  let visibilityM = 10000;
  if (precip === "snow") visibilityM = clamp(6000 / (1 + precipRate * 1.4), 200, 10000);
  else if (precip !== "none") visibilityM = clamp(9000 / (1 + precipRate * 0.5), 600, 10000);
  const fogProne = windKts < 5 && ceilingFt > 6000 && (hourLocal < 8 || hourLocal > 20);
  if (fogProne && tempC - (tempC - 1.5) < 2.5 && rng.chance(0.12 * dtHours)) {
    visibilityM = Math.min(visibilityM, rng.range(150, 1200));
  }

  const dewPointC = tempC - clamp(2 + (1 - precipDrive) * 6 - (raining ? 2 : 0), 0.2, 9);

  // Runway contamination accumulates with frozen precip and melts above zero.
  let runwayContamMm = st.w.runwayContamMm;
  if (precip === "snow") runwayContamMm += precipRate * dtHours * 8; // ~8:1 snow ratio
  else if (precip === "sleet" || precip === "freezing_rain") runwayContamMm += precipRate * dtHours * 1.5;
  if (tempC > 1) runwayContamMm -= dtHours * 3 * (tempC - 1);
  runwayContamMm = clamp(runwayContamMm, 0, 200);

  // Icing: classic risk band is roughly -12 °C … +2 °C with visible moisture.
  const inBand = tempC < 2 && tempC > -12;
  const moisture = precip !== "none" ? 1 : ceilingFt < 3000 ? 0.6 : visibilityM < 2000 ? 0.5 : 0.05;
  const icingRisk = inBand ? clamp(moisture * (1 - Math.abs(tempC + 5) / 10), 0, 1) : 0;

  return {
    zTemp,
    zWind,
    zCloud,
    zFront,
    w: {
      tempC,
      dewPointC,
      windDirDeg,
      windKts,
      gustKts,
      ceilingFt,
      visibilityM,
      precip,
      precipRate,
      runwayContamMm,
      icingRisk,
    },
  };
}

// ── Derived operational quantities ─────────────────────────────────────────

/** Crosswind component against a runway heading, knots. */
export function crosswindKts(w: Weather, runwayHeadingDeg: number): number {
  const delta = ((w.windDirDeg - runwayHeadingDeg + 540) % 360) - 180;
  return Math.abs(w.gustKts * Math.sin(delta * (Math.PI / 180)));
}

/** Headwind component (negative = tailwind), knots. */
export function headwindKts(w: Weather, runwayHeadingDeg: number): number {
  const delta = ((w.windDirDeg - runwayHeadingDeg + 540) % 360) - 180;
  return w.windKts * Math.cos(delta * (Math.PI / 180));
}

export function braking(w: Weather): { label: string; factor: number } {
  if (w.runwayContamMm > 25) return { label: "DÅLIG", factor: 0.45 };
  if (w.runwayContamMm > 6) return { label: "MEDEL", factor: 0.65 };
  if (w.precip !== "none") return { label: "VÅT", factor: 0.85 };
  return { label: "TORR", factor: 1 };
}

export const PRECIP_LABEL: Record<PrecipType, string> = {
  none: "UPPEHÅLL",
  rain: "REGN",
  sleet: "SNÖBLANDAT",
  snow: "SNÖFALL",
  freezing_rain: "UNDERKYLT REGN",
};
