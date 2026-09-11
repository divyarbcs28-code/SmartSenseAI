// ---------------------------------------------------------------------------
// Free, keyless place search via OpenStreetMap's Nominatim geocoding API —
// no API key, no billing, consistent with the rest of SmartSense's GPS/places
// stack. Used by Trip Planner to turn a typed destination name into real
// coordinates. Nominatim's usage policy asks for a real identifying request
// (no autocomplete-per-keystroke hammering) — callers should only geocode on
// an explicit search action (submit/click), never on every keystroke.
// https://operations.osmfoundation.org/policies/nominatim/
// ---------------------------------------------------------------------------

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

export interface GeocodeResult {
  name: string;
  lat: number;
  lng: number;
}

export type GeocodeStatus = "idle" | "loading" | "success" | "no-results" | "error";

export interface GeocodeOutcome {
  status: GeocodeStatus;
  results: GeocodeResult[];
  errorMessage?: string;
}

/** Looks up real places matching a typed query (e.g. "Madurai" or "NH44 rest area, Salem"). */
export async function geocodeAddress(query: string): Promise<GeocodeOutcome> {
  const trimmed = query.trim();
  if (!trimmed) return { status: "no-results", results: [] };

  try {
    const params = new URLSearchParams({ format: "jsonv2", q: trimmed, limit: "5", addressdetails: "0" });
    const res = await fetch(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { status: "error", results: [], errorMessage: `Place search failed (HTTP ${res.status}).` };
    }
    const data = await res.json().catch(() => null);
    const rows: any[] = Array.isArray(data) ? data : [];
    const results: GeocodeResult[] = rows
      .filter((r) => r.lat != null && r.lon != null)
      .map((r) => ({ name: r.display_name as string, lat: parseFloat(r.lat), lng: parseFloat(r.lon) }));

    if (results.length === 0) return { status: "no-results", results: [] };
    return { status: "success", results };
  } catch (err) {
    return {
      status: "error",
      results: [],
      errorMessage: err instanceof Error ? err.message : "Couldn't reach the place search service.",
    };
  }
}
