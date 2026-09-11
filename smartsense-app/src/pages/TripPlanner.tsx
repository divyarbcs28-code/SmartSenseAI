// ---------------------------------------------------------------------------
// Trip Planner — source/destination + arrival-time preference for the trip.
// Source is always the driver's real GPS position (Browser Geolocation API,
// same as Rest Management). Destination is a real place found via the free,
// keyless OpenStreetMap Nominatim search — never guessed or generated.
//
// Once a destination is set here, Rest Management automatically switches
// from "nearby my current location" to searching for safe stops along the
// whole route corridor between source and destination, and Sleep/Recovery's
// wake window uses the "arrive by" time to warn (never to shorten rest) if
// the recommended wake window looks tight against the deadline.
// ---------------------------------------------------------------------------

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Clock, Loader2, MapPin, Navigation, Route, Search, X } from "lucide-react";
import { Button, Card, DashboardShell, PageIntro, Pill, SectionLabel } from "@/components/AppShell";
import { useSmartSense } from "@/lib/smartsense";
import { useGeolocation } from "@/lib/geolocation";
import { geocodeAddress, type GeocodeOutcome, type GeocodeResult } from "@/lib/geocoding";
import { fetchDrivingRoute } from "@/lib/routing";
import SafeZoneMap from "@/components/SafeZoneMap";

