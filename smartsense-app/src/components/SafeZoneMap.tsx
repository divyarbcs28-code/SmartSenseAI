// ---------------------------------------------------------------------------
// A real, free, embedded map for Rest Management: OpenStreetMap tiles via
// Leaflet (no API key, no billing) with a preview route drawn via the free
// public OSRM demo routing server. This is a preview only — "Navigate Now"
// still hands off to Google Maps for actual turn-by-turn driving guidance;
// SmartSense (this map) only shows where things are and roughly how to get
// there, matching the app's own architecture: SmartSense handles detection,
// ranking and recommendation, Google Maps handles real navigation.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isTop: boolean;
}

interface SafeZoneMapProps {
  driverPosition: { lat: number; lng: number } | null;
  zones: MapZone[];
  routeToZoneId: string | null;
  className?: string;
}

const OSRM_ROUTE_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";

function driverDivIcon() {
  return L.divIcon({
    className: "smartsense-map-marker",
    html: `<span style="display:block;width:16px;height:16px;border-radius:9999px;background:#4f46e5;box-shadow:0 0 0 8px rgba(79,70,229,0.18);border:2px solid #fff;"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function zoneDivIcon(isTop: boolean) {
  const color = isTop ? "#4f46e5" : "#f59e0b";
  return L.divIcon({
    className: "smartsense-map-marker",
    html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:${color};box-shadow:0 0 0 6px ${color}2b;border:2px solid #fff;"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export default function SafeZoneMap({ driverPosition, zones, routeToZoneId, className }: SafeZoneMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  // Round coordinates for the effect's dependency key so tiny GPS jitter
  // from watchPosition doesn't re-fetch a route or redraw markers on every
  // tick — only a real, meaningful move (or a different selected zone) does.
  const driverKey = driverPosition ? `${driverPosition.lat.toFixed(4)},${driverPosition.lng.toFixed(4)}` : "none";
  const zonesKey = useMemo(() => zones.map((z) => `${z.id}:${z.lat.toFixed(4)},${z.lng.toFixed(4)}:${z.isTop ? 1 : 0}`).join("|"), [zones]);

  // Initialize the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initial = driverPosition ?? zones[0] ?? { lat: 20.5937, lng: 78.9629 }; // India-wide fallback view
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView([initial.lat, initial.lng], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw markers/route when the driver position, zone set, or selection changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    layersRef.current.forEach((layer) => map.removeLayer(layer));
    layersRef.current = [];

    const bounds: L.LatLngExpression[] = [];

    if (driverPosition) {
      const marker = L.marker([driverPosition.lat, driverPosition.lng], { icon: driverDivIcon() }).addTo(map).bindTooltip("You", { direction: "top" });
      layersRef.current.push(marker);
      bounds.push([driverPosition.lat, driverPosition.lng]);
    }

    zones.forEach((zone) => {
      const marker = L.marker([zone.lat, zone.lng], { icon: zoneDivIcon(zone.isTop) }).addTo(map).bindTooltip(zone.name, { direction: "top" });
      layersRef.current.push(marker);
      bounds.push([zone.lat, zone.lng]);
    });

    if (bounds.length > 1) {
      map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [36, 36], maxZoom: 15 });
    } else if (bounds.length === 1) {
      map.setView(bounds[0] as L.LatLngExpression, 14);
    }

    let cancelled = false;
    const target = zones.find((z) => z.id === routeToZoneId);
    if (driverPosition && target) {
      (async () => {
        let latlngs: [number, number][] | null = null;
        try {
          const url = `${OSRM_ROUTE_ENDPOINT}/${driverPosition.lng},${driverPosition.lat};${target.lng},${target.lat}?overview=full&geometries=geojson`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            const coords = data?.routes?.[0]?.geometry?.coordinates;
            if (Array.isArray(coords) && coords.length > 1) {
              latlngs = coords.map((c: [number, number]) => [c[1], c[0]]);
            }
          }
        } catch {
          // Free public routing server unreachable/rate-limited — fall back to a straight line below.
        }
        if (cancelled || !mapRef.current) return;
        const isFallbackStraightLine = !latlngs;
        if (!latlngs) {
          latlngs = [
            [driverPosition.lat, driverPosition.lng],
            [target.lat, target.lng],
          ];
        }
        const line = L.polyline(latlngs, {
          color: "#4f46e5",
          weight: 4,
          opacity: 0.85,
          dashArray: isFallbackStraightLine ? "6 8" : undefined,
        }).addTo(mapRef.current);
        layersRef.current.push(line);
      })();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverKey, zonesKey, routeToZoneId]);

  return <div ref={containerRef} className={className} />;
}
