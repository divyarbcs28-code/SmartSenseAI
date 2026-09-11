// ---------------------------------------------------------------------------
// Real nearby-places lookup via the OpenStreetMap Overpass API — completely
// free: no API key, no billing account, no Google Cloud project required.
// Replaces synthetic/generated demo safe zones: every place returned here is
// a real, named location from OpenStreetMap's crowd-sourced map data, with a
// real latitude/longitude, fetched around the driver's actual current GPS
// position. SmartSense still owns ranking (distance + safety indicator +
// facilities + drowsiness severity) and the rest-decision logic — this
// module's only job is "what real places exist near here".
//
// Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
// Overpass is a public, free, keyless HTTPS API with CORS enabled for direct
// browser use. Several independent public mirrors exist; this tries them in
// order in case one is temporarily rate-limited or unreachable.
// ---------------------------------------------------------------------------

import type { SafeZone, SafeZoneType } from "./safeZones";

export type PlacesStatus = "idle" | "loading" | "success" | "no-results" | "error";

export interface RealPlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tags: Record<string, string>;
}

export interface PlacesResult {
  status: PlacesStatus;
  places: RealPlace[];
  errorMessage?: string;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

const DEFAULT_RADIUS_METERS = 15000;
const MAX_RESULTS = 40;

// The real place types the driver needs: petrol pumps, highway rest/service
// areas, parking areas, and hotels/motels (lodging with parking). Both nodes
// (point features) and ways (e.g. a parking lot mapped as an area) are
// queried — "out center" gives ways a usable lat/lng centroid.
function buildOverpassQuery(lat: number, lng: number, radiusMeters: number): string {
  const around = `around:${radiusMeters},${lat},${lng}`;
  const clauses = [
    `node["amenity"="fuel"](${around});`,
    `way["amenity"="fuel"](${around});`,
    `node["amenity"="parking"](${around});`,
    `way["amenity"="parking"](${around});`,
    `node["tourism"="hotel"](${around});`,
    `way["tourism"="hotel"](${around});`,
    `node["tourism"="motel"](${around});`,
    `way["tourism"="motel"](${around});`,
    `node["highway"="rest_area"](${around});`,
    `way["highway"="rest_area"](${around});`,
    `node["highway"="services"](${around});`,
    `way["highway"="services"](${around});`,
  ].join("\n      ");
  return `[out:json][timeout:20];\n    (\n      ${clauses}\n    );\n    out center ${MAX_RESULTS};`;
}

function defaultNameForTags(tags: Record<string, string>): string {
  if (tags.amenity === "fuel") return "Fuel Station";
  if (tags.amenity === "parking") return "Parking Area";
  if (tags.tourism === "hotel") return "Hotel";
  if (tags.tourism === "motel") return "Motel";
  if (tags.highway === "rest_area") return "Highway Rest Area";
  if (tags.highway === "services") return "Highway Service Area";
  return "Unnamed location";
}

/** Runs one Overpass QL query against each public mirror in order until one succeeds — shared by
 * both the radius-around-a-point search and the route-corridor search below. */
async function runOverpassQuery(query: string): Promise<PlacesResult> {
  let lastError: string | undefined;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }).toString(),
      });

      if (!res.ok) {
        lastError = `OpenStreetMap lookup failed (HTTP ${res.status}) at ${safeHostname(endpoint)}.`;
        continue; // try the next mirror
      }

      const data = await res.json().catch(() => null);
      const elements: any[] = Array.isArray(data?.elements) ? data.elements : [];

      const seen = new Set<string>();
      const places: RealPlace[] = [];
      for (const el of elements) {
        if (!el?.tags || (el.lat == null && el.center?.lat == null)) continue;
        const id = `${el.type}/${el.id}`;
        if (seen.has(id)) continue; // a route-corridor query can revisit the same place from two sample points
        seen.add(id);
        places.push({
          id,
          name: el.tags.name ?? defaultNameForTags(el.tags),
          lat: el.lat ?? el.center.lat,
          lng: el.lon ?? el.center.lon,
          tags: el.tags as Record<string, string>,
        });
      }

      if (places.length === 0) {
        return { status: "no-results", places: [] };
      }
      return { status: "success", places };
    } catch (err) {
      lastError = err instanceof Error ? err.message : `Network error reaching ${safeHostname(endpoint)}.`;
      // try the next mirror
    }
  }

  return { status: "error", places: [], errorMessage: lastError ?? "Couldn't reach any OpenStreetMap Overpass mirror." };
}

/** Fetches real nearby places (fuel, rest/service areas, parking, hotels) around the driver's actual GPS position from OpenStreetMap — free, no key, no billing. Never generates or guesses coordinates; every result is a real mapped place. */
export async function fetchNearbySafePlaces(lat: number, lng: number, radiusMeters = DEFAULT_RADIUS_METERS): Promise<PlacesResult> {
  return runOverpassQuery(buildOverpassQuery(lat, lng, radiusMeters));
}

