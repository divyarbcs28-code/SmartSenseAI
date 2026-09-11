// A real, audible Smart Alarm — no external audio file needed. Uses the Web
// Audio API to generate the tone directly, so it works offline and doesn't
// need an asset to load. Browsers block audio until the page has seen at
// least one user gesture (a click/tap anywhere); `armAlarmAudio()` is called
// once on app load to grab and silently resume the AudioContext the first
// time that happens, so it's already unlocked by the time a real alarm
// needs to play.
//
// Limitation (by design — see README): this only sounds while the browser
// tab is open. Most mobile browsers throttle or fully suspend page audio
// once the screen locks or the tab is backgrounded, so this is not a true
// "wakes you with the phone in your pocket" alarm — that would need the app
// installed as a PWA with push notifications, which is a bigger build.

let ctx: AudioContext | null = null;
let armed = false;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/** Call once on app load. Unlocks audio playback on the first user gesture
 * anywhere on the page, well before any alarm actually needs to ring. */
export function armAlarmAudio() {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const unlock = () => {
    const c = getContext();
    if (c && c.state === "suspended") c.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function beep(frequency: number, startAt: number, duration: number, gainPeak: number) {
  const c = getContext();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  osc.connect(gain);
  gain.connect(c.destination);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.02);
  gain.gain.linearRampToValueAtTime(0, startAt + duration);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

let loopTimer: ReturnType<typeof setInterval> | null = null;

/** Starts the Smart Alarm: a repeating two-tone chime, plus vibration on
 * devices/browsers that support it (mainly Android Chrome — the Vibration
 * API isn't available on iOS Safari). Call stopAlarm() to silence it. */
export function startAlarm() {
  const c = getContext();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  if (loopTimer) return; // already ringing

  const ring = () => {
    const c2 = getContext();
    if (!c2) return;
    const t = c2.currentTime;
    beep(880, t, 0.35, 0.18);
    beep(660, t + 0.4, 0.35, 0.18);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([300, 150, 300, 150, 300]);
      } catch {
        /* ignore — vibration best-effort only */
      }
    }
  };

  ring();
  loopTimer = setInterval(ring, 1800);
}

export function stopAlarm() {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(0);
    } catch {
      /* ignore */
    }
  }
}

/** A single short, urgent beep — used for a CRITICAL drowsiness alert
 * (safety warning while driving), distinct from the looping wake alarm. */
export function playAlertBeep() {
  const c = getContext();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const t = c.currentTime;
  beep(988, t, 0.18, 0.2);
  beep(988, t + 0.24, 0.18, 0.2);
  beep(988, t + 0.48, 0.22, 0.2);
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate([150, 100, 150, 100, 250]);
    } catch {
      /* ignore */
    }
  }
}
