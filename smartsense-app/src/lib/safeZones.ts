// ---------------------------------------------------------------------------
// Safe Zone Recommendation — ranking only. SmartSense (not Google Maps) owns
// this: it takes real nearby places (from places.ts, sourced from the free
// OpenStreetMap Overpass API — either around the driver's current position,
// or along the whole route corridor once a Trip Planner destination is set)
// plus the driver's current GPS fix and the 5-stage drowsiness severity
// (state.vigilanceState) and ranks them by distance, safety indicator,
// facilities and severity. Google Maps is only ever handed a destination
// (and origin) afterwards for the actual route.
//
// This module used to also *generate* synthetic demo safe zones around the
// driver's position. That generator has been removed — safe zones now only
// ever come from real places (places.ts) or the clearly-labeled static demo
// fallback in smartsense.tsx; nothing here invents coordinates.
// ---------------------------------------------------------------------------

import { haversineKm } from "./geolocation";
import type { VigilanceState } from "./smartsense";

export type SafeZoneType = "Rest Area" | "Highway Amenity" | "Fuel Station" | "Parking Bay" | "Hotel";

export interface SafeZone {
  id: string;
  name: string;
  type: SafeZoneType;
  lat: number;
  lng: number;
  safetyScore: number;
  facilities: string[];
}

export interface RankedSafeZone extends SafeZone {
  distanceKm: number;
  etaMin: number;
  rankScore: number;
}

/**
 * Ranking weights per drowsiness stage (Settings → Demo controls uses these same 5 stages). Each
 * row sums to 1.0. The ordinal logic behind each:
 *  - Stage 1 ALERT       — no urgency: pick the best-equipped/safest stop even if a bit farther.
 *                          Facilities > Safety > Distance.
 *  - Stage 2 FATIGUE     — still browsing, but starting to matter. Safety ≈ Facilities > Distance.
 *  - Stage 3 DROWSINESS  — a real rest is due; proximity now matters as much as safety.
 *                          Distance ≈ Safety > Facilities.
 *  - Stage 4 SEVERE      — high risk: get there fast, safety is a secondary check, facilities barely count.
 *                          Distance > Safety > Facilities.
 *  - Stage 5 CRITICAL    — emergency: nearest safe stop, full stop. Distance only.
 */
const stageWeights: Record<VigilanceState, { distance: number; safety: number; facilities: number }> = {
  ALERT: { distance: 0.15, safety: 0.35, facilities: 0.5 },
  FATIGUE: { distance: 0.25, safety: 0.4, facilities: 0.35 },
  DROWSINESS: { distance: 0.4, safety: 0.4, facilities: 0.2 },
  SEVERE: { distance: 0.6, safety: 0.3, facilities: 0.1 },
  CRITICAL: { distance: 1, safety: 0, facilities: 0 },
};

/**
 * Ranks safe zones by distance from the driver's current GPS location, safety indicator,
 * facilities, and drowsiness severity (the 5-stage vigilanceState — see stageWeights above). As
 * severity rises toward CRITICAL, distance dominates and eventually becomes the only factor, so a
 * critically drowsy driver is always steered to the nearest suitable option, not the "best" one.
 */
export function rankSafeZones(
  zones: SafeZone[],
  driverLat: number,
  driverLng: number,
  vigilanceState: VigilanceState,
  driverSpeedKmh?: number | null,
): RankedSafeZone[] {
  const assumedSpeedKmh = driverSpeedKmh && driverSpeedKmh > 15 ? driverSpeedKmh : 45;

  const { distance: distanceWeight, safety: safetyWeight, facilities: facilitiesWeight } = stageWeights[vigilanceState];

  return zones
    .map((zone) => {
      const distanceKm = haversineKm(driverLat, driverLng, zone.lat, zone.lng);
      const etaMin = Math.max(1, Math.round((distanceKm / assumedSpeedKmh) * 60));
      const facilitiesScore = Math.min(100, zone.facilities.length * 25);
      const distanceScore = Math.max(0, 100 - (distanceKm / 20) * 100);
      const rankScore = Math.round(
        zone.safetyScore * safetyWeight + distanceScore * distanceWeight + facilitiesScore * facilitiesWeight,
      );
      return {
        ...zone,
        distanceKm: Math.round(distanceKm * 10) / 10,
        etaMin,
        rankScore: Math.max(0, Math.min(100, rankScore)),
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore);
}
