import { Link } from "react-router-dom";
import { ArrowRight, Battery, Navigation, Radio, WifiOff } from "lucide-react";
import {
  Button,
  Card,
  DashboardShell,
  Gauge,
  Metric,
  PageIntro,
  Pill,
  SectionLabel,
  type PillTone,
} from "@/components/AppShell";
import {
  getGreeting,
  restDecisionLabelKey,
  trendLabelKey,
  useSmartSense,
  vigilanceLabelKey,
} from "@/lib/smartsense";
import { formatDuration } from "@/lib/utils";

export default function Overview() {
  const { state, t } = useSmartSense();
  const decisionTone: PillTone = state.restDecision === "CONTINUE" ? "good" : state.restDecision === "BREAK_RECOMMENDED" ? "warn" : "danger";
  const feelingGood = state.restDecision === "CONTINUE" && state.vigilanceScore >= 70;
  const connected = state.eegStatus === "CONNECTED";

  return (
    <DashboardShell>
      <PageIntro
        eyebrow={t("overview")}
        title={`${getGreeting()} 👋`}
        description={
          feelingGood
            ? "You're doing great out there — here's how your drive is looking today."
            : "Here's how your drive is looking today, and what we'd suggest next."
        }
        action={<Pill tone={decisionTone}>{t(restDecisionLabelKey[state.restDecision])}</Pill>}
      />

      <section className="grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <Card className="h-full">
            <div className="flex items-start justify-between">
              <div>
                <SectionLabel>{t("currentVigilance")}</SectionLabel>
                <p className="mt-1 font-display text-lg font-bold">{t(vigilanceLabelKey[state.vigilanceState])}</p>
              </div>
              <Pill>{t("demoMode")}</Pill>
            </div>
            <div className="mt-4">
              <Gauge score={state.vigilanceScore} />
            </div>
            <div className="mt-5 flex items-center justify-between rounded-2xl bg-secondary/70 px-4 py-3">
              <span className="text-xs text-muted-foreground">{t("fatigueTrend")}</span>
              <span className="text-xs font-semibold text-warning">{t(trendLabelKey[state.trend])}</span>
            </div>
            <p className="mt-4 text-center text-[11px] text-muted-foreground">A simulated wellness signal, not a medical reading.</p>
          </Card>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 xl:col-span-7">
          <Card>
            <SectionLabel>{t("todaySummary")}</SectionLabel>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label={t("drivingDuration")} value={formatDuration(state.drivingMinutesToday)} />
              <Metric label={t("distance") + " covered"} value={`${state.distanceKm} km`} />
              <Metric
                label="Next break"
                value={state.continuousDrivingMinutes >= 120 ? "Due now" : `${150 - state.continuousDrivingMinutes} min`}
                tone={state.continuousDrivingMinutes >= 120 ? "warn" : undefined}
              />
              <Metric label={t("recoveryStatus")} value={`${state.recoveryScore}/100`} tone="success" />
            </div>
            <Link to="/live-monitor">
              <Button className="mt-4 w-full">
                {t("openLiveMonitor")} <ArrowRight size={14} />
              </Button>
            </Link>
          </Card>

          <Card className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <SectionLabel>{t("wearableConnection")}</SectionLabel>
              <Pill tone={connected ? "good" : "warn"}>{connected ? t("connected") : "Not paired"}</Pill>
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-secondary/70 p-3.5">
              <span className={`grid size-10 place-items-center rounded-full ${connected ? "bg-primary/10 text-primary" : "bg-warning/15 text-warning"}`}>
                {connected ? <Radio size={17} /> : <WifiOff size={17} />}
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">{connected ? "Wearable connected" : "No wearable paired"}</p>
                <p className="text-xs text-muted-foreground">{connected ? "Reading your signals normally" : "Pair a device, or use simulated data in Settings"}</p>
              </div>
              {connected && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Battery size={16} />
                  <span className="text-xs font-medium">{state.wearableBattery}%</span>
                </div>
              )}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {!connected
                ? "We can't show live guidance without a connected wearable yet."
                : state.restDecision === "CONTINUE"
                  ? "You're clear to keep driving — we'll let you know the moment that changes."
                  : "We think it's time for a short break. Head to Rest Management to find a safe spot nearby."}
            </p>
            <Link to="/rest">
              <Button variant="secondary" className="w-full">
                {t("findRestLocation")} <Navigation size={14} />
              </Button>
            </Link>
          </Card>
        </div>
      </section>
    </DashboardShell>
  );
}
