import { useEffect, useState } from "react";
import { Activity, Battery, Eye, Wifi } from "lucide-react";
import {
  Card,
  DashboardShell,
  EmptyState,
  PageIntro,
  Pill,
  SectionLabel,
  Waveform,
} from "@/components/AppShell";
import { useSmartSense, vigilanceLabelKey } from "@/lib/smartsense";

function useClock() {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return new Date();
}

export default function LiveMonitor() {
  const { state, t } = useSmartSense();
  const now = useClock();
  const safetyTone = state.vigilanceState === "ALERT" || state.vigilanceState === "FATIGUE" ? "good" : state.vigilanceState === "DROWSINESS" ? "warn" : "danger";
  const connected = state.eegStatus === "CONNECTED";

  if (!connected) {
    return (
      <DashboardShell>
        <PageIntro
          eyebrow={t("liveMonitor")}
          title={t("liveMonitor")}
          description="Real-time EEG and EOG signals feeding the drowsiness model."
          action={<Pill tone="warn">Not paired</Pill>}
        />
        <EmptyState
          icon={Wifi}
          title="No wearable paired yet"
          description="Pair a SmartSense wearable to see real-time signals here — see the banner above to switch back to simulated data."
        />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <PageIntro
        eyebrow={t("liveMonitor")}
        title={t("liveMonitor")}
        description="Real-time EEG and EOG physiological signals feeding the multimodal drowsiness model."
        action={<Pill tone="good">{t("monitoringStatus")}: Active</Pill>}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="flex items-center justify-between">
            <SectionLabel>{t("signalStatus")}</SectionLabel>
            <Wifi size={14} className="text-success" />
          </div>
          <p className="mt-2 font-display text-2xl font-extrabold">{t("connected")}</p>
          <p className="mt-1 text-xs text-muted-foreground">EEG + EOG wearable</p>
        </Card>
        <Card>
          <SectionLabel>{t("signalQuality")}</SectionLabel>
          <p className="mt-2 font-display text-2xl font-extrabold">{Math.round((state.eegQuality + state.eogQuality) / 2)}%</p>
          <p className="mt-1 text-xs text-muted-foreground">Combined EEG/EOG confidence</p>
        </Card>
        <Card tone={safetyTone === "danger" ? "danger" : safetyTone === "warn" ? "warn" : undefined}>
          <SectionLabel>Current Driver State</SectionLabel>
          <p className="mt-2 font-display text-2xl font-extrabold">{t(vigilanceLabelKey[state.vigilanceState])}</p>
          <p className="mt-1 text-xs text-muted-foreground">Vigilance {state.vigilanceScore}/100</p>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <SectionLabel>{t("wearableConnection")}</SectionLabel>
            <Battery size={14} className="text-muted-foreground" />
          </div>
          <p className="mt-2 font-display text-2xl font-extrabold">{state.wearableBattery}%</p>
          <p className="mt-1 text-xs text-muted-foreground">{now.toLocaleTimeString()}</p>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Activity size={19} />
              </span>
              <div>
                <SectionLabel>{t("eegBrain")}</SectionLabel>
                <h3 className="font-display text-lg font-bold">Brain activity feature stream</h3>
              </div>
            </div>
            <Pill tone={state.eegQuality > 70 ? "good" : "warn"}>{state.eegQuality}%</Pill>
          </div>
          <div className="mt-5">
            <Waveform variant="eeg" height={130} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-secondary/70 p-3">
              <SectionLabel>{t("monitoringStatus")}</SectionLabel>
              <p className="mt-1 text-xs font-semibold">Active</p>
            </div>
            <div className="rounded-xl bg-secondary/70 p-3">
              <SectionLabel>{t("demoMode")}</SectionLabel>
              <p className="mt-1 text-xs font-semibold">{t("simulation")}</p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-success/15 text-success">
                <Eye size={19} />
              </span>
              <div>
                <SectionLabel>{t("eogEye")}</SectionLabel>
                <h3 className="font-display text-lg font-bold">Eye movement & blink stream</h3>
              </div>
            </div>
            <Pill tone={state.eogQuality > 70 ? "good" : "warn"}>{state.eogQuality}%</Pill>
          </div>
          <div className="mt-5">
            <Waveform variant="eog" height={130} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-secondary/70 p-3">
              <SectionLabel>Blinks/min</SectionLabel>
              <p className="mt-1 text-xs font-semibold">{14 + (state.vigilanceScore < 50 ? 8 : 0)}</p>
            </div>
            <div className="rounded-xl bg-secondary/70 p-3">
              <SectionLabel>Slow eye moves</SectionLabel>
              <p className="mt-1 text-xs font-semibold">{state.vigilanceScore < 50 ? "Detected" : "None"}</p>
            </div>
            <div className="rounded-xl bg-secondary/70 p-3">
              <SectionLabel>{t("demoMode")}</SectionLabel>
              <p className="mt-1 text-xs font-semibold">{t("simulation")}</p>
            </div>
          </div>
        </Card>
      </section>

      <Card>
        <SectionLabel>Multimodal fusion</SectionLabel>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          EEG and EOG feature streams are fused into a continuous vigilance/drowsiness score (0–100) rather than a
          binary drowsy/not-drowsy decision, so SmartSense can track the direction of the trend and predict — not
          just detect — worsening drowsiness.
        </p>
        <p className="mt-3 text-[11px] text-muted-foreground">
          {t("prototypeNote")} · Vigilance is derived from EEG and EOG physiological signals only.
        </p>
      </Card>
    </DashboardShell>
  );
}
