/**
 * Utfall (outcome) tables.
 *
 * @source DECK p.11 — reproduced from the Saab simulation deck via context.md,
 * and cross-checked against the implementation both hackathon builds already
 * carry in src/data/config/probabilities.ts. This is the most authoritative data
 * in the whole model: real d6 tables from the real training game.
 *
 * Table A applies at preparation / startup BIT.
 * Table B applies at post-mission reception.
 */
import type { Rng } from "./rng";

export type FacilityType = "service_bay" | "minor_workshop" | "major_workshop";

export type MaintenanceKind = "quick_lru" | "complex_lru" | "direct_repair" | "troubleshooting" | "scheduled_service";

export type SparePartId = "computer" | "radar" | "hydraulic" | "wheel";

export interface UtfallOutcome {
  roll: number;
  /** false = the aircraft is unserviceable ("fel"/"Avhj" in the deck) */
  serviceable: boolean;
  kind: MaintenanceKind;
  /** Nominal repair time, hours */
  repairHours: number;
  facility: FacilityType;
  capability: string;
  label: string;
  sparePart?: SparePartId;
}

/** Table A — loading / fuelling / weapon hanging / startup BIT. @source DECK p.11 */
export const UTFALL_A: readonly UtfallOutcome[] = [
  { roll: 1, serviceable: true,  kind: "quick_lru",       repairHours: 2,  facility: "service_bay",    capability: "AU Steg 1",   label: "Snabbt LRU-byte",            sparePart: "computer" },
  { roll: 2, serviceable: true,  kind: "quick_lru",       repairHours: 2,  facility: "minor_workshop", capability: "AU Steg 2/3", label: "Snabbt LRU-byte",            sparePart: "computer" },
  { roll: 3, serviceable: true,  kind: "complex_lru",     repairHours: 6,  facility: "major_workshop", capability: "AU Steg 4",   label: "Komplext LRU-byte",          sparePart: "radar" },
  { roll: 4, serviceable: true,  kind: "direct_repair",   repairHours: 16, facility: "major_workshop", capability: "Kompositrep", label: "Direktreparation",           sparePart: "hydraulic" },
  { roll: 5, serviceable: false, kind: "troubleshooting", repairHours: 4,  facility: "service_bay",    capability: "FK Steg 1–3", label: "Felsökning liten" },
  { roll: 6, serviceable: false, kind: "troubleshooting", repairHours: 4,  facility: "service_bay",    capability: "FK Steg 1–3", label: "Felsökning liten" },
] as const;

/** Table B — reception / post-mission. @source DECK p.11
 *  Deck status column: rolls 1–4 "OK", rolls 5–6 "Avhj" (unserviceable). */
export const UTFALL_B: readonly UtfallOutcome[] = [
  { roll: 1, serviceable: true,  kind: "quick_lru",       repairHours: 2,  facility: "service_bay",    capability: "Hjulbyte",    label: "Hjulbyte efter landning",    sparePart: "wheel" },
  { roll: 2, serviceable: true,  kind: "quick_lru",       repairHours: 2,  facility: "service_bay",    capability: "AU Steg 1",   label: "LRU-byte, sensorfel",        sparePart: "radar" },
  { roll: 3, serviceable: true,  kind: "quick_lru",       repairHours: 2,  facility: "minor_workshop", capability: "AU Steg 2/3", label: "Snabbt LRU-byte",            sparePart: "computer" },
  { roll: 4, serviceable: true,  kind: "complex_lru",     repairHours: 6,  facility: "major_workshop", capability: "AU Steg 4",   label: "Komplext LRU-byte",          sparePart: "radar" },
  { roll: 5, serviceable: false, kind: "direct_repair",   repairHours: 16, facility: "major_workshop", capability: "Kompositrep", label: "Direktreparation",           sparePart: "hydraulic" },
  { roll: 6, serviceable: false, kind: "troubleshooting", repairHours: 4,  facility: "service_bay",    capability: "FK Steg 1–3", label: "Felsökning, EW-system" },
] as const;

/** Weapon loss percentage by roll. @source DECK p.11 table C */
export const WEAPON_LOSS_PCT = [10, 30, 50, 70, 90, 100] as const;

/** Extra maintenance time percentage by roll ("T++"). @source DECK p.11 table D */
export const EXTRA_TIME_PCT = [0, 0, 0, 10, 20, 50] as const;

/** Which capabilities each facility level can perform. @source DECK p.10 */
export const FACILITY_CAPABILITY: Record<FacilityType, readonly FacilityType[]> = {
  service_bay: ["service_bay"],
  minor_workshop: ["service_bay", "minor_workshop"],
  major_workshop: ["service_bay", "minor_workshop", "major_workshop"],
};

/** Can a job needing `required` be done in a bay of level `available`? */
export function facilityCanHandle(available: FacilityType, required: FacilityType): boolean {
  return FACILITY_CAPABILITY[available].includes(required);
}

export function rollUtfallA(rng: Rng): UtfallOutcome {
  return UTFALL_A[rng.roll(6) - 1];
}

export function rollUtfallB(rng: Rng): UtfallOutcome {
  return UTFALL_B[rng.roll(6) - 1];
}

/** Apply the deck's T++ extra-time roll to a nominal repair time. */
export function applyExtraTime(nominalHours: number, rng: Rng): { hours: number; extraPct: number } {
  const extraPct = EXTRA_TIME_PCT[rng.roll(6) - 1];
  return { hours: nominalHours * (1 + extraPct / 100), extraPct };
}

export const MAINTENANCE_LABEL: Record<MaintenanceKind, string> = {
  quick_lru: "Snabbt LRU-byte",
  complex_lru: "Komplext LRU-byte",
  direct_repair: "Direktreparation",
  troubleshooting: "Felsökning",
  scheduled_service: "Planerad service",
};

export const FACILITY_LABEL: Record<FacilityType, string> = {
  service_bay: "Serviceplats",
  minor_workshop: "Lätt verkstad",
  major_workshop: "Tung verkstad",
};

export const SPARE_LABEL: Record<SparePartId, string> = {
  computer: "Datorenhet",
  radar: "Radarmodul",
  hydraulic: "Hydraulenhet",
  wheel: "Hjul",
};
