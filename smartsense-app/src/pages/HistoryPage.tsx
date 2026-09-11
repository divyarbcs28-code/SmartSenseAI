import { useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Card, DashboardShell, Metric, PageIntro, Pill, SectionLabel } from "@/components/AppShell";
import { useSmartSense } from "@/lib/smartsense";
import { formatDuration } from "@/lib/utils";

const RANGE_OPTIONS = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" },
] as const;

const trendData = [
  { day: "Mon", vigilance: 76 }, { day: "Tue", vigilance: 82 }, { day: "Wed", vigilance: 78 },
  { day: "Thu", vigilance: 86 }, { day: "Fri", vigilance: 71 }, { day: "Sat", vigilance: 84 }, { day: "Sun", vigilance: 88 },
];

export default function HistoryPage() {
  const { state, t } = useSmartSense();
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]["id"]>("7d");

  const totals = useMemo(() => {
    const totalMin = state.history.reduce((sum, d) => sum + d.durationMin, 0);
    const avgVigilance = Math.round(state.history.reduce((sum, d) => sum + d.avgVigilance, 0) / state.history.length);
    const restBreaks = state.history.reduce((sum, d) => sum + d.restBreaks, 0);
    return { totalMin, avgVigilance, restBreaks };
  }, [state.history]);

  return (
    <DashboardShell>
      <PageIntro
        eyebrow={`SmartSense / ${t("history")}`}
        title={t("history")}
        description="Review previous drives, drowsiness events, rest breaks and vigilance trends."
        action={
          <div className="flex items-center gap-1 rounded-full bg-secondary/60 p-1">
            <CalendarRange size={14} className="ml-1.5 text-muted-foreground" />
            <select value={range} onChange={(e) => setRange(e.target.value as typeof range)} className="h-8 rounded-lg bg-transparent px-1 text-xs outline-none">
              {RANGE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <Metric label={t("today")} value={formatDuration(state.drivingMinutesToday)} sub="driving time" />
        <Metric label="Journeys" value={String(state.history.length)} sub={range === "7d" ? "this week" : "this period"} />
        <Metric label="Avg vigilance" value={String(totals.avgVigilance)} sub="prototype indicator" />
        <Metric label="Rest breaks" value={String(totals.restBreaks)} sub="logged" />
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <SectionLabel>Vigilance history</SectionLabel>
          <Pill>{t("simulation")}</Pill>
        </div>
        <div className="mt-5 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }} />
              <Line type="monotone" dataKey="vigilance" stroke="var(--color-primary)" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-border/70 text-xs text-muted-foreground">
              <tr>
                <th className="pb-3">Date</th>
                <th className="pb-3">Journey</th>
                <th className="pb-3">Duration</th>
                <th className="pb-3">Distance</th>
                <th className="pb-3">Avg vigilance</th>
                <th className="pb-3">Rest breaks</th>
                <th className="pb-3">Recovery</th>
              </tr>
            </thead>
            <tbody>
              {state.history.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="py-4 font-semibold">{row.date}</td>
                  <td className="py-4 text-muted-foreground">{row.route}</td>
                  <td className="py-4 text-muted-foreground">{formatDuration(row.durationMin)}</td>
                  <td className="py-4 text-muted-foreground">{row.distanceKm} km</td>
                  <td className="py-4 text-muted-foreground">{row.avgVigilance}</td>
                  <td className="py-4 text-muted-foreground">{row.restBreaks}</td>
                  <td className="py-4">
                    <Pill tone={row.outcome === "improved" ? "good" : row.outcome === "watch" ? "warn" : "default"}>{row.outcome}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">{t("prototypeNote")} · Demo history data</p>
      </Card>
    </DashboardShell>
  );
}
