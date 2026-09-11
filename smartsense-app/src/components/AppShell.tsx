import { Link, useLocation } from "react-router-dom";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  Activity,
  AlarmClock,
  BarChart3,
  Bell,
  Gauge as GaugeIcon,
  Heart,
  History,
  Home,
  Languages,
  Map as MapIcon,
  Menu,
  Moon,
  Radio,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  Target,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { languageNames, useSmartSense, type Language, type ThemeMode } from "@/lib/smartsense";

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    labelKey: "monitoringGroup",
    items: [
      { to: "/", labelKey: "overview", icon: Home },
      { to: "/live-monitor", labelKey: "liveMonitor", icon: Radio },
      { to: "/drowsiness", labelKey: "drowsiness", icon: Activity },
      { to: "/alerts", labelKey: "alerts", icon: Bell },
    ],
  },
  {
    labelKey: "restRecoveryGroup",
    items: [
      { to: "/trip-planner", labelKey: "tripPlanner", icon: MapIcon },
      { to: "/rest", labelKey: "restManagement", icon: Target },
      { to: "/sleep-recovery", labelKey: "sleepRecovery", icon: Moon },
    ],
  },
  {
    labelKey: "insightsGroup",
    items: [
      { to: "/history", labelKey: "history", icon: History },
      { to: "/reports", labelKey: "reports", icon: BarChart3 },
    ],
  },
  {
    labelKey: "systemGroup",
    items: [{ to: "/settings", labelKey: "settings", icon: SettingsIcon }],
  },
];

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-3">
      <span
        className={cn(
          "grid size-11 place-items-center rounded-2xl font-display text-lg font-extrabold",
          light ? "bg-white/20 text-white" : "bg-primary text-primary-foreground",
        )}
      >
        <Heart size={20} fill="currentColor" strokeWidth={0} />
      </span>
      <span>
        <span className={cn("block text-[16px] font-bold leading-none tracking-tight", light ? "text-white" : "text-foreground")}>
          SmartSense
        </span>
        <span className={cn("mt-1 block text-[12px]", light ? "text-white/70" : "text-muted-foreground")}>Predict · Rest · Recover</span>
      </span>
    </Link>
  );
}

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  const styles: Record<string, string> = {
    primary: "bg-primary text-primary-foreground hover:opacity-90 shadow-[0_6px_16px_-6px_var(--color-primary)]",
    secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
    ghost: "bg-transparent text-foreground hover:bg-accent",
    danger: "bg-destructive text-destructive-foreground hover:opacity-90",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "min-h-8 px-3.5 py-1.5 text-xs" : "min-h-11 px-5 py-2.5 text-sm",
        styles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export type PillTone = "default" | "good" | "warn" | "danger" | "dark";

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: PillTone }) {
  const styles: Record<string, string> = {
    default: "bg-secondary text-secondary-foreground",
    good: "bg-success/15 text-success",
    warn: "bg-warning/20 text-warning",
    danger: "bg-destructive/15 text-destructive",
    dark: "bg-primary text-primary-foreground",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium", styles[tone])}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Card({
  children,
  className,
  tone,
  id,
}: {
  children: ReactNode;
  className?: string;
  tone?: "warn" | "danger" | "success" | "primary";
  id?: string;
}) {
  const toneStyles: Record<string, string> = {
    warn: "bg-warning/10",
    danger: "bg-destructive/10",
    success: "bg-success/10",
    primary: "bg-primary text-primary-foreground",
  };
  return (
    <section id={id} className={cn("soft-card scroll-mt-24 rounded-[1.75rem] bg-card p-5 sm:p-6", tone && toneStyles[tone], className)}>
      {children}
    </section>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-medium text-muted-foreground">{children}</p>;
}

export function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "danger" | "success" }) {
  return (
    <Card tone={tone} className="h-full">
      <SectionLabel>{label}</SectionLabel>
      <p className="mt-2 font-display text-2xl font-extrabold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

export function Gauge({ score, size = 220 }: { score: number; size?: number }) {
  const degrees = Math.round((score / 100) * 360);
  const tone = score >= 80 ? "var(--color-success)" : score >= 60 ? "var(--color-primary)" : score >= 40 ? "var(--color-warning)" : "var(--color-destructive)";
  return (
    <div className="relative mx-auto grid place-items-center" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-full transition-[background] duration-700"
        style={{ background: `conic-gradient(${tone} ${degrees}deg, var(--gauge-track) ${degrees}deg 360deg)` }}
      />
      <div className="soft-card absolute inset-[14px] rounded-full bg-card" />
      <div className="relative text-center">
        <span className="font-display text-5xl font-extrabold leading-none tracking-tight">{score}</span>
        <span className="ml-1 font-display text-lg font-semibold text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

export function Sparkline({ values, color = "var(--color-primary)", height = 100 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${100 - ((v - min) / range) * 100}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }} className="w-full overflow-visible">
      <polyline points={`0,100 ${points} 100,100`} fill={color} opacity="0.1" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Waveform({ variant = "eeg", height = 90, live = true }: { variant?: "eeg" | "eog" | "rest"; height?: number; live?: boolean }) {
  const paths: Record<string, string> = {
    eog: "M0 58 C24 58 28 57 37 35 S52 18 62 55 S84 77 104 55 S124 25 142 52 S166 82 190 57 S215 17 235 52 S258 78 280 56 S306 26 330 55 S355 74 380 56 S407 22 430 51 S455 79 480 55 S508 29 540 55 S565 72 600 53",
    rest: "M0 52 C30 48 40 56 60 50 S90 47 115 54 S145 58 170 50 S200 44 230 51 S260 58 285 48 S315 44 345 52 S375 59 405 50 S435 43 465 50 S500 59 530 51 S570 44 600 52",
    eeg: "M0 52 L14 48 L27 55 L41 38 L53 64 L65 47 L75 54 L86 44 L99 58 L111 27 L122 70 L134 48 L147 54 L161 43 L174 55 L187 49 L200 59 L213 34 L223 65 L237 48 L251 53 L263 42 L276 57 L290 46 L301 54 L314 29 L325 68 L337 48 L351 54 L365 42 L378 57 L391 47 L405 55 L418 36 L430 65 L444 48 L459 53 L473 43 L487 56 L500 48 L514 53 L528 34 L540 65 L555 48 L570 54 L586 44 L600 53",
  };
  return (
    <div className="overflow-hidden rounded-2xl bg-secondary/50" style={{ height }}>
      <svg viewBox="0 0 600 100" preserveAspectRatio="none" className="h-full w-full">
        <path
          d={paths[variant]}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          className={cn(variant === "eog" ? "text-success" : variant === "rest" ? "text-primary" : "text-primary", live && "signal-line")}
        />
      </svg>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-secondary text-muted-foreground">
        <Icon size={24} />
      </span>
      <h3 className="font-display text-lg font-bold">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
    </Card>
  );
}

export function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <SectionLabel>{eyebrow}</SectionLabel>
        <h2 className="mt-1.5 font-display text-3xl font-extrabold tracking-tight lg:text-4xl">{title}</h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function SafetyStageStrip() {
  const { state, dispatch, t } = useSmartSense();
  const order = ["DETECT", "PREDICT", "ALERT", "REST", "RECOVER", "RESUME"] as const;
  const stageFriendly: Record<string, string> = {
    DETECT: "Sensing", PREDICT: "Predicting", ALERT: "Alerting", REST: "Resting", RECOVER: "Recovering", RESUME: "Back on the road",
  };
  const stageCopy: Record<string, string> = {
    DETECT: "Reading EEG · EOG", PREDICT: "Watching the trend", ALERT: "Getting your attention", REST: "Finding a safe stop", RECOVER: "Tracking sleep quality", RESUME: "Ready to drive",
  };
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionLabel>Your safety journey</SectionLabel>
          <p className="mt-1 font-display text-lg font-bold">Predict · Rest · Recover</p>
        </div>
        <Pill tone="dark">{stageFriendly[state.safetyStage]}</Pill>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {order.map((stage) => (
          <button
            key={stage}
            onClick={() => dispatch({ type: "setStage", stage })}
            className={cn(
              "rounded-2xl p-3.5 text-left transition hover:-translate-y-0.5",
              state.safetyStage === stage ? "bg-primary/10 ring-2 ring-primary" : "bg-secondary/60",
            )}
          >
            <p className="font-display text-sm font-bold">{stageFriendly[stage]}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{stageCopy[stage]}</p>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">{t("prototypeNote")}</p>
    </Card>
  );
}

function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const { t, state } = useSmartSense();
  const location = useLocation();
  const content = (
    <div className="flex h-full flex-col p-5">
      <div className="pb-5">
        <Logo />
      </div>
      <div className="mb-5 rounded-2xl bg-secondary/70 p-3.5">
        <div className="flex items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-sm font-bold text-primary">
            <Heart size={18} fill="currentColor" strokeWidth={0} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold">{state.operatingMode === "DRIVING" ? "On the road" : "Taking a rest"}</p>
            <p className="truncate text-[12px] text-muted-foreground">{state.operatingMode === "DRIVING" ? t("drivingMode") : t("restMode")}</p>
          </div>
        </div>
        <div className="mt-3">
          <Pill tone="good">{state.dataSource === "SIMULATION" ? t("simulation") : t("live")}</Pill>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.labelKey}>
            <SectionLabel>{t(group.labelKey)}</SectionLabel>
            <div className="mt-2 space-y-1">
              {group.items.map(({ to, labelKey, icon: Icon }) => {
                const active = location.pathname === to;
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[14px] font-medium transition",
                      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Icon size={17} strokeWidth={1.8} />
                    {t(labelKey)}
                    {labelKey === "restManagement" && state.restDecision !== "CONTINUE" && (
                      <span className="ml-auto size-2 rounded-full bg-warning" />
                    )}
                    {labelKey === "alerts" && state.alerts.some((a) => !a.read) && (
                      <span className="ml-auto rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                        {state.alerts.filter((a) => !a.read).length}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-5 border-t border-border/60 pt-4">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          This is a demo experience with simulated data — not a real medical device.
        </p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[280px] p-4 lg:block">
        <div className="soft-card-lg sticky top-0 h-[calc(100vh-2rem)] overflow-hidden rounded-[1.75rem] bg-sidebar">{content}</div>
      </aside>
      <div className={cn("fixed inset-0 z-50 lg:hidden", mobileOpen ? "pointer-events-auto" : "pointer-events-none")}>
        <button
          className={cn("absolute inset-0 bg-black/30 transition-opacity", mobileOpen ? "opacity-100" : "opacity-0")}
          aria-label="Close menu"
          onClick={onClose}
        />
        <aside
          className={cn(
            "absolute inset-y-0 left-0 w-[280px] bg-sidebar shadow-2xl transition-transform",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          {content}
        </aside>
      </div>
    </>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { state, t, language, setLanguage, theme, setTheme } = useSmartSense();
  const location = useLocation();
  const current = navGroups.flatMap((g) => g.items).find((item) => item.to === location.pathname);
  return (
    <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-md">
      <div className="flex items-center gap-3 px-4 py-4 lg:px-8">
        <button className="grid size-10 place-items-center rounded-full bg-secondary text-muted-foreground hover:bg-accent lg:hidden" onClick={onMenu} aria-label="Toggle navigation">
          <Menu size={18} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate font-display text-lg font-bold tracking-tight sm:text-xl">{current ? t(current.labelKey) : t("overview")}</h1>
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Pill tone={state.operatingMode === "REST" ? "good" : "default"}>{state.operatingMode === "REST" ? t("restMode") : t("drivingMode")}</Pill>
          <span className="hidden sm:inline-flex">
            <Pill>{state.dataSource === "SIMULATION" ? t("simulation") : t("live")}</Pill>
          </span>
          <div className="hidden items-center gap-1 rounded-full bg-secondary/70 p-1 sm:flex">
            <Languages size={14} className="ml-1.5 text-muted-foreground" />
            <select
              aria-label="Language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              className="h-7 rounded-full bg-transparent px-1 text-xs text-foreground outline-none"
            >
              {Object.entries(languageNames).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="hidden items-center gap-1 rounded-full bg-secondary/70 p-1 sm:flex">
            <button
              aria-label="Light theme"
              onClick={() => setTheme("light" as ThemeMode)}
              className={cn("grid size-7 place-items-center rounded-full", theme === "light" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              <Sun size={13} />
            </button>
            <button
              aria-label="Dark theme"
              onClick={() => setTheme("dark" as ThemeMode)}
              className={cn("grid size-7 place-items-center rounded-full", theme === "dark" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              <Moon size={13} />
            </button>
            <button
              aria-label="Automatic theme"
              onClick={() => setTheme("system" as ThemeMode)}
              className={cn("grid size-7 place-items-center rounded-full", theme === "system" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              <GaugeIcon size={13} />
            </button>
          </div>
          <Link to="/settings" className="grid size-10 place-items-center rounded-full bg-primary font-display text-xs font-bold text-primary-foreground">
            <Heart size={16} fill="currentColor" strokeWidth={0} />
          </Link>
        </div>
      </div>
    </header>
  );
}

function NoWearableBanner() {
  const { state, dispatch } = useSmartSense();
  if (state.dataSource !== "LIVE" || state.eegStatus !== "DISCONNECTED") return null;
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col items-start gap-3 rounded-2xl bg-warning/10 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-warning/20 text-warning">
          <WifiOff size={16} />
        </span>
        <p className="text-sm text-warning">
          <span className="font-semibold">No wearable paired yet.</span> You're set to Live hardware mode in Settings, so
          readings are paused until a device connects.
        </p>
      </div>
      <Button size="sm" variant="secondary" className="shrink-0" onClick={() => dispatch({ type: "setDataSource", source: "SIMULATION" })}>
        Use simulated data
      </Button>
    </div>
  );
}

function AlarmBanner() {
  const { state, dispatch, alarmRinging } = useSmartSense();
  if (!alarmRinging) return null;
  return (
    <div className="sticky top-0 z-40 flex flex-col items-start gap-3 rounded-2xl bg-primary px-4 py-4 text-primary-foreground shadow-[0_10px_30px_-10px_var(--color-primary)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 animate-pulse place-items-center rounded-full bg-white/20">
          <AlarmClock size={18} />
        </span>
        <div>
          <p className="text-sm font-bold">Smart Alarm — time to wake up</p>
          <p className="text-xs text-primary-foreground/80">
            Vigilance score {state.recoveryAfter} — a good moment to wake was found. Ringing until you respond.
          </p>
        </div>
      </div>
      <Button size="sm" variant="secondary" className="shrink-0 bg-white text-primary hover:opacity-90" onClick={() => dispatch({ type: "wakeUp" })}>
        Stop alarm — I'm awake
      </Button>
    </div>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="lg:pl-[296px]">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="mx-auto max-w-[1440px] space-y-6 p-4 sm:p-6 lg:p-8">
          <AlarmBanner />
          <NoWearableBanner />
          {children}
        </main>
      </div>
    </div>
  );
}

export { X, ShieldCheck };
