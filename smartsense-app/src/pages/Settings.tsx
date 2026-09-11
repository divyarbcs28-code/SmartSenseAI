import { useState } from "react";
import { Battery, Bell, Bluetooth, Database, FlaskConical, Globe, Heart, Info, LogOut, Moon, Palette, Radio, Shield, Sun, User } from "lucide-react";
import { Button, Card, DashboardShell, PageIntro, Pill, SafetyStageStrip, SectionLabel } from "@/components/AppShell";
import { languageNames, useSmartSense, vigilanceLabelKey, vigilanceScoreForStage, type Language, type ThemeMode, type VigilanceState } from "@/lib/smartsense";
import { cn } from "@/lib/utils";
import { signOut, useAuthSession } from "@/lib/auth";

const dbStatusLabel = {
  unconfigured: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  error: "Connection error",
} as const;
const dbStatusTone = { unconfigured: "default", connecting: "default", connected: "good", error: "danger" } as const;

const drowsinessStages: { stage: VigilanceState; number: number; description: string }[] = [
  { stage: "ALERT", number: 1, description: "Fully alert — no rest action needed." },
  { stage: "FATIGUE", number: 2, description: "Vigilance gradually decreasing — a break soon would help." },
  { stage: "DROWSINESS", number: 3, description: "Drowsiness detected — a rest stop is recommended." },
  { stage: "SEVERE", number: 4, description: "Severe drowsiness — plan a rest stop now." },
  { stage: "CRITICAL", number: 5, description: "Critical — stop at the nearest safe location immediately." },
];

const statusLabel = { CONNECTED: "Connected", POOR: "Weak signal", DISCONNECTED: "Not paired" } as const;

const sections = [
  { id: "profile", label: "Profile", icon: User },
  { id: "device", label: "Device", icon: Radio },
  { id: "database", label: "Database", icon: Database },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "language", label: "Language", icon: Globe },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "privacy", label: "Privacy", icon: Shield },
  { id: "demo", label: "Demo controls", icon: FlaskConical },
  { id: "about", label: "About", icon: Info },
] as const;

