import { isSupabaseConfigured, supabase } from "./supabaseClient";

export { isSupabaseConfigured };

// Every table in the schema (supabase/migrations/0001_init_schema.sql) is
// gated by Row Level Security tied to auth.uid() — a row can only be read
// or written by the user it belongs to. Since the app now requires a real
// Register/Sign-in (see lib/auth.ts) before any of this code runs, we
// always have a genuine authenticated session here — no anonymous sign-in
// needed. This module just provisions this real user's public.users /
// public.devices rows the first time it sees them.

export type DbStatus = "unconfigured" | "connecting" | "connected" | "error";

interface DbIdentity {
  userId: string;
  deviceId: string;
}

// Keyed by user id so switching accounts (sign out, sign in as someone
// else) never reuses a stale identity resolved for the previous user.
const cache = new Map<string, Promise<DbIdentity | null>>();

const DEMO_DEVICE_NAME = "Browser demo session";

async function establishIdentity(userId: string, displayName: string | null): Promise<DbIdentity | null> {
  if (!supabase) return null;

  // Make sure this user has a row in public.users (id must match auth.uid()).
  const { error: userErr } = await supabase.from("users").upsert({ id: userId, display_name: displayName ?? "SmartSense Driver" }, { onConflict: "id" });
  if (userErr) {
    console.error("SmartSense: failed to upsert users row", userErr);
    return null;
  }

  // Reuse an existing demo device for this user if one exists, else create one.
  // Ordered + limited (rather than .maybeSingle()) on purpose: two tabs/reloads
  // racing to provision the same user's first device can both find "none yet"
  // and both insert one, leaving two rows that match this same lookup.
  // .maybeSingle() throws (PGRST116, "multiple rows returned") the moment that
  // happens; ordering by creation time and taking the first row instead always
  // resolves to the same device deterministically, whether there's one row or
  // several — the account keeps working rather than getting stuck in "error".
  const { data: existingDevices, error: findErr } = await supabase
    .from("devices")
    .select("device_id")
    .eq("user_id", userId)
    .eq("device_name", DEMO_DEVICE_NAME)
    .order("created_at", { ascending: true })
    .limit(1);
  if (findErr) {
    console.error("SmartSense: failed to look up demo device", findErr);
    return null;
  }

  if (existingDevices && existingDevices.length > 0) {
    return { userId, deviceId: existingDevices[0].device_id as string };
  }

  const { data: newDevice, error: createErr } = await supabase
    .from("devices")
    .insert({ user_id: userId, device_name: DEMO_DEVICE_NAME, firmware_version: "web-demo", sampling_rate_hz: 100, connection_status: "connected" })
    .select("device_id")
    .single();
  if (createErr || !newDevice) {
    console.error("SmartSense: failed to create demo device", createErr);
    return null;
  }

  return { userId, deviceId: newDevice.device_id as string };
}

/** Resolves once to the signed-in user's user/device pair, provisioning
 * public.users / public.devices rows the first time it sees this user id.
 * Returns null if Supabase isn't configured, nobody is signed in yet, or
 * provisioning fails — callers should treat that as "not ready yet", never
 * throw. */
export async function getDbIdentity(): Promise<DbIdentity | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return null;

  if (!cache.has(userId)) {
    cache.set(userId, establishIdentity(userId, (data.session?.user.user_metadata?.display_name as string | undefined) ?? null));
  }
  return cache.get(userId)!;
}

/** Starts a sleep_sessions row when Rest Mode begins. Returns the new
 * session_id, or null if the DB isn't configured/reachable — the app keeps
 * working locally either way. */
export async function startDbSession(opts: { targetWakeTime?: string | null }): Promise<string | null> {
  const identity = await getDbIdentity();
  if (!identity || !supabase) return null;

  const { data, error } = await supabase
    .from("sleep_sessions")
    .insert({
      user_id: identity.userId,
      device_id: identity.deviceId,
      start_time: new Date().toISOString(),
      target_wake_time: opts.targetWakeTime ?? null,
      session_status: "active",
    })
    .select("session_id")
    .single();

  if (error || !data) {
    console.error("SmartSense: failed to start sleep_sessions row", error);
    return null;
  }
  return data.session_id as string;
}

/** Closes out a sleep_sessions row when the driver resumes driving. */
export async function endDbSession(sessionId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("sleep_sessions").update({ end_time: new Date().toISOString(), session_status: "completed" }).eq("session_id", sessionId);
  if (error) {
    console.error("SmartSense: failed to close sleep_sessions row", error);
    return false;
  }
  return true;
}
