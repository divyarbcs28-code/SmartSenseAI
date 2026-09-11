import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Compass, Loader2, LocateFixed, MapPin, Navigation, Navigation2, Route, RefreshCw, ShieldCheck, WifiOff, X } from "lucide-react";
import { Button, Card, DashboardShell, PageIntro, Pill, SectionLabel } from "@/components/AppShell";
import { restDecisionLabelKey, restStops, restSuitabilityScore, slackMinutesToDeadline, useSmartSense } from "@/lib/smartsense";
import { cn, formatDuration } from "@/lib/utils";
import { googleMapsDirectionsUrl, useGeolocation, useOnlineStatus } from "@/lib/geolocation";
import { rankSafeZones } from "@/lib/safeZones";
import { fetchNearbySafePlaces, fetchSafePlacesAlongRoute, realPlaceToSafeZone, type PlacesResult } from "@/lib/places";
import { fetchDrivingRoute } from "@/lib/routing";
import SafeZoneMap from "@/components/SafeZoneMap";

// A single shape the UI renders regardless of where the data came from: SmartSense's real,
// GPS-ranked safe zones (from the free OpenStreetMap Overpass API) when the driver's location
// and a real lookup succeed, or the clearly-labeled static demo stops (smartsense.tsx) when
// they don't. Google Maps never sees this — it only ever receives a destination (and origin)
// once the driver taps "Navigate Now", and Navigate Now is only enabled for real, verified places.
interface DisplayZone {
  id: string;
  name: string;
  type: string;
  distanceKm: number;
  etaMin: number;
  score: number;
  safetyScore: number;
  facilities: string[];
  lat: number;
  lng: number;
  isDemo: boolean;
}

