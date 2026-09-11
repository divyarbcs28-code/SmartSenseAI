import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, DashboardShell, PageIntro, Pill, SectionLabel } from "@/components/AppShell";
import { useSmartSense, vigilanceLabelKey, trendLabelKey, type VigilanceState } from "@/lib/smartsense";

const episodes = [
  { time: "04:42", state: "DROWSINESS" as VigilanceState, note: "Score dipped for a moment, then recovered." },
  { time: "03:15", state: "FATIGUE" as VigilanceState, note: "A gentle heads-up was shown — nothing urgent." },
  { time: "01:02", state: "ALERT" as VigilanceState, note: "Journey start — fully alert." },
];

export default function Drowsiness() {
  const { state, t } = useSmartSense();
  const TrendIcon = state.trend === "IMPROVING" ? TrendingUp : state.trend === "STABLE" ? Minus : TrendingDown;

  return (
    <DashboardShell>
      <PageIntro
        eyebrow={t("drowsiness")}
        title={t("drowsiness")}
        description="How alert you're feeling right now, and how it's been trending."
        action={<Pill tone="good">{t("monitoringStatus")}: Active</Pill>}
      />

      <section className="grid gap-6 xl:grid-cols-12">
        <Card className="xl:col-span-4">
          <SectionLabel>{t("drowsinessScore")}</SectionLabel>
          <div className="mt-3 flex items-end gap-2">
            <span className="font-display text-6xl font-extrabold">{state.vigilanceScore}</span>
            <span className="mb-2 text-sm text-muted-foreground">/ 100</span>
          </div>
          <Pill tone={state.vigilanceScore > 69 ? "good" : state.vigilanceScore > 39 ? "warn" : "danger"}>
            {t(vigilanceLabelKey[state.vigilanceState])}
          </Pill>
          <div className="mt-5 h-2 rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${state.vigilanceScore}%` }} />
          </div>
          <div className="mt-5 flex items-center gap-2 text-sm text-warning">
            <TrendIcon size={16} /> {t(trendLabelKey[state.trend])}
          </div>
        </Card>

        <Card className="xl:col-span-8">
          <SectionLabel>What this means</SectionLabel>
          <p className="mt-2 font-display text-lg font-bold">
            {state.trend === "IMPROVING" ? "You're feeling more alert." : "Your alertness has been slipping a little."}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {state.trend === "IMPROVING"
              ? "Keep it up — no action needed right now. We'll keep watching quietly in the background."
              : state.trend === "RAPID_DECREASE"
                ? "This is dropping quickly. If it keeps going, we'll suggest a break soon."
                : "This is a normal, gradual dip. We're keeping an eye on it, and we'll say something if it keeps trending down."}
          </p>
        </Card>
      </section>

      <Card>
        <SectionLabel>Recent moments</SectionLabel>
        <div className="mt-4 space-y-3">
          {episodes.map((ep) => (
            <div key={ep.time} className="flex items-start gap-3 rounded-2xl bg-secondary/50 p-3.5">
              <span className="mt-0.5 text-[11px] text-muted-foreground">{ep.time}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t(vigilanceLabelKey[ep.state])}</p>
                <p className="text-xs text-muted-foreground">{ep.note}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </DashboardShell>
  );
}