/** Fetches real safe places along an entire driving route (Trip Planner) instead of just around one
 * point — samples several points spread along the route and searches around each, so a stop near
 * the middle of a long trip shows up even though it's far from the driver's current position. */
export async function fetchSafePlacesAlongRoute(
  routeCoords: [number, number][],
  corridorRadiusMeters = 3000,
  maxSamplePoints = 8,
): Promise<PlacesResult> {
  if (routeCoords.length === 0) return { status: "no-results", places: [] };

  const step = routeCoords.length <= maxSamplePoints ? 1 : (routeCoords.length - 1) / (maxSamplePoints - 1);
  const samplePoints: [number, number][] = [];
  const count = Math.min(maxSamplePoints, routeCoords.length);
  for (let i = 0; i < count; i++) {
    samplePoints.push(routeCoords[Math.round(i * step)]);
  }

  const clauses = samplePoints
    .map(([lat, lng]) => {
      const around = `around:${corridorRadiusMeters},${lat},${lng}`;
      return [
        `node["amenity"="fuel"](${around});`,
        `way["amenity"="fuel"](${around});`,
        `node["amenity"="parking"](${around});`,
        `way["amenity"="parking"](${around});`,
        `node["tourism"="hotel"](${around});`,
        `way["tourism"="hotel"](${around});`,
        `node["tourism"="motel"](${around});`,
        `way["tourism"="motel"](${around});`,
        `node["highway"="rest_area"](${around});`,
        `way["highway"="rest_area"](${around});`,
        `node["highway"="services"](${around});`,
        `way["highway"="services"](${around});`,
      ].join("\n      ");
    })
    .join("\n      ");

  const query = `[out:json][timeout:25];\n    (\n      ${clauses}\n    );\n    out center ${MAX_RESULTS};`;
  return runOverpassQuery(query);
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Turning a real OpenStreetMap place into the app's generic SafeZone shape.
// ---------------------------------------------------------------------------

export function categorizePlace(tags: Record<string, string>): SafeZoneType {
  if (tags.highway === "rest_area" || tags.highway === "services") return "Rest Area";
  if (tags.amenity === "fuel") return "Fuel Station";
  if (tags.amenity === "parking") return "Parking Bay";
  if (tags.tourism === "hotel" || tags.tourism === "motel") return "Hotel";
  return "Highway Amenity";
}

/** Derives a short, human-readable facilities list from real OpenStreetMap tags — real mapped data, not invented. */
export function facilitiesFromTags(tags: Record<string, string>): string[] {
  const facilities: string[] = [];
  if (tags.amenity === "fuel") facilities.push("Fuel");
  if (tags["fuel:diesel"] === "yes") facilities.push("Diesel");
  if (tags["fuel:octane_95"] === "yes" || tags["fuel:octane_91"] === "yes" || tags["fuel:octane_98"] === "yes") facilities.push("Petrol");
  if (tags.amenity === "parking") facilities.push("Parking");
  if (tags.toilets === "yes") facilities.push("Restroom");
  if (tags.shop === "convenience") facilities.push("Convenience store");
  if (tags.amenity === "restaurant" || tags.amenity === "fast_food" || tags.cuisine) facilities.push("Food");
  if (tags.tourism === "hotel" || tags.tourism === "motel") facilities.push("Lodging");
  if (tags.highway === "rest_area" || tags.highway === "services") facilities.push("Rest area");
  if (tags.opening_hours === "24/7") facilities.push("24/7");
  if (tags.internet_access === "wlan" || tags.internet_access === "yes") facilities.push("WiFi");

  const unique = Array.from(new Set(facilities));
  return unique.length > 0 ? unique.slice(0, 5) : [categorizePlace(tags)];
}

/**
 * Estimated safety indicator (0-100) — OpenStreetMap has no official "safety
 * score", so this is transparently derived from real signals it does
 * provide: how much detail is mapped for the location (name, opening hours,
 * lighting), plus a small baseline by venue type — never presented as an
 * authoritative rating. Always labeled "estimated" in the UI.
 */
export function estimateSafetyIndicator(place: RealPlace, category: SafeZoneType): number {
  let score = 50;
  const tagCount = Object.keys(place.tags).length;
  score += Math.min(tagCount, 12) * 2; // more mapped detail -> a more established, verifiable location
  if (place.tags.name) score += 8; // a named place, not an anonymous point
  if (place.tags.opening_hours === "24/7") score += 8;
  if (place.tags.lit === "yes") score += 5; // mapped as lit at night
  if (category === "Rest Area" || category === "Fuel Station") score += 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function realPlaceToSafeZone(place: RealPlace): SafeZone {
  const type = categorizePlace(place.tags);
  return {
    id: place.id,
    name: place.name,
    type,
    lat: place.lat,
    lng: place.lng,
    safetyScore: estimateSafetyIndicator(place, type),
    facilities: facilitiesFromTags(place.tags),
  };
}
