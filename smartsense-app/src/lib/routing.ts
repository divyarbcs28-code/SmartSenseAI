// ---------------------------------------------------------------------------
// Free, keyless driving-route lookup via the public OSRM demo routing server
// — no API key, no billing. Shared by SafeZoneMap (route preview line) and
// Trip Planner / Rest Management (corridor search + ETA to destination).
// ---------------------------------------------------------------------------

const OSRM_ROUTE_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";

export interface DrivingRoute {
  /** [lat, lng] pairs along the route, in order. */
  coords: [number, number][];
  distanceKm: number;
  durationMin: number;
}

/** Fetches a real driving route between two points. Returns null if the free routing server is
 * unreachable or rate-limited — callers should fall back gracefully (a straight line, or skipping
 * the corridor search) rather than blocking on it. */
export async function fetchDrivingRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<DrivingRoute | null> {
  try {
    const url = `${OSRM_ROUTE_ENDPOINT}/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return {
      coords: coords.map((c: [number, number]) => [c[1], c[0]]),
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      durationMin: Math.max(1, Math.round(route.duration / 60)),
    };
  } catch {
    return null;
  }
}

/** Evenly samples up to `count` points along a route polyline (always includes the first and last
 * point) — used to search for safe zones along the whole corridor instead of just one radius. */
export function sampleRoutePoints(coords: [number, number][], count = 8): [number, number][] {
  if (coords.length <= count) return coords;
  const step = (coords.length - 1) / (count - 1);
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    points.push(coords[Math.round(i * step)]);
  }
  return points;
}
