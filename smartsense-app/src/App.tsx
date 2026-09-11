import { Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import Overview from "@/pages/Overview";
import LiveMonitor from "@/pages/LiveMonitor";
import Drowsiness from "@/pages/Drowsiness";
import TripPlanner from "@/pages/TripPlanner";
import RestManagement from "@/pages/RestManagement";
import AlertsPage from "@/pages/Alerts";
import HistoryPage from "@/pages/HistoryPage";
import SleepRecovery from "@/pages/SleepRecovery";
import Reports from "@/pages/Reports";
import SettingsPage from "@/pages/Settings";
import NotFound from "@/pages/NotFound";
import Register from "@/pages/Register";
import Login from "@/pages/Login";
import DatabaseRequired from "@/pages/DatabaseRequired";
import { useAuthSession } from "@/lib/auth";
import { SmartSenseProvider } from "@/lib/smartsense";

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
      <Loader2 size={22} className="animate-spin" />
    </div>
  );
}

export default function App() {
  const { status } = useAuthSession();

  // No Supabase project connected at all — real accounts can't work without
  // one, so there's nothing to gate: show setup instructions and stop.
  if (status === "unconfigured") return <DatabaseRequired />;

  // Resolving whatever session (if any) the browser already has.
  if (status === "loading") return <AuthLoading />;

  // Not signed in — only Register/Sign-in are reachable; everything else
  // redirects there. SmartSenseProvider (and the demo simulation it runs)
  // isn't mounted at all yet, so nothing here talks to the database.
  if (status === "signed-out") {
    return (
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Signed in — the real app. SmartSenseProvider mounts here, so its DB
  // session-sync only ever runs for a genuine, authenticated driver.
  return (
    <SmartSenseProvider>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/live-monitor" element={<LiveMonitor />} />
        <Route path="/drowsiness" element={<Drowsiness />} />
        <Route path="/trip-planner" element={<TripPlanner />} />
        <Route path="/rest" element={<RestManagement />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/sleep-recovery" element={<SleepRecovery />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/register" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </SmartSenseProvider>
  );
}
