import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { clamp } from "./utils";
import { destinationPoint } from "./geolocation";
import { isSupabaseConfigured, getDbIdentity, startDbSession, endDbSession, type DbStatus } from "./dbSession";
import { armAlarmAudio, startAlarm, stopAlarm, playAlertBeep } from "./alarmSound";

// ---------------------------------------------------------------------------
// Types — mirrors the SmartSense PRR (Predict / Rest / Recover) system
// described in the SIH problem statement and system-design document.
// ---------------------------------------------------------------------------

export type ThemeMode = "light" | "dark" | "system";
export type Language = "en" | "ta" | "hi" | "te" | "ml" | "kn";

export type VigilanceState = "ALERT" | "FATIGUE" | "DROWSINESS" | "SEVERE" | "CRITICAL";
export type Trend = "STABLE" | "IMPROVING" | "DECREASING" | "RAPID_DECREASE";
export type RestDecision = "CONTINUE" | "BREAK_RECOMMENDED" | "REST_NOW" | "STOP_NOW";
export type SleepState = "WAKE" | "NON_N2" | "N2";
export type SafetyStage = "DETECT" | "PREDICT" | "ALERT" | "REST" | "RECOVER" | "RESUME";
export type OperatingMode = "DRIVING" | "REST";
export type SignalStatus = "CONNECTED" | "POOR" | "DISCONNECTED";
export type WakeStatus = "MONITORING" | "SATISFIED" | "FALLBACK_ALARM";
export type AlertSeverity = "info" | "warn" | "danger" | "good";

export interface AlertItem {
  id: string;
  titleKey: string;
  bodyKey: string;
  severity: AlertSeverity;
  timestamp: number;
  read: boolean;
  category: "drowsiness" | "rest" | "device" | "system";
}

export interface RestStop {
  id: string;
  name: string;
  /** Facility type — added for GPS Safe Zone Recommendation, matches SafeZone.type in safeZones.ts. */
  type: string;
  distanceKm: number;
  etaMin: number;
  safety: number;
  distanceScore: number;
  facilitiesScore: number;
  accessibility: number;
  facilities: string[];
  /** Added for GPS Safe Zone Recommendation — lets "Navigate Now" open Google Maps even when the driver's live GPS location isn't available. */
  lat: number;
  lng: number;
}

/** A trip destination picked via free OpenStreetMap search (Nominatim) in Rest Management — see geocoding.ts. */
export interface Destination {
  name: string;
  lat: number;
  lng: number;
}

export interface DriveRecord {
  id: string;
  date: string;
  route: string;
  durationMin: number;
  distanceKm: number;
  avgVigilance: number;
  restBreaks: number;
  outcome: "improved" | "stable" | "watch";
}

/** A warm, time-of-day greeting for the Overview header (kept in English by design — a friendly one-liner, not a translated UI label). */
export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still on the road";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Driving late tonight";
}

/** Plain-language sleep-stage labels for non-technical screens (the raw EEG classifier names — N2, non-N2 — stay in code, not in front of the driver). */
export const sleepStateFriendly: Record<SleepState, string> = {
  WAKE: "Awake",
  NON_N2: "Light sleep",
  N2: "Deep sleep",
};

export const languageNames: Record<Language, string> = {
  en: "English",
  ta: "தமிழ்",
  hi: "हिन्दी",
  te: "తెలుగు",
  ml: "മലയാളം",
  kn: "ಕನ್ನಡ",
};

// ---------------------------------------------------------------------------
// Vigilance / rest-decision helpers (rule-based engine per the SIH spec)
// ---------------------------------------------------------------------------

export function stateFromScore(score: number): VigilanceState {
  if (score >= 80) return "ALERT";
  if (score >= 60) return "FATIGUE";
  if (score >= 40) return "DROWSINESS";
  if (score >= 20) return "SEVERE";
  return "CRITICAL";
}

const restDecisionOrder: RestDecision[] = ["CONTINUE", "BREAK_RECOMMENDED", "REST_NOW", "STOP_NOW"];

/** Rest Decision Engine — combines score, trend, continuous driving time and (when a Trip Planner
 * "arrive by" deadline is set) how much slack is left to fit a rest stop in and still make it.
 * Deadline pressure only ever escalates the decision toward resting sooner, never the reverse, and
 * never escalates past REST_NOW on its own — STOP_NOW stays reserved for genuinely critical
 * vigilance, never a calendar deadline. Waiting to rest only shrinks the remaining slack further, so
 * the earlier nudge is itself the safer choice, not a compromise on rest quality. */
export function decisionFromState(
  score: number,
  trend: Trend,
  continuousMin: number,
  slackMinutes: number | null = null,
): RestDecision {
  let decision: RestDecision;
  if (score <= 19) decision = "STOP_NOW";
  else if (score <= 39) decision = "REST_NOW";
  else if (score <= 59) decision = "BREAK_RECOMMENDED";
  else if (trend === "RAPID_DECREASE" && continuousMin > 90) decision = "BREAK_RECOMMENDED";
  else if (continuousMin >= 150) decision = "BREAK_RECOMMENDED";
  else decision = "CONTINUE";

  if (slackMinutes != null && slackMinutes < 30) {
    const idx = restDecisionOrder.indexOf(decision);
    if (idx < 2) decision = restDecisionOrder[idx + 1];
  }
  return decision;
}

/** N2/Non-N2/Wake threshold applied to the built-in random-walk simulation's n2Probability. */
function sleepStageFromN2Probability(n2Probability: number): SleepState {
  return n2Probability > 0.65 ? "N2" : n2Probability > 0.3 ? "NON_N2" : "WAKE";
}

/** Parses a "HH:MM" clock time (Trip Planner's "arrive by") as the next upcoming occurrence of that
 * time — today, or tomorrow if that time has clearly already passed. Shared by the Rest Decision
 * Engine's deadline-awareness and Sleep/Recovery's tight-deadline warning banner. */
export function nextOccurrenceOf(hhmm: string): Date | null {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() < Date.now() - 5 * 60000) d.setDate(d.getDate() + 1);
  return d;
}

/** Minutes of slack between now and the driver's "arrive by" deadline, after subtracting the
 * remaining drive time (last-known from Trip Planner/OSRM) and a rough estimate of how long a rest
 * stop would take, based on how much recovery the current vigilance score needs. Returns null
 * whenever no destination/deadline/trip duration is set — deadline pressure only ever applies once a
 * real trip is actually planned, never as a guess. */
export function slackMinutesToDeadline(state: SmartSenseState): number | null {
  if (!state.destination || !state.arriveByTime || state.tripDurationMin == null) return null;
  const deadline = nextOccurrenceOf(state.arriveByTime);
  if (!deadline) return null;
  const minutesUntilDeadline = (deadline.getTime() - Date.now()) / 60000;
  const scoreNeeded = Math.max(0, 80 - state.vigilanceScore);
  const estimatedRestMinutes = scoreNeeded > 0 ? Math.max(20, scoreNeeded) : 0;
  return minutesUntilDeadline - state.tripDurationMin - estimatedRestMinutes;
}

/** Representative vigilance score for each of the 5 drowsiness stages — used by the Settings "Demo
 * controls" stage picker to actually drive real app state (score, trend, rest decision, alerts),
 * not just relabel something. Each value sits safely inside stateFromScore's band for that stage. */
export const vigilanceScoreForStage: Record<VigilanceState, number> = {
  ALERT: 90,
  FATIGUE: 70,
  DROWSINESS: 50,
  SEVERE: 25,
  CRITICAL: 10,
};

