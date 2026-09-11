// ---------------------------------------------------------------------------
// Browser Geolocation integration for the Safe Zone Recommendation feature.
// This module is purely additive: it does not touch drowsiness detection,
// vigilance scoring, or the rest-decision engine in smartsense.tsx — it only
// supplies the driver's real-world position to the safe-zone ranking system
// and to Google Maps for turn-by-turn navigation.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

export type GpsStatus = "idle" | "loading" | "granted" | "denied" | "unavailable";

export interface GpsFix {
  latitude: number;
  longitude: number;
  /** km/h, when the browser can report it (usually only while moving outdoors). */
  speedKmh: number | null;
  /** Compass heading in degrees, when available. */
  headingDeg: number | null;
  accuracy: number | null;
  timestamp: number;
}

export interface GeolocationState {
  status: GpsStatus;
  fix: GpsFix | null;
  errorMessage: string | null;
}

function isGeolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * Tracks the driver's current GPS position (latitude, longitude, speed,
 * heading) using the browser Geolocation API. Handles permission-denied,
 * position-unavailable, timeout and "unsupported browser" cases explicitly
 * so calling pages can render an honest status instead of guessing.
 */
export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({ status: "idle", fix: null, errorMessage: null });
  const watchIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const clearActiveWatch = () => {
    if (watchIdRef.current != null && isGeolocationSupported()) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  };

  const start = () => {
    if (!isGeolocationSupported()) {
      setState({ status: "unavailable", fix: null, errorMessage: "Geolocation isn't supported in this browser." });
      return;
    }

    setState((prev) => ({ status: "loading", fix: prev.fix, errorMessage: null }));

    const onSuccess = (pos: GeolocationPosition) => {
      if (!mountedRef.current) return;
      const { latitude, longitude, speed, heading, accuracy } = pos.coords;
      setState({
        status: "granted",
        fix: {
          latitude,
          longitude,
          speedKmh: speed != null && !Number.isNaN(speed) ? Math.max(0, speed * 3.6) : null,
          headingDeg: heading != null && !Number.isNaN(heading) ? heading : null,
          accuracy: accuracy ?? null,
          timestamp: pos.timestamp,
        },
        errorMessage: null,
      });
    };

    const onError = (err: GeolocationPositionError) => {
      if (!mountedRef.current) return;
      if (err.code === err.PERMISSION_DENIED) {
        setState({ status: "denied", fix: null, errorMessage: "Location permission was denied." });
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        setState({ status: "unavailable", fix: null, errorMessage: "Your location couldn't be determined right now." });
      } else {
        setState({ status: "unavailable", fix: null, errorMessage: "Location request timed out." });
      }
    };

    const options: PositionOptions = { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 };
    watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, options);
  };

  useEffect(() => {
    mountedRef.current = true;
    start();
    return () => {
      mountedRef.current = false;
      clearActiveWatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = () => {
    clearActiveWatch();
    start();
  };

  return { ...state, retry };
}

/** Tracks browser online/offline state so features that need the internet (Google Maps) can degrade honestly. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

// ---------------------------------------------------------------------------
// Geo math helpers
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance between two lat/lng points, in kilometers. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** Destination point given a start coordinate, bearing (degrees) and distance (km). Used to place demo safe zones realistically relative to wherever the driver actually is. */
export function destinationPoint(lat: number, lng: number, bearingDeg: number, distanceKm: number): { lat: number; lng: number } {
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lng);

  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 =
    lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));

  return { lat: toDeg(phi2), lng: ((toDeg(lambda2) + 540) % 360) - 180 };
}

/**
 * Builds a Google Maps "Directions" URL. SmartSense only ever hands off the
 * destination (and origin, when known) to Google Maps — SmartSense itself
 * keeps doing drowsiness detection, vigilance scoring, rest decisions and
 * safe-zone ranking; Google Maps only handles the turn-by-turn route.
 */
export function googleMapsDirectionsUrl(destLat: number, destLng: number, originLat?: number | null, originLng?: number | null): string {
  const params = new URLSearchParams();
  params.set("api", "1");
  if (originLat != null && originLng != null) {
    params.set("origin", `${originLat},${originLng}`);
  }
  params.set("destination", `${destLat},${destLng}`);
  params.set("travelmode", "driving");
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