export default function RestManagement() {
  const { state, dispatch, t } = useSmartSense();
  const geo = useGeolocation();
  const online = useOnlineStatus();

  const decisionTone = state.restDecision === "CONTINUE" ? "good" : state.restDecision === "BREAK_RECOMMENDED" ? "warn" : "danger";
  const arrived = state.operatingMode === "REST";
  const usingLiveGps = geo.status === "granted" && !!geo.fix;

  // --- Real places, via the free OpenStreetMap Overpass API -----------------------------
  // Two modes: with no Trip Planner destination set, search a radius around the driver's
  // current position (as before); once a real destination is set, search along the whole
  // route corridor between here and there instead, so a great stop near the destination
  // shows up even though it's far from the driver right now. Fetched once per GPS-grant
  // "session" / destination change (not on every watchPosition tick) and re-fetchable on demand.
  const [placesResult, setPlacesResult] = useState<PlacesResult>({ status: "idle", places: [] });
  const [routeError, setRouteError] = useState<string | null>(null);
  const fetchedSignatureRef = useRef<string | null>(null);
  const usingCorridorSearch = !!state.destination;

  const loadPlaces = async (lat: number, lng: number) => {
    setPlacesResult({ status: "loading", places: [] });
    setRouteError(null);
    if (state.destination) {
      const route = await fetchDrivingRoute(lat, lng, state.destination.lat, state.destination.lng);
      if (!route) {
        setPlacesResult({ status: "error", places: [] });
        setRouteError("Couldn't calculate the driving route to your destination right now — the free routing service may be busy.");
        return;
      }
      // Keep the trip's distance/duration current — it's recalculated from wherever the driver
      // actually is right now, not just the position at the moment the trip was planned.
      dispatch({ type: "setDestination", destination: state.destination, tripDistanceKm: route.distanceKm, tripDurationMin: route.durationMin });
      const result = await fetchSafePlacesAlongRoute(route.coords);
      setPlacesResult(result);
      return;
    }
    const result = await fetchNearbySafePlaces(lat, lng);
    setPlacesResult(result);
  };

  useEffect(() => {
    if (geo.status !== "granted" || !geo.fix) {
      fetchedSignatureRef.current = null;
      return;
    }
    const signature = state.destination ? `corridor:${state.destination.lat.toFixed(4)},${state.destination.lng.toFixed(4)}` : "radius";
    if (fetchedSignatureRef.current === signature) return;
    fetchedSignatureRef.current = signature;
    loadPlaces(geo.fix.latitude, geo.fix.longitude);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.status, state.destination]);

  const usingRealPlaces = usingLiveGps && placesResult.status === "success" && placesResult.places.length > 0;

  // SmartSense keeps doing drowsiness detection, vigilance scoring, rest decisions and
  // safe-zone ranking here — Google Maps is only ever handed a destination (and origin)
  // further down, and only for real places.
  const displayZones: DisplayZone[] = useMemo(() => {
    if (usingRealPlaces && geo.fix) {
      const zones = placesResult.places.map(realPlaceToSafeZone);
      const ranked = rankSafeZones(zones, geo.fix.latitude, geo.fix.longitude, state.vigilanceState, geo.fix.speedKmh);
      return ranked.map((z) => ({
        id: z.id,
        name: z.name,
        type: z.type,
        distanceKm: z.distanceKm,
        etaMin: z.etaMin,
        score: z.rankScore,
        safetyScore: z.safetyScore,
        facilities: z.facilities,
        lat: z.lat,
        lng: z.lng,
        isDemo: false,
      }));
    }
    // No real GPS, or the real places lookup isn't available/configured/found nothing —
    // fall back to the static example stops, clearly labeled as demo everywhere they render.
    return [...restStops]
      .map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        distanceKm: s.distanceKm,
        etaMin: s.etaMin,
        score: restSuitabilityScore(s),
        safetyScore: s.safety,
        facilities: s.facilities,
        lat: s.lat,
        lng: s.lng,
        isDemo: true,
      }))
      .sort((a, b) => b.score - a.score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingRealPlaces, placesResult, geo.fix, state.vigilanceState]);

  const top = displayZones[0];
  // Whichever location the driver last tapped in the list — the embedded map's preview
  // route follows this, defaulting to the top-ranked recommendation until something else
  // is picked. Selecting a card reuses the existing "startNavigation" flow (selectedStopId),
  // so "Simulate arrival" below keeps working exactly as it always has.
  const previewZone = displayZones.find((zone) => zone.id === state.selectedStopId) ?? top;

  // When a Trip Planner "arrive by" deadline is set and there's little slack left to fit a stop in
  // and still make it, the Rest Decision Engine itself nudges toward resting sooner (see
  // decisionFromState/slackMinutesToDeadline in lib/smartsense.tsx) — waiting only shrinks the
  // remaining slack further. This never invents urgency beyond REST_NOW on its own, and never
  // shortens the rest itself once it starts (see Sleep/Recovery's wake window).
  const deadlineSlackMin = slackMinutesToDeadline(state);
  const deadlinePressure = deadlineSlackMin != null && deadlineSlackMin < 30;

  const reason =
    state.restDecision === "CONTINUE"
      ? "Vigilance is stable and continuous driving duration is within a safe range — no rest action required yet."
      : state.restDecision === "BREAK_RECOMMENDED"
        ? "Vigilance has been gradually decreasing while continuous driving duration has increased. A short break is recommended before the trend intensifies."
        : state.restDecision === "REST_NOW"
          ? "Drowsiness has been detected with a decreasing trend. SmartSense recommends resting at the next suitable location."
          : "Critical drowsiness detected with a rapidly decreasing trend. Please stop at a safe location immediately.";
  const reasonWithDeadline = deadlinePressure
    ? `${reason} Your planned arrival by ${state.arriveByTime} at ${state.destination?.name} leaves little slack for a stop — resting sooner rather than later gives you the best chance of still making it. SmartSense won't shorten the rest itself to help, though: see Sleep/Recovery.`
    : reason;

  // --- Combined GPS + real-places status banner ----------------------------------------
  const statusInfo = (() => {
    if (geo.status === "loading") {
      return { tone: "default" as const, icon: Loader2, spin: true, title: "Finding your location…", body: "Getting your GPS position so SmartSense can look up real nearby safe places.", action: null as null | { label: string; onClick: () => void } };
    }
    if (geo.status === "denied") {
      return { tone: "warn" as const, icon: MapPin, spin: false, title: "Location access is off", body: "Allow location for this site to look up real nearby fuel stations, rest areas, parking and hotels. Showing example demo stops for now.", action: { label: "Try again", onClick: geo.retry } };
    }
    if (geo.status === "unavailable") {
      return { tone: "warn" as const, icon: MapPin, spin: false, title: "Location isn't available right now", body: "Showing example demo stops instead — this updates automatically once your location can be read.", action: { label: "Try again", onClick: geo.retry } };
    }
    // geo.status === "granted" from here on
    const routeDesc = usingCorridorSearch ? `along your route to ${state.destination!.name}` : "near your current location";
    switch (placesResult.status) {
      case "idle":
      case "loading":
        return {
          tone: "default" as const,
          icon: Loader2,
          spin: true,
          title: usingCorridorSearch ? "Finding real places along your route…" : "Finding real nearby places…",
          body: `Searching OpenStreetMap for fuel stations, rest areas, parking and hotels ${routeDesc}.`,
          action: null,
        };
      case "success":
        return {
          tone: "good" as const,
          icon: usingCorridorSearch ? Route : LocateFixed,
          spin: false,
          title: usingCorridorSearch ? "Using your planned route" : "Using your live location",
          body: `Showing ${placesResult.places.length} real place${placesResult.places.length === 1 ? "" : "s"} from OpenStreetMap ${routeDesc}, ranked by distance, safety indicator, facilities and drowsiness severity.`,
          action: { label: "Refresh", onClick: () => geo.fix && loadPlaces(geo.fix.latitude, geo.fix.longitude) },
        };
      case "no-results":
        return {
          tone: "warn" as const,
          icon: MapPin,
          spin: false,
          title: "No real places found",
          body: `Nothing matched fuel stations, rest areas, parking or hotels ${routeDesc} — showing example demo stops instead.`,
          action: { label: "Search again", onClick: () => geo.fix && loadPlaces(geo.fix.latitude, geo.fix.longitude) },
        };
      case "error":
      default:
        return {
          tone: "warn" as const,
          icon: WifiOff,
          spin: false,
          title: "Couldn't reach the places service",
          body: routeError ?? placesResult.errorMessage ?? "The real places lookup failed — showing example demo stops instead.",
          action: { label: "Retry", onClick: () => geo.fix && loadPlaces(geo.fix.latitude, geo.fix.longitude) },
        };
    }
  })();

  return (
    <DashboardShell>
      <PageIntro
        eyebrow={`SmartSense / ${t("restManagement")}`}
        title={t("restManagement")}
        description="The Rest Decision Engine combines vigilance, trend, continuous driving duration and recovery to decide: continue, break, rest or stop."
        action={<Pill tone={decisionTone}>{t(restDecisionLabelKey[state.restDecision])}</Pill>}
      />

      <div
        className={cn(
          "flex flex-col items-start gap-3 rounded-2xl px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between",
          statusInfo.tone === "good" ? "bg-success/10" : statusInfo.tone === "warn" ? "bg-warning/10" : "bg-secondary/60",
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full",
              statusInfo.tone === "good" ? "bg-success/20 text-success" : statusInfo.tone === "warn" ? "bg-warning/20 text-warning" : "bg-secondary text-muted-foreground",
            )}
          >
            <statusInfo.icon size={16} className={statusInfo.spin ? "animate-spin" : undefined} />
          </span>
          <div>
            <p className={cn("text-sm font-semibold", statusInfo.tone === "good" ? "text-success" : statusInfo.tone === "warn" ? "text-warning" : "text-foreground")}>{statusInfo.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{statusInfo.body}</p>
          </div>
        </div>
        {statusInfo.action && (
          <Button size="sm" variant="secondary" className="shrink-0" onClick={statusInfo.action.onClick}>
            <RefreshCw size={13} /> {statusInfo.action.label}
          </Button>
        )}
      </div>

      {!online && (
        <div className="flex items-center gap-3 rounded-2xl bg-destructive/10 px-4 py-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive">
            <WifiOff size={16} />
          </span>
          <p className="text-sm text-destructive">
            <span className="font-semibold">You're offline.</span> Real place lookup and "Navigate Now" both need an
            internet connection.
          </p>
        </div>
      )}

      {state.destination && (
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-primary/10 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <Route size={16} />
            </span>
            <p className="text-sm">
              <span className="font-semibold">Trip planned to {state.destination.name}.</span>{" "}
              <span className="text-muted-foreground">Recommending real stops along this route instead of just nearby.</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link to="/trip-planner">
              <Button size="sm" variant="secondary">Edit trip</Button>
            </Link>
            <button
              onClick={() => dispatch({ type: "clearDestination" })}
              className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
              aria-label="Clear trip"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <section className="grid gap-6 xl:grid-cols-12">
        <Card tone={state.restDecision === "CONTINUE" ? undefined : "warn"} className="xl:col-span-7">
          <Pill tone={decisionTone}>{t(restDecisionLabelKey[state.restDecision])}</Pill>
          <h3 className="mt-5 font-display text-3xl font-extrabold">
            {state.restDecision === "CONTINUE" ? "Safe to continue driving." : "The next safe decision is clear."}
          </h3>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{reasonWithDeadline}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-background/60 p-4">
              <SectionLabel>{t("continuousDriving")}</SectionLabel>
              <p className="mt-2 font-display text-2xl font-bold">{formatDuration(state.continuousDrivingMinutes)}</p>
            </div>
            <div className="rounded-2xl bg-background/60 p-4">
              <SectionLabel>{t("vigilanceScore")}</SectionLabel>
              <p className="mt-2 font-display text-2xl font-bold">{state.vigilanceScore} / 100</p>
            </div>
          </div>
          {!arrived && state.restDecision !== "CONTINUE" && (
            <a href="#locations" className="mt-6 inline-flex">
              <Button>{t("findRestLocation")} <Navigation size={15} /></Button>
            </a>
          )}
          {arrived && (
            <div className="mt-6 flex items-center gap-2 rounded-2xl bg-success/10 px-4 py-3 text-sm text-success">
              <CheckCircle2 size={16} /> Arrived — Rest Mode active. See Sleep / Recovery to monitor EEG sleep state.
            </div>
          )}
        </Card>
        <Card className="xl:col-span-5">
          <div className="flex items-center justify-between">
            <SectionLabel>{t("restSuitability")}</SectionLabel>
            {top.isDemo && <Pill tone="warn">Demo data</Pill>}
          </div>
          <div className="mt-4 flex items-end gap-2">
            <span className="font-display text-6xl font-extrabold">{top.score}</span>
            <span className="mb-2 font-mono text-sm text-muted-foreground">/ 100</span>
          </div>
          <div className="mt-5 space-y-3">
            {[
              ["Type", top.type],
              [top.isDemo ? t("safety") : "Safety (estimated)", `${top.safetyScore}/100`],
              [t("distance"), `${top.distanceKm} km`],
              [t("facilities"), top.facilities.join(" · ")],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-border/70 pb-3 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2 text-xs text-success">
            <ShieldCheck size={15} />
            {top.isDemo
              ? " Example data — ranked the same way real places would be, but not a verified real location."
              : " Ranked by your live distance, an estimated safety indicator, facilities and drowsiness severity — not distance alone."}
          </div>
        </Card>
      </section>
      <section id="locations" className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="min-h-[320px] overflow-hidden p-0">
          <div className="relative h-full min-h-[320px]">
            <SafeZoneMap
              driverPosition={usingLiveGps && geo.fix ? { lat: geo.fix.latitude, lng: geo.fix.longitude } : null}
              zones={displayZones.map((zone) => ({ id: zone.id, name: zone.name, lat: zone.lat, lng: zone.lng, isTop: zone.id === previewZone?.id }))}
              routeToZoneId={previewZone?.id ?? null}
              className="absolute inset-0 h-full w-full"
            />
            <div className="soft-card pointer-events-none absolute bottom-5 left-5 z-[1000] rounded-2xl bg-card/90 p-3 backdrop-blur">
              <p className="text-[11px] text-muted-foreground">{usingLiveGps ? "Live GPS position" : "Demo position (not live)"}</p>
              <p className="mt-1 text-sm font-semibold">
                {usingLiveGps && geo.fix ? `${geo.fix.latitude.toFixed(4)}, ${geo.fix.longitude.toFixed(4)}` : "Chennai → Madurai · NH 44"}
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <MapPin size={13} className="text-primary" /> {previewZone.distanceKm} km to {previewZone.name}
              </div>
              {usingLiveGps && geo.fix && (geo.fix.speedKmh != null || geo.fix.headingDeg != null) && (
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  {geo.fix.speedKmh != null && (
                    <span className="inline-flex items-center gap-1">
                      <Compass size={12} /> {Math.round(geo.fix.speedKmh)} km/h
                    </span>
                  )}
                  {geo.fix.headingDeg != null && <span>Heading {Math.round(geo.fix.headingDeg)}°</span>}
                </div>
              )}
              {usingLiveGps && (
                <p className="mt-2 text-[10px] text-muted-foreground">Preview route · tap Navigate Now for real turn-by-turn</p>
              )}
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <SectionLabel>Safe rest locations</SectionLabel>
            {usingLiveGps && (
              <button
                onClick={() => geo.fix && loadPlaces(geo.fix.latitude, geo.fix.longitude)}
                disabled={placesResult.status === "loading"}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw size={12} className={placesResult.status === "loading" ? "animate-spin" : undefined} /> {usingCorridorSearch ? "Refresh route stops" : "Refresh nearby places"}
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Tap a location to preview its route on the map — tap Navigate Now for real turn-by-turn directions.</p>
          <div className="mt-4 space-y-3">
            {displayZones.map((zone) => {
              const isSelected = zone.id === previewZone?.id;
              return (
                <div
                  key={zone.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => dispatch({ type: "startNavigation", stopId: zone.id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      dispatch({ type: "startNavigation", stopId: zone.id });
                    }
                  }}
                  className={`cursor-pointer rounded-2xl p-4 transition ${isSelected ? "bg-primary/10 ring-2 ring-primary" : "bg-secondary/60 hover:bg-secondary"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-display font-bold">{zone.name}</p>
                        {zone.isDemo && <Pill tone="warn">Demo</Pill>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{zone.type} · {zone.distanceKm} km · {zone.etaMin} min</p>
                    </div>
                    <Pill tone={isSelected ? "dark" : "default"}>{zone.score} / 100</Pill>
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground">{zone.facilities.join(" · ")}</p>
                  {isSelected && (
                    <p className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-primary">
                      <MapPin size={11} /> Showing on map
                    </p>
                  )}
                  <div className="mt-4">
                    <Button
                      variant={isSelected ? "primary" : "secondary"}
                      className="w-full"
                      disabled={!online || geo.status === "loading" || zone.isDemo}
                      title={
                        zone.isDemo
                          ? "Demo location — not a real, verified place. Enable location for real navigation."
                          : !online
                            ? "Navigate Now needs an internet connection"
                            : geo.status === "loading"
                              ? "Still finding your location — answer the browser's location prompt, then try again"
                              : "Open real turn-by-turn navigation in Google Maps"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(googleMapsDirectionsUrl(zone.lat, zone.lng, geo.fix?.latitude, geo.fix?.longitude), "_blank", "noopener,noreferrer");
                      }}
                    >
                      <Navigation2 size={14} /> Navigate Now
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {state.selectedStopId && !arrived && (
            <Button className="mt-4 w-full" variant="secondary" onClick={() => dispatch({ type: "arrive" })}>
              Simulate arrival at rest location (Demo)
            </Button>
          )}
        </Card>
      </section>
    </DashboardShell>
  );
}