export default function TripPlanner() {
  const { state, dispatch } = useSmartSense();
  const geo = useGeolocation();
  const usingLiveGps = geo.status === "granted" && !!geo.fix;

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<GeocodeOutcome>({ status: "idle", results: [] });
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearch({ status: "loading", results: [] });
    const result = await geocodeAddress(trimmed);
    setSearch(result);
  };

  const planTrip = async (dest: GeocodeResult) => {
    setSearch({ status: "idle", results: [] });
    setQuery("");
    setRouteError(null);
    if (!geo.fix) {
      // No live GPS yet — still save the destination so it's ready the moment location comes through.
      dispatch({ type: "setDestination", destination: dest });
      return;
    }
    setRouteLoading(true);
    const route = await fetchDrivingRoute(geo.fix.latitude, geo.fix.longitude, dest.lat, dest.lng);
    setRouteLoading(false);
    if (!route) {
      setRouteError("Couldn't calculate a driving route right now — the free routing service may be busy. Your destination is still saved.");
      dispatch({ type: "setDestination", destination: dest });
      return;
    }
    dispatch({ type: "setDestination", destination: dest, tripDistanceKm: route.distanceKm, tripDurationMin: route.durationMin });
  };

  const clearTrip = () => {
    dispatch({ type: "clearDestination" });
    setRouteError(null);
  };

  const eta = (() => {
    if (!state.tripDurationMin) return null;
    return new Date(Date.now() + state.tripDurationMin * 60000);
  })();

  const deadline = (() => {
    if (!state.arriveByTime) return null;
    const [h, m] = state.arriveByTime.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1); // treat as "tomorrow" once today's time has passed
    return d;
  })();

  const deadlineTight = eta && deadline ? eta.getTime() > deadline.getTime() : false;

  return (
    <DashboardShell>
      <PageIntro
        eyebrow="SmartSense / Trip Planner"
        title="Trip Planner"
        description="Set a real destination and an arrival preference — Rest Management then recommends safe stops along this route instead of just around where you are right now."
        action={state.destination ? <Pill tone="good">Trip active</Pill> : <Pill>No trip planned</Pill>}
      />

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <Card>
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-primary" />
              <SectionLabel>Source</SectionLabel>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {geo.status === "loading" && "Finding your location…"}
              {geo.status === "denied" && "Location access is off — allow it to plan a trip from your real position."}
              {geo.status === "unavailable" && "Your location isn't available right now."}
              {usingLiveGps && geo.fix && `Your live GPS position — ${geo.fix.latitude.toFixed(4)}, ${geo.fix.longitude.toFixed(4)}`}
            </p>
            {(geo.status === "denied" || geo.status === "unavailable") && (
              <Button size="sm" variant="secondary" className="mt-3" onClick={geo.retry}>
                Try again
              </Button>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <Navigation size={16} className="text-primary" />
              <SectionLabel>Destination</SectionLabel>
            </div>

            {state.destination ? (
              <div className="mt-3">
                <div className="flex items-start justify-between gap-3 rounded-2xl bg-primary/10 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-display font-bold">{state.destination.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {state.destination.lat.toFixed(4)}, {state.destination.lng.toFixed(4)}
                    </p>
                  </div>
                  <button onClick={clearTrip} className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Clear destination">
                    <X size={15} />
                  </button>
                </div>
                {routeLoading && (
                  <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 size={13} className="animate-spin" /> Calculating driving route…
                  </p>
                )}
                {state.tripDistanceKm != null && state.tripDurationMin != null && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-secondary/60 p-3">
                      <p className="text-[11px] text-muted-foreground">Distance</p>
                      <p className="mt-1 font-display text-lg font-bold">{state.tripDistanceKm} km</p>
                    </div>
                    <div className="rounded-2xl bg-secondary/60 p-3">
                      <p className="text-[11px] text-muted-foreground">Driving time</p>
                      <p className="mt-1 font-display text-lg font-bold">
                        {Math.floor(state.tripDurationMin / 60)}h {state.tripDurationMin % 60}m
                      </p>
                    </div>
                  </div>
                )}
                {eta && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    At current pace, you'd arrive around <b className="text-foreground">{eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</b>.
                  </p>
                )}
                {routeError && <p className="mt-3 text-xs text-warning">{routeError}</p>}
              </div>
            ) : (
              <form onSubmit={handleSearch} className="mt-3">
                <div className="flex gap-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search a real place — e.g. Madurai, or a highway rest stop"
                    className="min-w-0 flex-1 rounded-xl bg-secondary/60 px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Button type="submit" size="md" disabled={search.status === "loading" || !query.trim()}>
                    {search.status === "loading" ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Free OpenStreetMap place search — no API key. Press search rather than typing continuously, to be respectful of the free public service.
                </p>

                {search.status === "success" && (
                  <div className="mt-3 space-y-2">
                    {search.results.map((r) => (
                      <button
                        key={`${r.lat},${r.lng}`}
                        onClick={() => planTrip(r)}
                        className="block w-full rounded-xl bg-secondary/60 px-3.5 py-2.5 text-left text-sm hover:bg-secondary"
                      >
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
                {search.status === "no-results" && <p className="mt-3 text-xs text-muted-foreground">No real places matched that search — try a different name.</p>}
                {search.status === "error" && <p className="mt-3 text-xs text-warning">{search.errorMessage ?? "Place search failed — try again."}</p>}
              </form>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-primary" />
              <SectionLabel>Arrive by</SectionLabel>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Optional — lets SmartSense flag it if your recommended rest window looks tight against your deadline. It never shortens your rest to hit a time.</p>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="time"
                value={state.arriveByTime ?? ""}
                onChange={(e) => dispatch({ type: "setArriveByTime", time: e.target.value || null })}
                className="rounded-xl bg-secondary/60 px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {state.arriveByTime && (
                <button onClick={() => dispatch({ type: "setArriveByTime", time: null })} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  Clear
                </button>
              )}
            </div>
            {deadlineTight && (
              <div className="mt-4 flex items-start gap-3 rounded-2xl bg-warning/10 p-3.5">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
                <p className="text-xs leading-relaxed text-warning">
                  At today's driving pace, you'd arrive after your target time — and that's before any rest stops. Consider an earlier start or a later "arrive by" time; SmartSense won't cut your rest short to help you make it.
                </p>
              </div>
            )}
          </Card>
        </div>

        <Card className="min-h-[420px] overflow-hidden p-0">
          <div className="relative h-full min-h-[420px]">
            <SafeZoneMap
              driverPosition={usingLiveGps && geo.fix ? { lat: geo.fix.latitude, lng: geo.fix.longitude } : null}
              zones={state.destination ? [{ id: "trip-destination", name: state.destination.name, lat: state.destination.lat, lng: state.destination.lng, isTop: true }] : []}
              routeToZoneId={state.destination ? "trip-destination" : null}
              className="absolute inset-0 h-full w-full"
            />
            {!state.destination && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/40 backdrop-blur-[1px]">
                <div className="soft-card pointer-events-auto rounded-2xl bg-card/95 px-5 py-4 text-center">
                  <Route size={20} className="mx-auto text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">Search a destination to see your route here.</p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </section>

      {state.destination && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Rest Management is now recommending real safe stops along this route instead of just around your current position.
            </p>
            <Link to="/rest">
              <Button variant="secondary" size="sm">
                Open Rest Management
              </Button>
            </Link>
          </div>
        </Card>
      )}
    </DashboardShell>
  );
}
