/**
 * Solar geometry — closes Gap E (day/night entirely absent in both hackathon builds).
 *
 * Pure deterministic astronomy: no dataset needed, computed from date + lat/lon.
 * This matters enormously in Sweden. At the base latitude used here (~58.6°N)
 * daylight runs about 6 h in late December and about 18 h in late June, so a
 * January scenario and a July scenario are genuinely different sustainment
 * problems — which is exactly what a realistic simulation should expose.
 *
 * @source NOAA Solar Calculator equations (low-precision solar position).
 *         Accurate to well under a degree, far beyond what we need.
 */
import { clamp } from "./dist";

export type LightState = "day" | "civil_twilight" | "nautical_twilight" | "night";

export interface SolarState {
  /** Sun elevation above horizon, degrees. Negative = below. */
  elevationDeg: number;
  /** Sun azimuth, degrees from north. */
  azimuthDeg: number;
  light: LightState;
  /** 0 = full dark, 1 = full daylight. Smooth, for both physics and rendering. */
  daylight: number;
  /** Fraction of the moon's disc illuminated, 0–1. Drives night visual detection. */
  moonIllumination: number;
  sunriseHour: number | null;
  sunsetHour: number | null;
  /** Hours of daylight today. Null-safe for polar day / polar night. */
  dayLengthHours: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Unix epoch (1970-01-01T00:00Z) is JD 2440587.5; J2000.0 is JD 2451545.0. */
const J2000_UNIX_DAYS = 10957.5;

/**
 * Days since the J2000.0 epoch.
 *
 * This must be exact, not approximated: the hour-angle term carries a
 * coefficient of 360.9856235 °/day, so even a one-day error rotates the sky by
 * a degree and a whole-year error puts the sun on the wrong side of the planet.
 * An earlier 365.25-per-year approximation here placed the sun above the horizon
 * at January midnight.
 *
 * Date.UTC is a pure function of its arguments — no clock is read — so this
 * stays fully deterministic.
 */
function julianDays(dayOfYear: number, hourUtc: number, year: number): number {
  const ms = Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000 + hourUtc * 3_600_000;
  return ms / 86_400_000 - J2000_UNIX_DAYS;
}

function solarMeanAnomaly(d: number): number {
  return (357.5291 + 0.98560028 * d) * RAD;
}

function eclipticLongitude(M: number): number {
  // Equation of centre + perihelion of Earth.
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
  const P = 102.9372 * RAD;
  return M + C + P + Math.PI;
}

function obliquity(): number {
  return 23.4397 * RAD;
}

function declination(L: number): number {
  return Math.asin(Math.sin(obliquity()) * Math.sin(L));
}

function rightAscension(L: number): number {
  return Math.atan2(Math.cos(obliquity()) * Math.sin(L), Math.cos(L));
}

function siderealTime(d: number, lonWestRad: number): number {
  return (280.16 + 360.9856235 * d) * RAD - lonWestRad;
}

function classify(elevationDeg: number): LightState {
  if (elevationDeg > -0.833) return "day";
  if (elevationDeg > -6) return "civil_twilight";
  if (elevationDeg > -12) return "nautical_twilight";
  return "night";
}

/**
 * Compute solar state.
 *
 * @param dayOfYear 1–365
 * @param hourLocal decimal local hour (0–24). Sweden runs UTC+1/+2; we take a
 *        fixed +1 offset, which is accurate enough and keeps the sim deterministic
 *        without a timezone database.
 */
export function solarState(
  dayOfYear: number,
  hourLocal: number,
  latDeg: number,
  lonDeg: number,
  year = 2026,
): SolarState {
  const hourUtc = hourLocal - 1; // CET
  const d = julianDays(dayOfYear, hourUtc, year);
  const lat = latDeg * RAD;
  const lonWest = -lonDeg * RAD;

  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const ra = rightAscension(L);
  const H = siderealTime(d, lonWest) - ra;

  const elevation = Math.asin(
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H),
  );
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));

  const elevationDeg = elevation * DEG;

  // Smooth daylight factor: fully dark at -6° (civil twilight end), full day at +3°.
  const daylight = clamp((elevationDeg + 6) / 9, 0, 1);

  // Sunrise / sunset via the standard hour-angle formula.
  const cosH0 = (Math.sin(-0.833 * RAD) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
  let sunriseHour: number | null = null;
  let sunsetHour: number | null = null;
  let dayLengthHours: number;
  if (cosH0 >= 1) {
    dayLengthHours = 0; // polar night
  } else if (cosH0 <= -1) {
    dayLengthHours = 24; // midnight sun
  } else {
    const H0 = Math.acos(cosH0) * DEG; // degrees
    dayLengthHours = (2 * H0) / 15;
    // Solar noon in local time, corrected for longitude and equation of time.
    const eqTime = equationOfTimeMinutes(d);
    const solarNoon = 12 - lonDeg / 15 - eqTime / 60 + 1; // +1 = CET
    sunriseHour = solarNoon - dayLengthHours / 2;
    sunsetHour = solarNoon + dayLengthHours / 2;
  }

  return {
    elevationDeg,
    azimuthDeg: (azimuth * DEG + 180) % 360,
    light: classify(elevationDeg),
    daylight,
    moonIllumination: moonIllumination(d),
    sunriseHour,
    sunsetHour,
    dayLengthHours,
  };
}

/** Equation of time in minutes: 4 × (mean solar longitude − apparent right ascension). */
function equationOfTimeMinutes(d: number): number {
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const ra = rightAscension(L);
  const meanLon = M + 102.9372 * RAD + Math.PI;
  let diffDeg = (meanLon - ra) * DEG;
  diffDeg = ((diffDeg + 540) % 360) - 180;
  return 4 * diffDeg;
}

/** Moon illuminated fraction. Simple phase model — plenty for a detection modifier. */
function moonIllumination(d: number): number {
  const synodic = 29.530588853;
  // Reference new moon: 2000-01-06 ≈ J2000 + 5.6 days.
  const phase = (((d - 5.6) % synodic) + synodic) % synodic;
  const angle = (phase / synodic) * 2 * Math.PI;
  return (1 - Math.cos(angle)) / 2;
}

export const LIGHT_LABEL: Record<LightState, string> = {
  day: "DAGSLJUS",
  civil_twilight: "SKYMNING",
  nautical_twilight: "NAUTISK SKYMNING",
  night: "MÖRKER",
};
