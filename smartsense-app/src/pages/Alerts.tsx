import { AlertTriangle, Bell, Radio, Target, X } from "lucide-react";
import { Button, Card, DashboardShell, EmptyState, PageIntro, Pill, SectionLabel, type PillTone } from "@/components/AppShell";
import { useSmartSense, type AlertSeverity } from "@/lib/smartsense";
import { cn } from "@/lib/utils";

const categoryIcon = { drowsiness: AlertTriangle, rest: Target, device: Radio, system: Bell } as const;

function severityTone(sev: AlertSeverity): PillTone {
  return sev === "danger" ? "danger" : sev === "warn" ? "warn" : sev === "good" ? "good" : "default";
}

function timeAgo(ts: number) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

export default function AlertsPage() {
  const { state, dispatch, t } = useSmartSense();
  const unreadCount = state.alerts.filter((a) => !a.read).length;

  return (
    <DashboardShell>
      <PageIntro
        eyebrow={`SmartSense / ${t("alerts")}`}
        title={t("alerts")}
        description="A clear, non-overwhelming feed of drowsiness, rest and device-quality events."
        action={
          <Button variant="secondary" size="sm" onClick={() => dispatch({ type: "markAllAlertsRead" })} disabled={unreadCount === 0}>
            {t("markAllRead")}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Pill tone="dark">{state.alerts.length} total</Pill>
        <Pill tone={unreadCount ? "warn" : "good"}>{unreadCount} unread</Pill>
        <Pill tone="danger">{state.alerts.filter((a) => a.severity === "danger").length} critical</Pill>
      </div>

      {state.alerts.length === 0 ? (
        <EmptyState icon={Bell} title="No alerts" description="You're all caught up. New drowsiness, rest and device alerts will appear here." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {state.alerts.map((item) => {
            const Icon = categoryIcon[item.category];
            return (
              <Card key={item.id} className={cn(!item.read && "ring-2 ring-primary/25")}>
                <div className="flex items-start gap-4">
                  <span
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-xl",
                      item.severity === "danger" ? "bg-destructive/15 text-destructive" : item.severity === "warn" ? "bg-warning/15 text-warning" : item.severity === "good" ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground",
                    )}
                  >
                    <Icon size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-bold">{t(item.titleKey)}</h3>
                      <Pill tone={severityTone(item.severity)}>{item.severity}</Pill>
                      {!item.read && <span className="size-1.5 rounded-full bg-primary" />}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{t(item.bodyKey)}</p>
                    <p className="mt-4 text-[11px] text-muted-foreground">
                      {t("simulation")} · {timeAgo(item.timestamp)}
                    </p>
                    <div className="mt-3 flex gap-2">
                      {!item.read && (
                        <Button size="sm" variant="secondary" onClick={() => dispatch({ type: "markAlertRead", id: item.id })}>
                          {t("readMore")}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "dismissAlert", id: item.id })}>
                        <X size={12} /> {t("dismiss")}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </DashboardShell>
  );
}
