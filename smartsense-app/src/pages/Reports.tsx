import { AlertTriangle, BarChart3, Download, FileJson, FileText, Moon, Sparkles } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, DashboardShell, Metric, PageIntro, SectionLabel } from "@/components/AppShell";
import { useSmartSense } from "@/lib/smartsense";
import { formatDuration } from "@/lib/utils";

const weekly = [
  { day: "Mon", minutes: 96 }, { day: "Tue", minutes: 142 }, { day: "Wed", minutes: 88 },
  { day: "Thu", minutes: 156 }, { day: "Fri", minutes: 138 }, { day: "Sat", minutes: 64 }, { day: "Sun", minutes: 40 },
];

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const { state, t } = useSmartSense();

  const reportCards = [
    { label: "Daily Driving Report", icon: FileText, data: { drivingMinutes: state.drivingMinutesToday, distanceKm: state.distanceKm, avgVigilance: state.vigilanceScore } },
    { label: "Weekly Driving Report", icon: BarChart3, data: weekly },
    { label: "Drowsiness Summary", icon: AlertTriangle, data: { events: state.alerts.filter((a) => a.category === "drowsiness").length, worstState: state.vigilanceState } },
    { label: "Rest Summary", icon: Moon, data: { restBreaks: state.history.reduce((s, d) => s + d.restBreaks, 0), lastSession: state.restSessionMinutes } },
    { label: "Recovery Summary", icon: Sparkles, data: { before: state.recoveryBefore, after: state.recoveryAfter } },
  ];

  return (
    <DashboardShell>
      <PageIntro
        eyebrow={`SmartSense / ${t("reports")}`}
        title={t("reports")}
        description="Daily and weekly driving, drowsiness, rest and recovery summaries — exportable for records or sharing."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label={t("today")} value={formatDuration(state.drivingMinutesToday)} sub="driving time" />
        <Metric label={t("thisWeek")} value={formatDuration(weekly.reduce((s, d) => s + d.minutes, 0))} sub="driving time" />
        <Metric label="Rest breaks logged" value={String(state.history.reduce((s, d) => s + d.restBreaks, 0))} sub="this period" />
      </div>

      <Card>
        <SectionLabel>Weekly driving report</SectionLabel>
        <div className="mt-5 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekly} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="minutes" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {reportCards.map(({ label, icon: Icon, data }) => (
          <Card key={label}>
            <Icon className="text-primary" size={22} />
            <h3 className="mt-4 font-display text-lg font-bold">{label}</h3>
            <p className="mt-2 text-sm text-muted-foreground">Prepare a clean export of this dataset for this driver's records.</p>
            <div className="mt-5 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => download(`${label.toLowerCase().replaceAll(" ", "-")}.json`, JSON.stringify(data, null, 2), "application/json")}
              >
                <FileJson size={13} /> JSON
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  const rows = Array.isArray(data)
                    ? [Object.keys(data[0]).join(","), ...data.map((r: Record<string, unknown>) => Object.values(r).join(","))]
                    : [Object.keys(data).join(","), Object.values(data).join(",")];
                  download(`${label.toLowerCase().replaceAll(" ", "-")}.csv`, rows.join("\n"), "text/csv");
                }}
              >
                <Download size={13} /> CSV
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <p className="text-[11px] text-muted-foreground">
          {t("prototypeNote")} · All figures reflect simulated demo data for this prototype.
        </p>
      </Card>
    </DashboardShell>
  );
}