export default function SettingsPage() {
  const { state, dispatch, theme, setTheme, language, setLanguage, t, dbStatus } = useSmartSense();
  const { session } = useAuthSession();
  const displayName = (session?.user.user_metadata?.display_name as string | undefined) || "SmartSense Driver";
  const [notifPrefs, setNotifPrefs] = useState({
    fatigue: true,
    critical: true,
    restReminders: true,
    smartWake: true,
  });
  const [privacyPrefs, setPrivacyPrefs] = useState({ shareAnonymized: false, storeHistory: true });

  return (
    <DashboardShell>
      <PageIntro eyebrow={`SmartSense / ${t("settings")}`} title={t("settings")} description="Manage your profile, device connection, notifications, language, appearance and privacy." />

      <div className="flex flex-wrap gap-2">
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-3 py-1.5 text-xs font-medium hover:bg-secondary">
              <s.icon size={12} /> {s.label}
            </span>
          </a>
        ))}
      </div>

      <Card id="profile">
        <div className="flex items-center gap-2">
          <User size={16} className="text-primary" />
          <SectionLabel>{t("profile")}</SectionLabel>
        </div>
        <div className="mt-5 grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
          <div className="flex flex-col items-center rounded-2xl bg-secondary/40 p-6 text-center">
            <div className="grid size-20 place-items-center rounded-full bg-primary text-primary-foreground">
              <Heart size={30} fill="currentColor" strokeWidth={0} />
            </div>
            <h3 className="mt-4 font-display text-xl font-bold">{displayName}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{session?.user.email ?? "Prototype driver profile"}</p>
            <Pill tone="good">Journey active</Pill>
            <Button
              size="sm"
              variant="secondary"
              className="mt-4"
              onClick={() => {
                signOut();
              }}
            >
              <LogOut size={13} /> Sign out
            </Button>
          </div>
          <div className="space-y-4">
            {[
              ["Display name", displayName],
              ["Vehicle", "Long-distance truck"],
              [t("wakeWindow"), `${state.wakeWindowStart} — ${state.wakeWindowEnd}`],
              ["Preferred units", "Kilometers"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-border/70 pb-4 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card id="device">
        <div className="flex items-center gap-2">
          <Radio size={16} className="text-primary" />
          <SectionLabel>{t("device")}</SectionLabel>
        </div>

        <div className="mt-5">
          <SectionLabel>Data source</SectionLabel>
          <p className="mt-1 text-sm text-muted-foreground">
            This build has no real wearable to connect yet, so Live hardware mode simply waits for one — it won't show
            fake readings. Switch back to simulated data any time to keep exploring the app.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                ["SIMULATION", "Simulated data (demo)"],
                ["LIVE", "Live hardware"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => dispatch({ type: "setDataSource", source: value })}
                className={cn(
                  "rounded-xl px-4 py-2.5 text-sm font-semibold transition",
                  state.dataSource === value ? "bg-primary text-primary-foreground ring-2 ring-primary" : "bg-secondary/60",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {state.dataSource === "LIVE" && (
            <div className="mt-3 flex items-center gap-3 rounded-2xl bg-secondary/40 p-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
                <Bluetooth size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">No wearable found nearby</p>
                <p className="text-xs text-muted-foreground">Pairing isn't available in this demo build yet.</p>
              </div>
              <Pill tone="warn">Searching…</Pill>
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            { label: "EEG sensor", status: state.eegStatus, quality: state.eegQuality },
            { label: "EOG sensor", status: state.eogStatus, quality: state.eogQuality },
            { label: "Wearable battery", status: state.eegStatus, quality: state.eegStatus === "CONNECTED" ? state.wearableBattery : 0 },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl bg-secondary/40 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{item.label}</p>
                <Pill tone={item.status === "CONNECTED" ? "good" : "warn"}>{statusLabel[item.status]}</Pill>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Battery size={14} className="text-muted-foreground" />
                <div className="h-2 flex-1 rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${item.quality}%` }} />
                </div>
                <span className="text-xs">{item.quality}%</span>
              </div>
            </div>
          ))}
        </div>
        {(state.eegStatus === "CONNECTED" && (state.wearableBattery < 20 || state.eegQuality < 50 || state.eogQuality < 50)) && (
          <div className="mt-4 flex flex-col items-start gap-3 rounded-2xl bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-warning">A little attention needed</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {state.wearableBattery < 20 ? "Your wearable battery is running low — plug it in when you get a chance." : "Signal quality has dropped — check that your wearable is snug and charged."}
              </p>
            </div>
          </div>
        )}
      </Card>

      <Card id="database">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-primary" />
          <SectionLabel>Database</SectionLabel>
          <span className="ml-auto">
            <Pill tone={dbStatusTone[dbStatus]}>{dbStatusLabel[dbStatus]}</Pill>
          </span>
        </div>
        {dbStatus === "unconfigured" ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No database is connected — the app runs entirely in this browser, and nothing is sent anywhere. To connect
            a real Supabase project (so rest sessions are actually saved), set{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">VITE_SUPABASE_URL</code> and{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">VITE_SUPABASE_ANON_KEY</code> — see{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">.env.example</code> and the README.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Connected to Supabase. Each time you enter and leave Rest Mode, a row is written to and updated in the{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">sleep_sessions</code> table — you can watch it
            appear live in your project's Table Editor. Per-epoch predictions and Smart Alarm events will land in{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">sleep_epochs</code> /{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">alarm_events</code> once the ML pipeline is
            wired in.
          </p>
        )}
        {dbStatus === "error" && (
          <p className="mt-2 text-xs text-warning">
            Couldn't reach the database — check your Supabase URL/key in <code className="rounded bg-secondary px-1 py-0.5">.env.local</code> are
            correct, that <code className="rounded bg-secondary px-1 py-0.5">supabase/migrations/0001_init_schema.sql</code> has been run in your
            project's SQL Editor, and check the browser console for the specific error.
          </p>
        )}
      </Card>

      <Card id="notifications">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-primary" />
          <SectionLabel>{t("notifications")}</SectionLabel>
        </div>
        <div className="mt-5 space-y-3">
          {(
            [
              ["fatigue", "Fatigue alerts"],
              ["critical", "Critical drowsiness alerts"],
              ["restReminders", "Rest break reminders"],
              ["smartWake", "Smart wake notifications"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between rounded-xl bg-secondary/70 px-4 py-3 text-sm">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={notifPrefs[key]}
                onChange={(e) => setNotifPrefs((prev) => ({ ...prev, [key]: e.target.checked }))}
                className="size-4 accent-[var(--color-primary)]"
              />
            </label>
          ))}
        </div>
      </Card>

      <Card id="language">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-primary" />
          <SectionLabel>{t("language")}</SectionLabel>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">English is the primary language. Navigation, dashboard titles, states and key actions are translated; technical signal names (EEG/EOG/N2) stay unchanged.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(languageNames).map(([key, name]) => (
            <button
              key={key}
              onClick={() => setLanguage(key as Language)}
              className={cn(
                "rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                language === key ? "bg-primary text-primary-foreground ring-2 ring-primary" : "bg-secondary/60",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      </Card>

      <Card id="appearance">
        <div className="flex items-center gap-2">
          <Palette size={16} className="text-primary" />
          <SectionLabel>{t("appearance")}</SectionLabel>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              ["light", t("light"), Sun],
              ["dark", t("dark"), Moon],
              ["system", t("automatic"), Palette],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              onClick={() => setTheme(value as ThemeMode)}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition",
                theme === value ? "bg-primary text-primary-foreground ring-2 ring-primary" : "bg-secondary",
              )}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Automatic follows your operating system's light/dark preference and updates live.</p>
      </Card>

      <Card id="privacy">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-primary" />
          <SectionLabel>{t("privacy")}</SectionLabel>
        </div>
        <div className="mt-5 space-y-3">
          <label className="flex items-center justify-between rounded-xl bg-secondary/70 px-4 py-3 text-sm">
            <span>Store driving history locally on this device</span>
            <input
              type="checkbox"
              checked={privacyPrefs.storeHistory}
              onChange={(e) => setPrivacyPrefs((p) => ({ ...p, storeHistory: e.target.checked }))}
              className="size-4 accent-[var(--color-primary)]"
            />
          </label>
          <label className="flex items-center justify-between rounded-xl bg-secondary/70 px-4 py-3 text-sm">
            <span>Share anonymized data to improve the model</span>
            <input
              type="checkbox"
              checked={privacyPrefs.shareAnonymized}
              onChange={(e) => setPrivacyPrefs((p) => ({ ...p, shareAnonymized: e.target.checked }))}
              className="size-4 accent-[var(--color-primary)]"
            />
          </label>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          All physiological data shown in this prototype is simulated locally in your browser.{" "}
          {dbStatus === "unconfigured" ? "Nothing is transmitted anywhere." : "See Database above for what's saved when a database is connected."}
        </p>
      </Card>

      <div id="demo" className="scroll-mt-24 space-y-4">
        <div className="flex items-center gap-2 px-1">
          <FlaskConical size={16} className="text-primary" />
          <SectionLabel>Demo controls</SectionLabel>
        </div>
        <p className="px-1 text-sm text-muted-foreground">
          This build simulates driving data on its own, so you don't need to touch anything here. If you'd like to
          jump between stages yourself for a demo, you can below — everyday drivers won't need this.
        </p>
        <SafetyStageStrip />

        <Card>
          <SectionLabel>Drowsiness stage</SectionLabel>
          <p className="mt-1 text-sm text-muted-foreground">
            Manually jump to any of the 5 drowsiness stages — this updates your real vigilance score, triggers the
            matching alert, and changes how Rest Management prioritizes stops (Critical always picks the nearest
            safe stop; the other stages balance distance, safety and facilities differently — see Rest Management).
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {drowsinessStages.map(({ stage, number, description }) => {
              const active = state.vigilanceState === stage;
              return (
                <button
                  key={stage}
                  onClick={() => dispatch({ type: "setDemoVigilanceStage", stage })}
                  className={cn(
                    "rounded-2xl p-3.5 text-left transition hover:-translate-y-0.5",
                    active ? "bg-primary/10 ring-2 ring-primary" : "bg-secondary/60",
                  )}
                >
                  <p className="text-[11px] font-semibold text-muted-foreground">Stage {number}</p>
                  <p className="mt-1 font-display text-sm font-bold">{state.vigilanceState && vigilanceLabelKey[stage] ? t(vigilanceLabelKey[stage]) : stage}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
                  <p className="mt-2 text-[10px] text-muted-foreground">Score ≈ {vigilanceScoreForStage[stage]}</p>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      <Card id="about">
        <div className="flex items-center gap-2">
          <Info size={16} className="text-primary" />
          <SectionLabel>{t("about")}</SectionLabel>
        </div>
        <h3 className="mt-3 font-display text-xl font-bold">SmartSense — Predict. Rest. Recover.</h3>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          An AI-based multimodal wearable concept for predictive driver drowsiness detection and intelligent alert
          and rest management (Smart India Hackathon 2026, Problem Statement 26220). This build is an engineering
          prototype / demo experience: vigilance scores, signals and locations are simulated, not live medical or
          hardware measurements.
        </p>
        <p className="mt-3 text-[11px] text-muted-foreground">{t("prototypeNote")}</p>
      </Card>
    </DashboardShell>
  );
}