export function trendFromDelta(delta: number): Trend {
  if (delta <= -6) return "RAPID_DECREASE";
  if (delta <= -1.5) return "DECREASING";
  if (delta >= 1.5) return "IMPROVING";
  return "STABLE";
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface SmartSenseState {
  operatingMode: OperatingMode;
  safetyStage: SafetyStage;

  vigilanceScore: number;
  vigilanceState: VigilanceState;
  vigilanceHistory: number[];
  trend: Trend;
  restDecision: RestDecision;

  drivingMinutesToday: number;
  continuousDrivingMinutes: number;
  distanceKm: number;
  lastRestMinutesAgo: number;
  previousRestDuration: number;
  recoveryScore: number;

  eegStatus: SignalStatus;
  eogStatus: SignalStatus;
  eegQuality: number;
  eogQuality: number;
  wearableBattery: number;
  dataSource: "SIMULATION" | "LIVE";

  sleepState: SleepState;
  n2Probability: number;
  consecutiveN2Epochs: number;
  wakeWindowStart: string;
  wakeWindowEnd: string;
  wakeStatus: WakeStatus;
  restSessionMinutes: number;
  recoveryBefore: number;
  recoveryAfter: number;

  navigationProgress: number;
  selectedStopId: string | null;

  /** Trip planning (Rest Management) — a real destination picked via free OSM search, an optional
   * "arrive by" preference, and the driving distance/duration to it (captured when the route was
   * last planned) so the wake window can warn about a tight deadline without ever cutting rest short. */
  destination: Destination | null;
  arriveByTime: string | null;
  tripDistanceKm: number | null;
  tripDurationMin: number | null;

  alerts: AlertItem[];
  history: DriveRecord[];

  autoSimulate: boolean;
}

type Action =
  | { type: "tick" }
  | { type: "setVigilance"; score: number }
  | { type: "setTrend"; trend: Trend }
  | { type: "setRestDecision"; decision: RestDecision }
  | { type: "setSleepState"; state: SleepState }
  | { type: "setWakeStatus"; status: WakeStatus }
  | { type: "setStage"; stage: SafetyStage }
  | { type: "toggleAutoSimulate" }
  | { type: "setDataSource"; source: "SIMULATION" | "LIVE" }
  | { type: "startNavigation"; stopId: string }
  | { type: "arrive" }
  | { type: "wakeUp" }
  | { type: "resume" }
  | { type: "markAlertRead"; id: string }
  | { type: "markAllAlertsRead" }
  | { type: "dismissAlert"; id: string }
  | { type: "setDestination"; destination: Destination; tripDistanceKm?: number | null; tripDurationMin?: number | null }
  | { type: "clearDestination" }
  | { type: "setArriveByTime"; time: string | null }
  | { type: "setDemoVigilanceStage"; stage: VigilanceState };

// Fixed demo origin (Chennai, on the NH 44 corridor referenced elsewhere in this page) used only as
// the anchor for the static fallback stops below — the ones shown when the driver's live GPS location
// isn't available (denied / unavailable / not yet granted). Real navigation always uses the driver's
// actual current position when it's known; see RestManagement.tsx and safeZones.ts for the live path.
const FALLBACK_ORIGIN = { lat: 13.0827, lng: 80.2707 };

function fallbackStopCoords(bearingDeg: number, distanceKm: number) {
  return destinationPoint(FALLBACK_ORIGIN.lat, FALLBACK_ORIGIN.lng, bearingDeg, distanceKm);
}

export const restStops: RestStop[] = [
  { id: "a", name: "Highway Safe Rest Area", type: "Rest Area", distanceKm: 2.1, etaMin: 4, safety: 96, distanceScore: 94, facilitiesScore: 78, accessibility: 90, facilities: ["Parking", "Restroom", "Food"], ...fallbackStopCoords(158, 2.1) },
  { id: "b", name: "NH Rest Stop 44", type: "Highway Plaza", distanceKm: 7.8, etaMin: 12, safety: 88, distanceScore: 74, facilitiesScore: 92, accessibility: 82, facilities: ["Fuel", "Food", "Lighting"], ...fallbackStopCoords(165, 7.8) },
  { id: "c", name: "Fuel & Rest Plaza", type: "Fuel Station", distanceKm: 12.4, etaMin: 18, safety: 80, distanceScore: 60, facilitiesScore: 70, accessibility: 76, facilities: ["Fuel", "Parking"], ...fallbackStopCoords(172, 12.4) },
];

export function restSuitabilityScore(stop: RestStop) {
  return Math.round(
    stop.safety * 0.4 + stop.distanceScore * 0.25 + stop.facilitiesScore * 0.2 + stop.accessibility * 0.15,
  );
}

const demoHistory: DriveRecord[] = [
  { id: "h1", date: "Today", route: "Chennai → Madurai", durationMin: 138, distanceKm: 86, avgVigilance: 72, restBreaks: 1, outcome: "watch" },
  { id: "h2", date: "Yesterday", route: "Bengaluru → Salem", durationMin: 222, distanceKm: 218, avgVigilance: 78, restBreaks: 2, outcome: "improved" },
  { id: "h3", date: "2 days ago", route: "Madurai → Trichy", durationMin: 114, distanceKm: 132, avgVigilance: 84, restBreaks: 1, outcome: "stable" },
  { id: "h4", date: "4 days ago", route: "Trichy → Coimbatore", durationMin: 156, distanceKm: 165, avgVigilance: 69, restBreaks: 2, outcome: "watch" },
  { id: "h5", date: "6 days ago", route: "Coimbatore → Madurai", durationMin: 98, distanceKm: 112, avgVigilance: 88, restBreaks: 0, outcome: "improved" },
];

export const initialState: SmartSenseState = {
  operatingMode: "DRIVING",
  safetyStage: "PREDICT",

  vigilanceScore: 74,
  vigilanceState: "FATIGUE",
  vigilanceHistory: [92, 90, 87, 84, 82, 78, 76, 74],
  trend: "DECREASING",
  restDecision: "CONTINUE",

  drivingMinutesToday: 138,
  continuousDrivingMinutes: 82,
  distanceKm: 86,
  lastRestMinutesAgo: 130,
  previousRestDuration: 18,
  recoveryScore: 82,

  eegStatus: "CONNECTED",
  eogStatus: "CONNECTED",
  eegQuality: 92,
  eogQuality: 88,
  wearableBattery: 74,
  dataSource: "SIMULATION",

  sleepState: "N2",
  n2Probability: 0.81,
  consecutiveN2Epochs: 3,
  wakeWindowStart: "06:30",
  wakeWindowEnd: "07:00",
  wakeStatus: "MONITORING",
  restSessionMinutes: 18,
  recoveryBefore: 55,
  recoveryAfter: 82,

  navigationProgress: 0,
  selectedStopId: null,

  destination: null,
  arriveByTime: null,
  tripDistanceKm: null,
  tripDurationMin: null,

  alerts: [
    { id: "al1", titleKey: "alertFatigueTitle", bodyKey: "alertFatigueBody", severity: "warn", timestamp: Date.now() - 1000 * 60 * 6, read: false, category: "drowsiness" },
    { id: "al2", titleKey: "alertRestFoundTitle", bodyKey: "alertRestFoundBody", severity: "good", timestamp: Date.now() - 1000 * 60 * 40, read: true, category: "rest" },
    { id: "al3", titleKey: "alertDeviceTitle", bodyKey: "alertDeviceBody", severity: "info", timestamp: Date.now() - 1000 * 60 * 95, read: true, category: "device" },
  ],
  history: demoHistory,

  autoSimulate: true,
};

let alertCounter = 100;

function pushAlert(state: SmartSenseState, alert: Omit<AlertItem, "id" | "timestamp" | "read">): AlertItem[] {
  alertCounter += 1;
  const next: AlertItem = { ...alert, id: `al-${alertCounter}`, timestamp: Date.now(), read: false };
  return [next, ...state.alerts].slice(0, 30);
}

export function reduceState(state: SmartSenseState, action: Action): SmartSenseState {
  switch (action.type) {
    case "tick": {
      if (!state.autoSimulate) return state;
      // While resting, vigilance actually recovers over time instead of sitting frozen — the rate
      // depends on how deep the sleep stage was during the minute that just passed (N2/"Deep sleep"
      // recovers fastest, light sleep slower, still-settling-in barely at all). This is what makes
      // the Sleep/Recovery "recovery comparison" and wake window genuinely computed instead of static.
      const restRecoveryGain = state.operatingMode === "REST" ? (state.sleepState === "N2" ? 2 : state.sleepState === "NON_N2" ? 1 : 0) : 0;
      const drift = state.operatingMode === "REST" ? restRecoveryGain : (Math.random() - 0.46) * 5;
      const score =
        state.operatingMode === "REST"
          ? clamp(state.vigilanceScore + drift, 0, 100)
          : clamp(Math.round(state.vigilanceScore + drift), 4, 100);
      const trend = trendFromDelta(score - state.vigilanceScore);
      const vigilanceState = stateFromScore(score);
      const continuousDrivingMinutes = state.operatingMode === "DRIVING" ? state.continuousDrivingMinutes + 1 : state.continuousDrivingMinutes;
      const drivingMinutesToday = state.operatingMode === "DRIVING" ? state.drivingMinutesToday + 1 : state.drivingMinutesToday;
      const restDecision = state.operatingMode === "DRIVING" ? decisionFromState(score, trend, continuousDrivingMinutes, slackMinutesToDeadline(state)) : state.restDecision;
      const history = [...state.vigilanceHistory.slice(-23), score];
      let alerts = state.alerts;
      let safetyStage = state.safetyStage;
      if (state.operatingMode === "DRIVING" && state.vigilanceState !== "CRITICAL" && vigilanceState === "CRITICAL") {
        alerts = pushAlert(state, { titleKey: "alertCriticalTitle", bodyKey: "alertCriticalBody", severity: "danger", category: "drowsiness" });
        safetyStage = "ALERT";
      } else if (state.operatingMode === "DRIVING" && state.vigilanceState !== "SEVERE" && vigilanceState === "SEVERE") {
        alerts = pushAlert(state, { titleKey: "alertSevereTitle", bodyKey: "alertSevereBody", severity: "warn", category: "drowsiness" });
        safetyStage = "ALERT";
      } else if (state.operatingMode === "DRIVING" && restDecision !== "CONTINUE" && state.restDecision === "CONTINUE") {
        alerts = pushAlert(state, { titleKey: "alertFatigueTitle", bodyKey: "alertFatigueBody", severity: "warn", category: "drowsiness" });
      } else if (score >= 80 && state.safetyStage === "ALERT") {
        safetyStage = "PREDICT";
      }
      let n2Probability = state.n2Probability;
      let consecutiveN2Epochs = state.consecutiveN2Epochs;
      let sleepState = state.sleepState;
      let wakeStatus = state.wakeStatus;
      let restSessionMinutes = state.restSessionMinutes;
      let wakeWindowStart = state.wakeWindowStart;
      let wakeWindowEnd = state.wakeWindowEnd;
      let recoveryAfter = state.recoveryAfter;
      if (state.operatingMode === "REST") {
        restSessionMinutes += 1;
        n2Probability = clamp(state.n2Probability + (Math.random() - 0.35) * 0.08, 0.05, 0.98);
        sleepState = sleepStageFromN2Probability(n2Probability);
        consecutiveN2Epochs = sleepState === "N2" ? Math.min(6, state.consecutiveN2Epochs + 1) : 0;
        recoveryAfter = Math.round(score);
        if (consecutiveN2Epochs >= 3 && wakeStatus === "MONITORING" && restSessionMinutes > 12) {
          wakeStatus = "SATISFIED";
          alerts = pushAlert(state, { titleKey: "alertWakeReadyTitle", bodyKey: "alertWakeReadyBody", severity: "good", category: "rest" });
        }
        // Wake window recommendation — based on vigilance score (how much recovery is still
        // needed to reach a safe "Alert" level) and the current recovery rate (this sleep stage's
        // gain per minute). Recomputed live every tick; never shortened just because a deadline is
        // tight — see arriveByTime/tripDurationMin, which only ever produce a warning, not a shorter window.
        const scoreNeeded = Math.max(0, 80 - score);
        const gainRatePerMin = sleepState === "N2" ? 2 : sleepState === "NON_N2" ? 1 : 0.3;
        const minutesToReady = wakeStatus === "SATISFIED" ? 0 : Math.max(1, Math.ceil(scoreNeeded / gainRatePerMin));
        const windowStartDate = new Date(Date.now() + minutesToReady * 60000);
        const windowEndDate = new Date(windowStartDate.getTime() + 30 * 60000);
        const fmtClock = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
        wakeWindowStart = fmtClock(windowStartDate);
        wakeWindowEnd = fmtClock(windowEndDate);
      }
      return {
        ...state,
        vigilanceScore: score,
        vigilanceState,
        vigilanceHistory: history,
        trend,
        restDecision,
        continuousDrivingMinutes,
        drivingMinutesToday,
        alerts,
        safetyStage,
        n2Probability,
        consecutiveN2Epochs,
        sleepState,
        wakeStatus,
        restSessionMinutes,
        wakeWindowStart,
        wakeWindowEnd,
        recoveryAfter,
      };
    }
    case "setVigilance": {
      const score = clamp(action.score, 0, 100);
      const vigilanceState = stateFromScore(score);
      const trend = trendFromDelta(score - state.vigilanceScore);
      return {
        ...state,
        vigilanceScore: score,
        vigilanceState,
        trend,
        restDecision: decisionFromState(score, trend, state.continuousDrivingMinutes, slackMinutesToDeadline(state)),
        vigilanceHistory: [...state.vigilanceHistory.slice(-23), score],
      };
    }
    case "setTrend":
      return { ...state, trend: action.trend };
    case "setRestDecision":
      return { ...state, restDecision: action.decision };
    case "setSleepState": {
      const n2Probability = action.state === "N2" ? 0.82 : action.state === "NON_N2" ? 0.4 : 0.12;
      return { ...state, sleepState: action.state, n2Probability, consecutiveN2Epochs: action.state === "N2" ? 3 : 0 };
    }
    case "setWakeStatus":
      return { ...state, wakeStatus: action.status };
    case "setStage":
      return { ...state, safetyStage: action.stage, operatingMode: action.stage === "REST" || action.stage === "RECOVER" ? "REST" : "DRIVING" };
    case "toggleAutoSimulate":
      return { ...state, autoSimulate: !state.autoSimulate };
    case "setDataSource": {
      if (action.source === "LIVE") {
        // No real wearable integration in this build — be honest about it rather than
        // faking "live" numbers from the simulator.
        return { ...state, dataSource: "LIVE", autoSimulate: false, eegStatus: "DISCONNECTED", eogStatus: "DISCONNECTED", eegQuality: 0, eogQuality: 0 };
      }
      return { ...state, dataSource: "SIMULATION", autoSimulate: true, eegStatus: "CONNECTED", eogStatus: "CONNECTED", eegQuality: 92, eogQuality: 88 };
    }
    case "startNavigation":
      return { ...state, selectedStopId: action.stopId, navigationProgress: 8, safetyStage: "REST" };
    case "arrive":
      // Snapshot the real vigilance score right at arrival as "before" — "after" starts at the same
      // value and climbs live during the rest session (see the tick REST branch), so the Recovery
      // comparison on Sleep/Recovery reflects this actual session instead of fixed demo numbers.
      return {
        ...state,
        operatingMode: "REST",
        safetyStage: "REST",
        navigationProgress: 100,
        restSessionMinutes: 0,
        sleepState: "WAKE",
        consecutiveN2Epochs: 0,
        wakeStatus: "MONITORING",
        recoveryBefore: state.vigilanceScore,
        recoveryAfter: state.vigilanceScore,
      };
    case "wakeUp":
      return { ...state, wakeStatus: "SATISFIED", safetyStage: "RECOVER" };
    case "resume":
      return {
        ...state,
        operatingMode: "DRIVING",
        safetyStage: "RESUME",
        vigilanceScore: Math.max(state.vigilanceScore, state.recoveryAfter),
        vigilanceState: "ALERT",
        trend: "IMPROVING",
        restDecision: "CONTINUE",
        continuousDrivingMinutes: 0,
        lastRestMinutesAgo: 0,
        previousRestDuration: state.restSessionMinutes,
        navigationProgress: 0,
      };
    case "markAlertRead":
      return { ...state, alerts: state.alerts.map((a) => (a.id === action.id ? { ...a, read: true } : a)) };
    case "markAllAlertsRead":
      return { ...state, alerts: state.alerts.map((a) => ({ ...a, read: true })) };
    case "dismissAlert":
      return { ...state, alerts: state.alerts.filter((a) => a.id !== action.id) };
    case "setDestination":
      return {
        ...state,
        destination: action.destination,
        tripDistanceKm: action.tripDistanceKm ?? null,
        tripDurationMin: action.tripDurationMin ?? null,
      };
    case "clearDestination":
      return { ...state, destination: null, tripDistanceKm: null, tripDurationMin: null };
    case "setArriveByTime":
      return { ...state, arriveByTime: action.time };
    case "setDemoVigilanceStage": {
      // Settings → Demo controls: manually jump to one of the 5 drowsiness stages. Reuses the exact
      // same scoring/decision math as a real reading (stateFromScore/decisionFromState) and pushes
      // the matching alert, so this is a real state change for demo purposes, not a cosmetic label swap.
      const score = vigilanceScoreForStage[action.stage];
      const vigilanceState = action.stage;
      const trend = trendFromDelta(score - state.vigilanceScore);
      const restDecision = decisionFromState(score, trend, state.continuousDrivingMinutes, slackMinutesToDeadline(state));
      let alerts = state.alerts;
      let safetyStage = state.safetyStage;
      if (state.vigilanceState !== "CRITICAL" && vigilanceState === "CRITICAL") {
        alerts = pushAlert(state, { titleKey: "alertCriticalTitle", bodyKey: "alertCriticalBody", severity: "danger", category: "drowsiness" });
        safetyStage = "ALERT";
      } else if (state.vigilanceState !== "SEVERE" && vigilanceState === "SEVERE") {
        alerts = pushAlert(state, { titleKey: "alertSevereTitle", bodyKey: "alertSevereBody", severity: "warn", category: "drowsiness" });
        safetyStage = "ALERT";
      } else if (state.vigilanceState !== "DROWSINESS" && vigilanceState === "DROWSINESS") {
        alerts = pushAlert(state, { titleKey: "alertDrowsinessTitle", bodyKey: "alertDrowsinessBody", severity: "warn", category: "drowsiness" });
        safetyStage = "ALERT";
      } else if (state.vigilanceState !== "FATIGUE" && vigilanceState === "FATIGUE") {
        alerts = pushAlert(state, { titleKey: "alertFatigueTitle", bodyKey: "alertFatigueBody", severity: "warn", category: "drowsiness" });
      } else if (vigilanceState === "ALERT" && state.vigilanceState !== "ALERT") {
        alerts = pushAlert(state, { titleKey: "alertAlertTitle", bodyKey: "alertAlertBody", severity: "good", category: "drowsiness" });
        safetyStage = "PREDICT";
      }
      return {
        ...state,
        vigilanceScore: score,
        vigilanceState,
        trend,
        restDecision,
        vigilanceHistory: [...state.vigilanceHistory.slice(-23), score],
        alerts,
        safetyStage,
      };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// i18n — English is primary; Tamil / Hindi / Telugu / Malayalam / Kannada
// cover the main navigation, dashboard titles, states, and key actions.
// Technical signal names (EEG/EOG/N2 etc.) are intentionally left unchanged.
// ---------------------------------------------------------------------------

type Dict = Record<string, string>;

const en: Dict = {
  appName: "SmartSense", tagline: "Predict. Rest. Recover.",
  overview: "Overview", liveMonitor: "Live Monitor", drowsiness: "Drowsiness", restManagement: "Rest Management", tripPlanner: "Trip Planner",
  alerts: "Alerts", history: "History", sleepRecovery: "Sleep / Recovery", reports: "Reports", settings: "Settings",
  monitoringGroup: "Monitoring", restRecoveryGroup: "Rest & Recovery", insightsGroup: "Insights", systemGroup: "System",
  drivingMode: "Driving Mode", restMode: "Rest Mode",
  alert: "Alert", fatigue: "Fatigue", drowsy: "Drowsy", severe: "Severe", critical: "Critical",
  stable: "Stable", improving: "Improving", decreasing: "Gradually decreasing", rapidDecrease: "Rapidly decreasing",
  continueDriving: "Continue driving", breakRecommended: "Break recommended", restNow: "Rest now", stopNow: "Stop now",
  safeToContinue: "Safe to continue",
  currentVigilance: "Current Vigilance", vigilanceScore: "Vigilance Score", drowsinessScore: "Drowsiness Score",
  fatigueTrend: "Fatigue Trend", drivingDuration: "Driving Duration", continuousDriving: "Continuous Driving",
  restStatus: "Rest Status", latestAlert: "Latest Alert", deviceStatus: "Device Status", todaySummary: "Today's Summary",
  quickActions: "Quick Actions", recoveryStatus: "Recovery Status",
  openLiveMonitor: "Open Live Monitor", findRestLocation: "Find Safe Rest Location", navigate: "Navigate",
  resumeDriving: "Resume Driving", wakeUp: "Wake up", simulateCondition: "Simulate condition",
  signalStatus: "Signal Status", signalQuality: "Signal Quality", monitoringStatus: "Monitoring Status",
  wearableConnection: "Wearable Connection", demoMode: "Demo / Simulation Mode", simulation: "Simulation", live: "Live",
  connected: "Connected", disconnected: "Disconnected", poor: "Poor",
  eegBrain: "EEG — Brain Activity", eogEye: "EOG — Eye & Blink Activity",
  restReason: "Rest Recommendation Reason", restHistory: "Rest History", restSuitability: "Rest Suitability",
  safety: "Safety", distance: "Distance", facilities: "Facilities", accessibility: "Accessibility",
  severityDist: "Severity Distribution", detectionEvents: "Detection Events", timeline: "Timeline",
  today: "Today", thisWeek: "This Week", export: "Export", download: "Download",
  sleepDuration: "Sleep Duration", recoveryBefore: "Before Rest", recoveryAfter: "After Rest", n2Probability: "N2 Probability",
  wakeWindow: "Wake Window", smartWake: "Smart Wake", sleepState: "Sleep State", stability: "Stability",
  profile: "Profile", device: "Device", notifications: "Notifications", language: "Language", appearance: "Appearance",
  privacy: "Privacy", about: "About", theme: "Theme", light: "Light", dark: "Dark", automatic: "Automatic",
  save: "Save", cancel: "Cancel", markAllRead: "Mark all read", dismiss: "Dismiss", readMore: "View details",
  prototypeNote: "Engineering prototype indicator — not a medical measurement.",
  alertAlertTitle: "Fully alert", alertAlertBody: "Vigilance is back to a safe level.",
  alertFatigueTitle: "Fatigue increasing", alertFatigueBody: "Vigilance is gradually decreasing — consider a break soon.",
  alertDrowsinessTitle: "Drowsiness detected", alertDrowsinessBody: "Vigilance has dropped further — a rest stop is recommended soon.",
  alertSevereTitle: "Severe drowsiness detected", alertSevereBody: "Strong warning — please plan a rest stop.",
  alertCriticalTitle: "Critical drowsiness detected", alertCriticalBody: "Please stop at a safe location immediately.",
  alertRestFoundTitle: "Rest location found", alertRestFoundBody: "A suitable rest location is available nearby.",
  alertDeviceTitle: "Wearable connected", alertDeviceBody: "EEG and EOG signal quality is good.",
  alertWakeReadyTitle: "Smart wake ready", alertWakeReadyBody: "A stable N2 window was detected — you may wake up.",
  welcome: "Welcome to SmartSense", getStarted: "Get started", dashboard: "Dashboard",
};

const ta: Dict = {
  appName: "SmartSense", tagline: "கணிக்கவும். ஓய்வெடுக்கவும். மீளவும்.",
  overview: "மேலோட்டம்", liveMonitor: "நேரடி கண்காணிப்பு", drowsiness: "தூக்கக் கண்காணிப்பு", restManagement: "ஓய்வு மேலாண்மை", tripPlanner: "பயண திட்டமிடல்",
  alerts: "எச்சரிக்கைகள்", history: "வரலாறு", sleepRecovery: "தூக்கம் / மீட்பு", reports: "அறிக்கைகள்", settings: "அமைப்புகள்",
  monitoringGroup: "கண்காணிப்பு", restRecoveryGroup: "ஓய்வு & மீட்பு", insightsGroup: "நுண்ணறிவுகள்", systemGroup: "அமைப்பு",
  drivingMode: "ஓட்டுநர் நிலை", restMode: "ஓய்வு நிலை",
  alert: "விழிப்பு", fatigue: "சோர்வு", drowsy: "தூக்கம்", severe: "கடுமையானது", critical: "ஆபத்தானது",
  stable: "நிலையானது", improving: "மேம்படுகிறது", decreasing: "படிப்படியாக குறைகிறது", rapidDecrease: "வேகமாக குறைகிறது",
  continueDriving: "தொடர்ந்து ஓட்டுக", breakRecommended: "ஓய்வு பரிந்துரை", restNow: "இப்போது ஓய்வெடுக்கவும்", stopNow: "இப்போது நிறுத்துக",
  safeToContinue: "தொடரலாம்",
  currentVigilance: "தற்போதைய விழிப்புணர்வு", vigilanceScore: "விழிப்பு மதிப்பெண்", drowsinessScore: "தூக்க மதிப்பெண்",
  fatigueTrend: "சோர்வு போக்கு", drivingDuration: "ஓட்டும் கால அளவு", continuousDriving: "தொடர்ச்சியான ஓட்டுதல்",
  restStatus: "ஓய்வு நிலை", latestAlert: "சமீபத்திய எச்சரிக்கை", deviceStatus: "சாதன நிலை", todaySummary: "இன்றைய சுருக்கம்",
  quickActions: "விரைவு செயல்கள்", recoveryStatus: "மீட்பு நிலை",
  openLiveMonitor: "நேரடி கண்காணிப்பைத் திற", findRestLocation: "பாதுகாப்பான ஓய்வு இடம்", navigate: "வழிசெலுத்து",
  resumeDriving: "மீண்டும் ஓட்டுக", wakeUp: "எழுந்திரு", simulateCondition: "சோதனை நிலை",
  signalStatus: "சிக்னல் நிலை", signalQuality: "சிக்னல் தரம்", monitoringStatus: "கண்காணிப்பு நிலை",
  wearableConnection: "அணியக்கூடிய சாதன இணைப்பு", demoMode: "செயற்கை தரவு முறை", simulation: "செயற்கை", live: "நேரடி",
  connected: "இணைக்கப்பட்டது", disconnected: "துண்டிக்கப்பட்டது", poor: "மோசமானது",
  eegBrain: "EEG — மூளை செயல்பாடு", eogEye: "EOG — கண் & இமை செயல்பாடு",
  restReason: "ஓய்வு பரிந்துரைக்கான காரணம்", restHistory: "ஓய்வு வரலாறு", restSuitability: "ஓய்வு பொருத்தம்",
  safety: "பாதுகாப்பு", distance: "தூரம்", facilities: "வசதிகள்", accessibility: "அணுகல்",
  severityDist: "தீவிரத் தன்மை பரவல்", detectionEvents: "கண்டறிதல் நிகழ்வுகள்", timeline: "காலவரிசை",
  today: "இன்று", thisWeek: "இந்த வாரம்", export: "ஏற்றுமதி", download: "பதிவிறக்கு",
  sleepDuration: "தூக்க கால அளவு", recoveryBefore: "ஓய்வுக்கு முன்", recoveryAfter: "ஓய்வுக்குப் பின்", n2Probability: "N2 நிகழ்தகவு",
  wakeWindow: "விழிப்பு காலப்பகுதி", smartWake: "ஸ்மார்ட் விழிப்பு", sleepState: "தூக்க நிலை", stability: "நிலைத்தன்மை",
  profile: "சுயவிவரம்", device: "சாதனம்", notifications: "அறிவிப்புகள்", language: "மொழி", appearance: "தோற்றம்",
  privacy: "தனியுரிமை", about: "பற்றி", theme: "தீம்", light: "வெளிச்சம்", dark: "இருள்", automatic: "தானியங்கி",
  save: "சேமி", cancel: "ரத்து செய்", markAllRead: "அனைத்தையும் படித்ததாகக் குறி", dismiss: "நிராகரி", readMore: "விவரங்களைக் காண்க",
  prototypeNote: "இது ஒரு பொறியியல் முன்மாதிரி குறியீடு — மருத்துவ அளவீடு அல்ல.",
  alertAlertTitle: "முழு விழிப்புணர்வு", alertAlertBody: "விழிப்புணர்வு பாதுகாப்பான நிலைக்குத் திரும்பியுள்ளது.",
  alertFatigueTitle: "சோர்வு அதிகரிக்கிறது", alertFatigueBody: "விழிப்புணர்வு படிப்படியாக குறைகிறது — விரைவில் ஓய்வு எடுக்கவும்.",
  alertDrowsinessTitle: "தூக்கம் கண்டறியப்பட்டது", alertDrowsinessBody: "விழிப்புணர்வு மேலும் குறைந்துள்ளது — விரைவில் ஓய்வு இடத்தைத் திட்டமிடவும்.",
  alertSevereTitle: "கடுமையான தூக்கம் கண்டறியப்பட்டது", alertSevereBody: "வலுவான எச்சரிக்கை — ஓய்வு இடத்தைத் திட்டமிடவும்.",
  alertCriticalTitle: "ஆபத்தான தூக்கம் கண்டறியப்பட்டது", alertCriticalBody: "தயவுசெய்து உடனடியாக பாதுகாப்பான இடத்தில் நிறுத்துங்கள்.",
  alertRestFoundTitle: "ஓய்வு இடம் கிடைத்தது", alertRestFoundBody: "அருகில் ஒரு பொருத்தமான ஓய்வு இடம் உள்ளது.",
  alertDeviceTitle: "சாதனம் இணைக்கப்பட்டது", alertDeviceBody: "EEG மற்றும் EOG சிக்னல் தரம் நன்றாக உள்ளது.",
  alertWakeReadyTitle: "ஸ்மார்ட் விழிப்பு தயார்", alertWakeReadyBody: "நிலையான N2 காலப்பகுதி கண்டறியப்பட்டது — நீங்கள் எழுந்திருக்கலாம்.",
  welcome: "SmartSense-க்கு வரவேற்கிறோம்", getStarted: "தொடங்குங்கள்", dashboard: "டாஷ்போர்டு",
};

const hi: Dict = {
  appName: "SmartSense", tagline: "पूर्वानुमान करें। आराम करें। रिकवर करें।",
  overview: "अवलोकन", liveMonitor: "लाइव मॉनिटर", drowsiness: "ऊंघ निगरानी", restManagement: "आराम प्रबंधन", tripPlanner: "यात्रा योजना",
  alerts: "चेतावनियाँ", history: "इतिहास", sleepRecovery: "नींद / रिकवरी", reports: "रिपोर्ट", settings: "सेटिंग्स",
  monitoringGroup: "निगरानी", restRecoveryGroup: "आराम और रिकवरी", insightsGroup: "अंतर्दृष्टि", systemGroup: "सिस्टम",
  drivingMode: "ड्राइविंग मोड", restMode: "आराम मोड",
  alert: "सतर्क", fatigue: "थकान", drowsy: "ऊंघ", severe: "गंभीर", critical: "अति गंभीर",
  stable: "स्थिर", improving: "सुधर रहा है", decreasing: "धीरे-धीरे घट रहा है", rapidDecrease: "तेज़ी से घट रहा है",
  continueDriving: "ड्राइविंग जारी रखें", breakRecommended: "ब्रेक की सलाह", restNow: "अभी आराम करें", stopNow: "अभी रुकें",
  safeToContinue: "जारी रखना सुरक्षित है",
  currentVigilance: "वर्तमान सतर्कता", vigilanceScore: "सतर्कता स्कोर", drowsinessScore: "ऊंघ स्कोर",
  fatigueTrend: "थकान की प्रवृत्ति", drivingDuration: "ड्राइविंग अवधि", continuousDriving: "लगातार ड्राइविंग",
  restStatus: "आराम स्थिति", latestAlert: "नवीनतम चेतावनी", deviceStatus: "डिवाइस स्थिति", todaySummary: "आज का सारांश",
  quickActions: "त्वरित कार्य", recoveryStatus: "रिकवरी स्थिति",
  openLiveMonitor: "लाइव मॉनिटर खोलें", findRestLocation: "सुरक्षित आराम स्थान खोजें", navigate: "नेविगेट करें",
  resumeDriving: "ड्राइविंग फिर से शुरू करें", wakeUp: "जागें", simulateCondition: "स्थिति सिमुलेट करें",
  signalStatus: "सिग्नल स्थिति", signalQuality: "सिग्नल गुणवत्ता", monitoringStatus: "निगरानी स्थिति",
  wearableConnection: "वियरेबल कनेक्शन", demoMode: "सिमुलेशन मोड", simulation: "सिमुलेशन", live: "लाइव",
  connected: "जुड़ा हुआ", disconnected: "डिस्कनेक्ट", poor: "खराब",
  eegBrain: "EEG — मस्तिष्क गतिविधि", eogEye: "EOG — आँख व पलक गतिविधि",
  restReason: "आराम सुझाव का कारण", restHistory: "आराम इतिहास", restSuitability: "आराम उपयुक्तता",
  safety: "सुरक्षा", distance: "दूरी", facilities: "सुविधाएं", accessibility: "सुगमता",
  severityDist: "गंभीरता वितरण", detectionEvents: "पहचान घटनाएँ", timeline: "समयरेखा",
  today: "आज", thisWeek: "इस सप्ताह", export: "निर्यात", download: "डाउनलोड",
  sleepDuration: "नींद अवधि", recoveryBefore: "आराम से पहले", recoveryAfter: "आराम के बाद", n2Probability: "N2 संभावना",
  wakeWindow: "जागृति विंडो", smartWake: "स्मार्ट वेक", sleepState: "नींद अवस्था", stability: "स्थिरता",
  profile: "प्रोफ़ाइल", device: "डिवाइस", notifications: "सूचनाएं", language: "भाषा", appearance: "रूप",
  privacy: "गोपनीयता", about: "जानकारी", theme: "थीम", light: "हल्का", dark: "डार्क", automatic: "स्वचालित",
  save: "सहेजें", cancel: "रद्द करें", markAllRead: "सभी पढ़े हुए चिह्नित करें", dismiss: "खारिज करें", readMore: "विवरण देखें",
  prototypeNote: "यह एक इंजीनियरिंग प्रोटोटाइप संकेतक है — चिकित्सा माप नहीं।",
  alertAlertTitle: "पूर्ण रूप से सतर्क", alertAlertBody: "सतर्कता एक सुरक्षित स्तर पर वापस आ गई है।",
  alertFatigueTitle: "थकान बढ़ रही है", alertFatigueBody: "सतर्कता धीरे-धीरे घट रही है — जल्द ब्रेक लें।",
  alertDrowsinessTitle: "ऊंघ का पता चला", alertDrowsinessBody: "सतर्कता और घट गई है — जल्द आराम स्थान की योजना बनाएं।",
  alertSevereTitle: "गंभीर ऊंघ का पता चला", alertSevereBody: "मजबूत चेतावनी — कृपया आराम स्थान की योजना बनाएं।",
  alertCriticalTitle: "अति गंभीर ऊंघ का पता चला", alertCriticalBody: "कृपया तुरंत सुरक्षित स्थान पर रुकें।",
  alertRestFoundTitle: "आराम स्थान मिला", alertRestFoundBody: "पास में एक उपयुक्त आराम स्थान उपलब्ध है।",
  alertDeviceTitle: "डिवाइस जुड़ा", alertDeviceBody: "EEG और EOG सिग्नल गुणवत्ता अच्छी है।",
  alertWakeReadyTitle: "स्मार्ट वेक तैयार", alertWakeReadyBody: "एक स्थिर N2 विंडो का पता चला — आप जाग सकते हैं।",
  welcome: "SmartSense में आपका स्वागत है", getStarted: "शुरू करें", dashboard: "डैशबोर्ड",
};

const te: Dict = {
  appName: "SmartSense", tagline: "అంచనా వేయండి. విశ్రాంతి తీసుకోండి. కోలుకోండి.",
  overview: "అవలోకనం", liveMonitor: "లైవ్ మానిటర్", drowsiness: "మత్తు పర్యవేక్షణ", restManagement: "విశ్రాంతి నిర్వహణ", tripPlanner: "ప్రయాణ ప్రణాళిక",
  alerts: "హెచ్చరికలు", history: "చరిత్ర", sleepRecovery: "నిద్ర / కోలుకోవడం", reports: "నివేదికలు", settings: "సెట్టింగ్‌లు",
  monitoringGroup: "పర్యవేక్షణ", restRecoveryGroup: "విశ్రాంతి & కోలుకోవడం", insightsGroup: "అంతర్దృష్టులు", systemGroup: "సిస్టమ్",
  drivingMode: "డ్రైవింగ్ మోడ్", restMode: "విశ్రాంతి మోడ్",
  alert: "అప్రమత్తం", fatigue: "అలసట", drowsy: "మత్తు", severe: "తీవ్రమైన", critical: "అత్యవసర",
  stable: "స్థిరమైన", improving: "మెరుగవుతోంది", decreasing: "క్రమంగా తగ్గుతోంది", rapidDecrease: "వేగంగా తగ్గుతోంది",
  continueDriving: "డ్రైవింగ్ కొనసాగించండి", breakRecommended: "విరామం సిఫార్సు", restNow: "ఇప్పుడు విశ్రాంతి తీసుకోండి", stopNow: "ఇప్పుడే ఆపండి",
  safeToContinue: "కొనసాగించవచ్చు",
  currentVigilance: "ప్రస్తుత అప్రమత్తత", vigilanceScore: "అప్రమత్తత స్కోరు", drowsinessScore: "మత్తు స్కోరు",
  fatigueTrend: "అలసట ధోరణి", drivingDuration: "డ్రైవింగ్ వ్యవధి", continuousDriving: "నిరంతర డ్రైవింగ్",
  restStatus: "విశ్రాంతి స్థితి", latestAlert: "తాజా హెచ్చరిక", deviceStatus: "పరికర స్థితి", todaySummary: "నేటి సారాంశం",
  quickActions: "త్వరిత చర్యలు", recoveryStatus: "కోలుకునే స్థితి",
  openLiveMonitor: "లైవ్ మానిటర్ తెరవండి", findRestLocation: "సురక్షిత విశ్రాంతి స్థలం", navigate: "నావిగేట్ చేయండి",
  resumeDriving: "డ్రైవింగ్ తిరిగి ప్రారంభించండి", wakeUp: "మేల్కొనండి", simulateCondition: "పరిస్థితిని అనుకరించండి",
  signalStatus: "సిగ్నల్ స్థితి", signalQuality: "సిగ్నల్ నాణ్యత", monitoringStatus: "పర్యవేక్షణ స్థితి",
  wearableConnection: "ధరించగల పరికర కనెక్షన్", demoMode: "అనుకరణ మోడ్", simulation: "అనుకరణ", live: "లైవ్",
  connected: "అనుసంధానించబడింది", disconnected: "డిస్‌కనెక్ట్", poor: "సరిగా లేదు",
  eegBrain: "EEG — మెదడు కార్యకలాపం", eogEye: "EOG — కంటి & రెప్ప కదలిక",
  restReason: "విశ్రాంతి సిఫార్సుకు కారణం", restHistory: "విశ్రాంతి చరిత్ర", restSuitability: "విశ్రాంతి అనుకూలత",
  safety: "భద్రత", distance: "దూరం", facilities: "సౌకర్యాలు", accessibility: "అందుబాటు",
  severityDist: "తీవ్రత పంపిణీ", detectionEvents: "గుర్తింపు ఘటనలు", timeline: "కాలరేఖ",
  today: "ఈరోజు", thisWeek: "ఈ వారం", export: "ఎగుమతి", download: "డౌన్‌లోడ్",
  sleepDuration: "నిద్ర వ్యవధి", recoveryBefore: "విశ్రాంతికి ముందు", recoveryAfter: "విశ్రాంతి తర్వాత", n2Probability: "N2 సంభావ్యత",
  wakeWindow: "మేల్కొనే విండో", smartWake: "స్మార్ట్ మేల్కొలుపు", sleepState: "నిద్ర స్థితి", stability: "స్థిరత్వం",
  profile: "ప్రొఫైల్", device: "పరికరం", notifications: "నోటిఫికేషన్‌లు", language: "భాష", appearance: "రూపం",
  privacy: "గోప్యత", about: "గురించి", theme: "థీమ్", light: "లైట్", dark: "డార్క్", automatic: "ఆటోమేటిక్",
  save: "సేవ్ చేయండి", cancel: "రద్దు చేయండి", markAllRead: "అన్నీ చదివినట్లు గుర్తించండి", dismiss: "తీసివేయండి", readMore: "వివరాలు చూడండి",
  prototypeNote: "ఇది ఇంజనీరింగ్ ప్రోటోటైప్ సూచిక — వైద్య కొలత కాదు.",
  alertAlertTitle: "పూర్తి అప్రమత్తత", alertAlertBody: "అప్రమత్తత సురక్షిత స్థాయికి తిరిగి వచ్చింది.",
  alertFatigueTitle: "అలసట పెరుగుతోంది", alertFatigueBody: "అప్రమత్తత క్రమంగా తగ్గుతోంది — త్వరలో విరామం తీసుకోండి.",
  alertDrowsinessTitle: "మత్తు గుర్తించబడింది", alertDrowsinessBody: "అప్రమత్తత మరింత తగ్గింది — త్వరలో విశ్రాంతి స్థలాన్ని ప్లాన్ చేయండి.",
  alertSevereTitle: "తీవ్రమైన మత్తు గుర్తించబడింది", alertSevereBody: "బలమైన హెచ్చరిక — విశ్రాంతి స్థలాన్ని ప్లాన్ చేయండి.",
  alertCriticalTitle: "అత్యవసర మత్తు గుర్తించబడింది", alertCriticalBody: "దయచేసి వెంటనే సురక్షిత ప్రదేశంలో ఆపండి.",
  alertRestFoundTitle: "విశ్రాంతి స్థలం దొరికింది", alertRestFoundBody: "సమీపంలో అనుకూలమైన విశ్రాంతి స్థలం ఉంది.",
  alertDeviceTitle: "పరికరం అనుసంధానించబడింది", alertDeviceBody: "EEG మరియు EOG సిగ్నల్ నాణ్యత బాగుంది.",
  alertWakeReadyTitle: "స్మార్ట్ మేల్కొలుపు సిద్ధం", alertWakeReadyBody: "స్థిరమైన N2 విండో గుర్తించబడింది — మీరు మేల్కొనవచ్చు.",
  welcome: "SmartSense కు స్వాగతం", getStarted: "ప్రారంభించండి", dashboard: "డాష్‌బోర్డ్",
};

const ml: Dict = {
  appName: "SmartSense", tagline: "പ്രവചിക്കുക. വിശ്രമിക്കുക. വീണ്ടെടുക്കുക.",
  overview: "അവലോകനം", liveMonitor: "ലൈവ് മോണിറ്റർ", drowsiness: "ഉറക്ക നിരീക്ഷണം", restManagement: "വിശ്രമ മാനേജ്മെന്റ്", tripPlanner: "യാത്രാ പദ്ധതി",
  alerts: "അറിയിപ്പുകൾ", history: "ചരിത്രം", sleepRecovery: "ഉറക്കം / വീണ്ടെടുക്കൽ", reports: "റിപ്പോർട്ടുകൾ", settings: "ക്രമീകരണങ്ങൾ",
  monitoringGroup: "നിരീക്ഷണം", restRecoveryGroup: "വിശ്രമം & വീണ്ടെടുക്കൽ", insightsGroup: "ഇൻസൈറ്റുകൾ", systemGroup: "സിസ്റ്റം",
  drivingMode: "ഡ്രൈവിംഗ് മോഡ്", restMode: "വിശ്രമ മോഡ്",
  alert: "ജാഗ്രത", fatigue: "ക്ഷീണം", drowsy: "മയക്കം", severe: "ഗുരുതരം", critical: "അതീവഗുരുതരം",
  stable: "സ്ഥിരത", improving: "മെച്ചപ്പെടുന്നു", decreasing: "ക്രമേണ കുറയുന്നു", rapidDecrease: "വേഗത്തിൽ കുറയുന്നു",
  continueDriving: "ഡ്രൈവിംഗ് തുടരുക", breakRecommended: "വിശ്രമം ശുപാർശ", restNow: "ഇപ്പോൾ വിശ്രമിക്കുക", stopNow: "ഇപ്പോൾ നിർത്തുക",
  safeToContinue: "തുടരാൻ സുരക്ഷിതം",
  currentVigilance: "നിലവിലെ ജാഗ്രത", vigilanceScore: "ജാഗ്രത സ്കോർ", drowsinessScore: "മയക്ക സ്കോർ",
  fatigueTrend: "ക്ഷീണ പ്രവണത", drivingDuration: "ഡ്രൈവിംഗ് ദൈർഘ്യം", continuousDriving: "തുടർച്ചയായ ഡ്രൈവിംഗ്",
  restStatus: "വിശ്രമ നില", latestAlert: "സമീപകാല അറിയിപ്പ്", deviceStatus: "ഉപകരണ നില", todaySummary: "ഇന്നത്തെ സംഗ്രഹം",
  quickActions: "പെട്ടെന്നുള്ള പ്രവർത്തനങ്ങൾ", recoveryStatus: "വീണ്ടെടുക്കൽ നില",
  openLiveMonitor: "ലൈവ് മോണിറ്റർ തുറക്കുക", findRestLocation: "സുരക്ഷിത വിശ്രമ സ്ഥലം", navigate: "നാവിഗേറ്റ് ചെയ്യുക",
  resumeDriving: "ഡ്രൈവിംഗ് പുനരാരംഭിക്കുക", wakeUp: "ഉണരുക", simulateCondition: "അവസ്ഥ അനുകരിക്കുക",
  signalStatus: "സിഗ്നൽ നില", signalQuality: "സിഗ്നൽ ഗുണനിലവാരം", monitoringStatus: "നിരീക്ഷണ നില",
  wearableConnection: "വെയറബിൾ കണക്ഷൻ", demoMode: "സിമുലേഷൻ മോഡ്", simulation: "സിമുലേഷൻ", live: "ലൈവ്",
  connected: "ബന്ധിപ്പിച്ചു", disconnected: "വിച്ഛേദിച്ചു", poor: "മോശം",
  eegBrain: "EEG — മസ്തിഷ്ക പ്രവർത്തനം", eogEye: "EOG — കണ്ണ് & മിഴി ചലനം",
  restReason: "വിശ്രമ ശുപാർശയുടെ കാരണം", restHistory: "വിശ്രമ ചരിത്രം", restSuitability: "വിശ്രമ അനുയോജ്യത",
  safety: "സുരക്ഷ", distance: "ദൂരം", facilities: "സൗകര്യങ്ങൾ", accessibility: "പ്രാപ്യത",
  severityDist: "തീവ്രത വിതരണം", detectionEvents: "കണ്ടെത്തൽ സംഭവങ്ങൾ", timeline: "ടൈംലൈൻ",
  today: "ഇന്ന്", thisWeek: "ഈ ആഴ്ച", export: "എക്സ്പോർട്ട്", download: "ഡൗൺലോഡ്",
  sleepDuration: "ഉറക്ക ദൈർഘ്യം", recoveryBefore: "വിശ്രമത്തിന് മുമ്പ്", recoveryAfter: "വിശ്രമത്തിന് ശേഷം", n2Probability: "N2 സാധ്യത",
  wakeWindow: "ഉണരൽ വിൻഡോ", smartWake: "സ്മാർട്ട് വേക്ക്", sleepState: "ഉറക്ക നില", stability: "സ്ഥിരത",
  profile: "പ്രൊഫൈൽ", device: "ഉപകരണം", notifications: "അറിയിപ്പുകൾ", language: "ഭാഷ", appearance: "രൂപം",
  privacy: "സ്വകാര്യത", about: "വിവരണം", theme: "തീം", light: "ലൈറ്റ്", dark: "ഡാർക്ക്", automatic: "ഓട്ടോമാറ്റിക്",
  save: "സേവ് ചെയ്യുക", cancel: "റദ്ദാക്കുക", markAllRead: "എല്ലാം വായിച്ചതായി അടയാളപ്പെടുത്തുക", dismiss: "നിരസിക്കുക", readMore: "വിശദാംശങ്ങൾ കാണുക",
  prototypeNote: "ഇതൊരു എഞ്ചിനീയറിംഗ് പ്രോട്ടോടൈപ്പ് സൂചകമാണ് — വൈദ്യശാസ്ത്ര അളവല്ല.",
  alertAlertTitle: "പൂർണ്ണ ജാഗ്രത", alertAlertBody: "ജാഗ്രത സുരക്ഷിതമായ നിലയിലേക്ക് തിരിച്ചെത്തി.",
  alertFatigueTitle: "ക്ഷീണം വർദ്ധിക്കുന്നു", alertFatigueBody: "ജാഗ്രത ക്രമേണ കുറയുന്നു — ഉടൻ വിശ്രമിക്കുക.",
  alertDrowsinessTitle: "മയക്കം കണ്ടെത്തി", alertDrowsinessBody: "ജാഗ്രത കൂടുതൽ കുറഞ്ഞു — ഉടൻ വിശ്രമ സ്ഥലം ശുപാർശ ചെയ്യുന്നു.",
  alertSevereTitle: "ഗുരുതരമായ മയക്കം കണ്ടെത്തി", alertSevereBody: "ശക്തമായ മുന്നറിയിപ്പ് — വിശ്രമ സ്ഥലം ആസൂത്രണം ചെയ്യുക.",
  alertCriticalTitle: "അതീവഗുരുതരമായ മയക്കം കണ്ടെത്തി", alertCriticalBody: "ദയവായി ഉടൻ സുരക്ഷിത സ്ഥലത്ത് നിർത്തുക.",
  alertRestFoundTitle: "വിശ്രമ സ്ഥലം കണ്ടെത്തി", alertRestFoundBody: "സമീപത്ത് അനുയോജ്യമായ വിശ്രമ സ്ഥലം ലഭ്യമാണ്.",
  alertDeviceTitle: "ഉപകരണം ബന്ധിപ്പിച്ചു", alertDeviceBody: "EEG, EOG സിഗ്നൽ ഗുണനിലവാരം നല്ലതാണ്.",
  alertWakeReadyTitle: "സ്മാർട്ട് വേക്ക് തയ്യാർ", alertWakeReadyBody: "സ്ഥിരതയുള്ള N2 വിൻഡോ കണ്ടെത്തി — നിങ്ങൾക്ക് ഉണരാം.",
  welcome: "SmartSense-ലേക്ക് സ്വാഗതം", getStarted: "ആരംഭിക്കുക", dashboard: "ഡാഷ്ബോർഡ്",
};

const kn: Dict = {
  appName: "SmartSense", tagline: "ಊಹಿಸಿ. ವಿಶ್ರಮಿಸಿ. ಚೇತರಿಸಿಕೊಳ್ಳಿ.",
  overview: "ಅವಲೋಕನ", liveMonitor: "ಲೈವ್ ಮಾನಿಟರ್", drowsiness: "ನಿದ್ರೆ ಮೇಲ್ವಿಚಾರಣೆ", restManagement: "ವಿಶ್ರಾಂತಿ ನಿರ್ವಹಣೆ", tripPlanner: "ಪ್ರಯಾಣ ಯೋಜನೆ",
  alerts: "ಎಚ್ಚರಿಕೆಗಳು", history: "ಇತಿಹಾಸ", sleepRecovery: "ನಿದ್ರೆ / ಚೇತರಿಕೆ", reports: "ವರದಿಗಳು", settings: "ಸೆಟ್ಟಿಂಗ್‌ಗಳು",
  monitoringGroup: "ಮೇಲ್ವಿಚಾರಣೆ", restRecoveryGroup: "ವಿಶ್ರಾಂತಿ & ಚೇತರಿಕೆ", insightsGroup: "ಒಳನೋಟಗಳು", systemGroup: "ವ್ಯವಸ್ಥೆ",
  drivingMode: "ಚಾಲನಾ ಮೋಡ್", restMode: "ವಿಶ್ರಾಂತಿ ಮೋಡ್",
  alert: "ಜಾಗರೂಕ", fatigue: "ಆಯಾಸ", drowsy: "ನಿದ್ರೆ", severe: "ತೀವ್ರ", critical: "ಅತ್ಯಂತ ಗಂಭೀರ",
  stable: "ಸ್ಥಿರ", improving: "ಸುಧಾರಿಸುತ್ತಿದೆ", decreasing: "ಕ್ರಮೇಣ ಕಡಿಮೆಯಾಗುತ್ತಿದೆ", rapidDecrease: "ವೇಗವಾಗಿ ಕಡಿಮೆಯಾಗುತ್ತಿದೆ",
  continueDriving: "ಚಾಲನೆ ಮುಂದುವರಿಸಿ", breakRecommended: "ವಿರಾಮ ಶಿಫಾರಸು", restNow: "ಈಗ ವಿಶ್ರಮಿಸಿ", stopNow: "ಈಗ ನಿಲ್ಲಿಸಿ",
  safeToContinue: "ಮುಂದುವರಿಸಲು ಸುರಕ್ಷಿತ",
  currentVigilance: "ಪ್ರಸ್ತುತ ಜಾಗರೂಕತೆ", vigilanceScore: "ಜಾಗರೂಕತೆ ಸ್ಕೋರ್", drowsinessScore: "ನಿದ್ರೆ ಸ್ಕೋರ್",
  fatigueTrend: "ಆಯಾಸ ಪ್ರವೃತ್ತಿ", drivingDuration: "ಚಾಲನಾ ಅವಧಿ", continuousDriving: "ನಿರಂತರ ಚಾಲನೆ",
  restStatus: "ವಿಶ್ರಾಂತಿ ಸ್ಥಿತಿ", latestAlert: "ಇತ್ತೀಚಿನ ಎಚ್ಚರಿಕೆ", deviceStatus: "ಸಾಧನ ಸ್ಥಿತಿ", todaySummary: "ಇಂದಿನ ಸಾರಾಂಶ",
  quickActions: "ತ್ವರಿತ ಕ್ರಿಯೆಗಳು", recoveryStatus: "ಚೇತರಿಕೆ ಸ್ಥಿತಿ",
  openLiveMonitor: "ಲೈವ್ ಮಾನಿಟರ್ ತೆರೆಯಿರಿ", findRestLocation: "ಸುರಕ್ಷಿತ ವಿಶ್ರಾಂತಿ ಸ್ಥಳ", navigate: "ನ್ಯಾವಿಗೇಟ್ ಮಾಡಿ",
  resumeDriving: "ಚಾಲನೆ ಪುನರಾರಂಭಿಸಿ", wakeUp: "ಎಚ್ಚರಗೊಳ್ಳಿ", simulateCondition: "ಸ್ಥಿತಿಯನ್ನು ಅನುಕರಿಸಿ",
  signalStatus: "ಸಿಗ್ನಲ್ ಸ್ಥಿತಿ", signalQuality: "ಸಿಗ್ನಲ್ ಗುಣಮಟ್ಟ", monitoringStatus: "ಮೇಲ್ವಿಚಾರಣೆ ಸ್ಥಿತಿ",
  wearableConnection: "ಧರಿಸಬಹುದಾದ ಸಾಧನ ಸಂಪರ್ಕ", demoMode: "ಸಿಮ್ಯುಲೇಶನ್ ಮೋಡ್", simulation: "ಸಿಮ್ಯುಲೇಶನ್", live: "ಲೈವ್",
  connected: "ಸಂಪರ್ಕಗೊಂಡಿದೆ", disconnected: "ಸಂಪರ್ಕ ಕಡಿತ", poor: "ಕಳಪೆ",
  eegBrain: "EEG — ಮೆದುಳಿನ ಚಟುವಟಿಕೆ", eogEye: "EOG — ಕಣ್ಣು & ರೆಪ್ಪೆ ಚಲನೆ",
  restReason: "ವಿಶ್ರಾಂತಿ ಶಿಫಾರಸಿನ ಕಾರಣ", restHistory: "ವಿಶ್ರಾಂತಿ ಇತಿಹಾಸ", restSuitability: "ವಿಶ್ರಾಂತಿ ಸೂಕ್ತತೆ",
  safety: "ಸುರಕ್ಷತೆ", distance: "ದೂರ", facilities: "ಸೌಲಭ್ಯಗಳು", accessibility: "ಪ್ರವೇಶ",
  severityDist: "ತೀವ್ರತೆ ವಿತರಣೆ", detectionEvents: "ಪತ್ತೆ ಘಟನೆಗಳು", timeline: "ಟೈಮ್‌ಲೈನ್",
  today: "ಇಂದು", thisWeek: "ಈ ವಾರ", export: "ರಫ್ತು", download: "ಡೌನ್‌ಲೋಡ್",
  sleepDuration: "ನಿದ್ರೆ ಅವಧಿ", recoveryBefore: "ವಿಶ್ರಾಂತಿಗೆ ಮೊದಲು", recoveryAfter: "ವಿಶ್ರಾಂತಿಯ ನಂತರ", n2Probability: "N2 ಸಂಭವನೀಯತೆ",
  wakeWindow: "ಎಚ್ಚರ ವಿಂಡೋ", smartWake: "ಸ್ಮಾರ್ಟ್ ಎಚ್ಚರಿಕೆ", sleepState: "ನಿದ್ರೆ ಸ್ಥಿತಿ", stability: "ಸ್ಥಿರತೆ",
  profile: "ಪ್ರೊಫೈಲ್", device: "ಸಾಧನ", notifications: "ಅಧಿಸೂಚನೆಗಳು", language: "ಭಾಷೆ", appearance: "ನೋಟ",
  privacy: "ಗೌಪ್ಯತೆ", about: "ಬಗ್ಗೆ", theme: "ಥೀಮ್", light: "ಲೈಟ್", dark: "ಡಾರ್ಕ್", automatic: "ಸ್ವಯಂಚಾಲಿತ",
  save: "ಉಳಿಸಿ", cancel: "ರದ್ದುಮಾಡಿ", markAllRead: "ಎಲ್ಲವನ್ನೂ ಓದಿದಂತೆ ಗುರುತಿಸಿ", dismiss: "ವಜಾಗೊಳಿಸಿ", readMore: "ವಿವರಗಳನ್ನು ನೋಡಿ",
  prototypeNote: "ಇದು ಎಂಜಿನಿಯರಿಂಗ್ ಮೂಲಮಾದರಿ ಸೂಚಕ — ವೈದ್ಯಕೀಯ ಅಳತೆ ಅಲ್ಲ.",
  alertAlertTitle: "ಸಂಪೂರ್ಣ ಜಾಗರೂಕತೆ", alertAlertBody: "ಜಾಗರೂಕತೆ ಸುರಕ್ಷಿತ ಮಟ್ಟಕ್ಕೆ ಮರಳಿದೆ.",
  alertFatigueTitle: "ಆಯಾಸ ಹೆಚ್ಚುತ್ತಿದೆ", alertFatigueBody: "ಜಾಗರೂಕತೆ ಕ್ರಮೇಣ ಕಡಿಮೆಯಾಗುತ್ತಿದೆ — ಶೀಘ್ರದಲ್ಲೇ ವಿರಾಮ ತೆಗೆದುಕೊಳ್ಳಿ.",
  alertDrowsinessTitle: "ನಿದ್ರಾಜಡತೆ ಪತ್ತೆಯಾಗಿದೆ", alertDrowsinessBody: "ಜಾಗರೂಕತೆ ಮತ್ತಷ್ಟು ಕಡಿಮೆಯಾಗಿದೆ — ಶೀಘ್ರದಲ್ಲೇ ವಿಶ್ರಾಂತಿ ಸ್ಥಳವನ್ನು ಶಿಫಾರಸು ಮಾಡಲಾಗಿದೆ.",
  alertSevereTitle: "ತೀವ್ರ ನಿದ್ರೆ ಪತ್ತೆಯಾಗಿದೆ", alertSevereBody: "ಬಲವಾದ ಎಚ್ಚರಿಕೆ — ದಯವಿಟ್ಟು ವಿಶ್ರಾಂತಿ ಸ್ಥಳವನ್ನು ಯೋಜಿಸಿ.",
  alertCriticalTitle: "ಅತ್ಯಂತ ಗಂಭೀರ ನಿದ್ರೆ ಪತ್ತೆಯಾಗಿದೆ", alertCriticalBody: "ದಯವಿಟ್ಟು ತಕ್ಷಣ ಸುರಕ್ಷಿತ ಸ್ಥಳದಲ್ಲಿ ನಿಲ್ಲಿಸಿ.",
  alertRestFoundTitle: "ವಿಶ್ರಾಂತಿ ಸ್ಥಳ ಕಂಡುಬಂದಿದೆ", alertRestFoundBody: "ಹತ್ತಿರದಲ್ಲಿ ಸೂಕ್ತವಾದ ವಿಶ್ರಾಂತಿ ಸ್ಥಳ ಲಭ್ಯವಿದೆ.",
  alertDeviceTitle: "ಸಾಧನ ಸಂಪರ್ಕಗೊಂಡಿದೆ", alertDeviceBody: "EEG ಮತ್ತು EOG ಸಿಗ್ನಲ್ ಗುಣಮಟ್ಟ ಉತ್ತಮವಾಗಿದೆ.",
  alertWakeReadyTitle: "ಸ್ಮಾರ್ಟ್ ಎಚ್ಚರಿಕೆ ಸಿದ್ಧ", alertWakeReadyBody: "ಸ್ಥಿರವಾದ N2 ವಿಂಡೋ ಪತ್ತೆಯಾಗಿದೆ — ನೀವು ಎಚ್ಚರಗೊಳ್ಳಬಹುದು.",
  welcome: "SmartSense ಗೆ ಸ್ವಾಗತ", getStarted: "ಪ್ರಾರಂಭಿಸಿ", dashboard: "ಡ್ಯಾಶ್‌ಬೋರ್ಡ್",
};

const dictionaries: Record<Language, Dict> = { en, ta, hi, te, ml, kn };

export const vigilanceLabelKey: Record<VigilanceState, string> = {
  ALERT: "alert", FATIGUE: "fatigue", DROWSINESS: "drowsy", SEVERE: "severe", CRITICAL: "critical",
};
export const trendLabelKey: Record<Trend, string> = {
  STABLE: "stable", IMPROVING: "improving", DECREASING: "decreasing", RAPID_DECREASE: "rapidDecrease",
};
export const restDecisionLabelKey: Record<RestDecision, string> = {
  CONTINUE: "continueDriving", BREAK_RECOMMENDED: "breakRecommended", REST_NOW: "restNow", STOP_NOW: "stopNow",
};
export const stageLabels: Record<SafetyStage, string> = {
  DETECT: "Detect", PREDICT: "Predict", ALERT: "Alert", REST: "Rest", RECOVER: "Recover", RESUME: "Resume",
};
export const stageOrder: SafetyStage[] = ["DETECT", "PREDICT", "ALERT", "REST", "RECOVER", "RESUME"];

// ---------------------------------------------------------------------------
// Theme persistence
// ---------------------------------------------------------------------------

function usePersistentTheme() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    try {
      return (localStorage.getItem("smartsense-theme") as ThemeMode) || "system";
    } catch {
      return "system";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("smartsense-theme", theme);
    } catch {
      /* ignore */
    }
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", dark);
    };
    apply();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  return { theme, setTheme };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ContextValue {
  state: SmartSenseState;
  dispatch: (action: Action) => void;
  language: Language;
  setLanguage: (language: Language) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  t: (key: string) => string;
  dbStatus: DbStatus;
  alarmRinging: boolean;
}

const SmartSenseContext = createContext<ContextValue | null>(null);

export function SmartSenseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window === "undefined") return "en";
    try {
      return (localStorage.getItem("smartsense-language") as Language) || "en";
    } catch {
      return "en";
    }
  });
  const { theme, setTheme } = usePersistentTheme();
  const dispatch = useMemo(() => (action: Action) => setState((current) => reduceState(current, action)), []);

  // --- Optional Supabase persistence ----------------------------------
  // The app runs fully standalone with no backend by default. If
  // VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set (see .env.example),
  // each Rest Mode session is mirrored into the sleep_sessions table as it
  // starts and ends — a real, minimal proof that the web app and database
  // are actually connected, ahead of the ML/hardware pipeline writing
  // per-epoch predictions into the same schema later.
  const [dbStatus, setDbStatus] = useState<DbStatus>(isSupabaseConfigured ? "connecting" : "unconfigured");
  const dbSessionIdRef = useRef<string | null>(null);
  const wasRestingRef = useRef(false);

  // Confirm the connection as soon as the app loads (users/devices row
  // provisioning for the now-signed-in driver) rather than waiting for the
  // first Rest Mode session — otherwise the Settings status pill sits on
  // "Connecting…" indefinitely until the driver actually rests.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    getDbIdentity()
      .then((identity) => setDbStatus(identity ? "connected" : "error"))
      .catch(() => setDbStatus("error"));
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const inRest = state.operatingMode === "REST";
    if (inRest && !wasRestingRef.current) {
      wasRestingRef.current = true;
      startDbSession({ targetWakeTime: null })
        .then((id) => {
          dbSessionIdRef.current = id;
          setDbStatus(id ? "connected" : "error");
        })
        .catch(() => setDbStatus("error"));
    } else if (!inRest && wasRestingRef.current) {
      wasRestingRef.current = false;
      const id = dbSessionIdRef.current;
      dbSessionIdRef.current = null;
      if (id) {
        endDbSession(id)
          .then((ok) => setDbStatus(ok ? "connected" : "error"))
          .catch(() => setDbStatus("error"));
      }
    }
  }, [state.operatingMode]);

  // --- Smart Alarm sound ------------------------------------------------
  // A real, audible alarm (loops until acknowledged) plays once the wake
  // window's condition is met during a rest session — "wakeUp" flips
  // safetyStage to RECOVER, which is what silences it. See lib/alarmSound.ts
  // for why this is tab-open-only rather than a background push alarm.
  useEffect(() => {
    armAlarmAudio();
  }, []);

  const alarmRinging = state.operatingMode === "REST" && state.wakeStatus === "SATISFIED" && state.safetyStage !== "RECOVER";
  const alarmRingingRef = useRef(false);
  useEffect(() => {
    if (alarmRinging && !alarmRingingRef.current) {
      alarmRingingRef.current = true;
      startAlarm();
    } else if (!alarmRinging && alarmRingingRef.current) {
      alarmRingingRef.current = false;
      stopAlarm();
    }
  }, [alarmRinging]);
  useEffect(() => stopAlarm, []); // stop on unmount (e.g. sign-out)

  // A short, urgent beep the moment a new CRITICAL drowsiness alert lands —
  // a safety wake-up cue distinct from the Smart Alarm above.
  const lastAlertIdRef = useRef<string | null>(null);
  useEffect(() => {
    const newest = state.alerts[0];
    if (newest && newest.id !== lastAlertIdRef.current) {
      const isFirstRender = lastAlertIdRef.current === null;
      lastAlertIdRef.current = newest.id;
      if (!isFirstRender && newest.severity === "danger") playAlertBeep();
    }
  }, [state.alerts]);

  useEffect(() => {
    try {
      localStorage.setItem("smartsense-language", language);
    } catch {
      /* ignore */
    }
  }, [language]);

  const tickRef = useRef(dispatch);
  tickRef.current = dispatch;
  useEffect(() => {
    const id = setInterval(() => tickRef.current({ type: "tick" }), 3500);
    return () => clearInterval(id);
  }, []);

  const t = useMemo(() => {
    const dict = dictionaries[language] ?? en;
    return (key: string) => dict[key] ?? en[key] ?? key;
  }, [language]);

  const value = useMemo<ContextValue>(
    () => ({ state, dispatch, language, setLanguage, theme, setTheme, t, dbStatus, alarmRinging }),
    [state, dispatch, language, theme, setTheme, t, dbStatus, alarmRinging],
  );

  return <SmartSenseContext.Provider value={value}>{children}</SmartSenseContext.Provider>;
}

export function useSmartSense() {
  const value = useContext(SmartSenseContext);
  if (!value) throw new Error("SmartSenseProvider is required");
  return value;
}
