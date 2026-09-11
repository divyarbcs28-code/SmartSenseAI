import { useState } from "react";
import { AlertTriangle, ArrowUpRight, CarFront, CheckCircle2, Loader2, Moon, Sparkles, Sunrise } from "lucide-react";
import { Button, Card, DashboardShell, PageIntro, Pill, SectionLabel, Waveform } from "@/components/AppShell";
import { nextOccurrenceOf, sleepStateFriendly, useSmartSense, type SleepState } from "@/lib/smartsense";

// ---------------------------------------------------------------------------
// Real-backend "Analyze Sleep" integration. Deliberately self-contained and
// local to this page (not wired into the global SmartSense reducer): a click
// asks the ML backend (FastAPI + XGBoost, running locally) for ONE fresh
// prediction and this page shows it, in the same Sleep State / "How you're
// resting" UI that's already here. Today the backend answers using a random
// row of its test dataset; later, once real EEG/EOG hardware exists, only
// the backend's data-selection step changes — this page, the endpoint URL,
// and the response shape it expects all stay exactly the same.
// ---------------------------------------------------------------------------
const ML_BACKEND_URL = "http://127.0.0.1:8000";

interface MlAnalysis {
  prediction: "N2" | "Non-N2";
  n2Probability: number;
  confidence: number;
  rowIndex: number | null;
}

export default function SleepRecovery() {
  const { state, dispatch, t } = useSmartSense();
  const inRest = state.operatingMode === "REST";
  const satisfied = state.wakeStatus === "SATISFIED";

  const [analysis, setAnalysis] = useState<MlAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  async function runAnalysis() {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await fetch(`${ML_BACKEND_URL}/random-test-prediction`);
      if (!res.ok) {
        let detail = `Backend returned HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (typeof body?.detail === "string") detail = body.detail;
          else if (body?.detail) detail = JSON.stringify(body.detail);
        } catch {
          // Response wasn't JSON — fall back to the HTTP status above.
        }
        throw new Error(detail);
      }
      const data = await res.json();
      if (typeof data?.n2_probability !== "number" || typeof data?.prediction !== "string") {
        throw new Error("Backend response was missing the expected prediction fields.");
      }
      setAnalysis({
        prediction: data.prediction === "N2" ? "N2" : "Non-N2",
        n2Probability: data.n2_probability,
        confidence: typeof data.confidence === "number" ? data.confidence : 0,
        rowIndex: typeof data.row_index === "number" ? data.row_index : null,
      });
    } catch (err) {
      // fetch() rejects with a TypeError specifically when the request never reached a server
      // (backend not running, wrong port, CORS blocked) — everything else is the backend
      // responding with an actual failure, so the two get distinct messages.
      const unreachable = err instanceof TypeError;
      setAnalysisError(
        unreachable
          ? `Can't reach the ML backend at ${ML_BACKEND_URL}. Make sure it's running (python -m uvicorn main:app --reload from the backend folder).`
          : `Prediction failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setAnalyzing(false);
    }
  }

  // The last manual analysis (if any) takes over the existing Sleep State / "How you're resting"
  // display; otherwise those keep showing the simulated in-browser state, exactly as before.
  const displaySleepState: SleepState = analysis ? (analysis.prediction === "N2" ? "N2" : "NON_N2") : state.sleepState;

  // Deadline check — informational only, never shortens the recommended wake window. Estimated
  // arrival = end of the wake window + the last-known driving time to the Trip Planner destination.
  const deadline = state.arriveByTime ? nextOccurrenceOf(state.arriveByTime) : null;
  const wakeEnd = nextOccurrenceOf(state.wakeWindowEnd);
  const estimatedArrival = wakeEnd && state.tripDurationMin != null ? new Date(wakeEnd.getTime() + state.tripDurationMin * 60000) : null;
  const deadlineTight = inRest && deadline && estimatedArrival ? estimatedArrival.getTime() > deadline.getTime() : false;

  return (
    <DashboardShell>
      <PageIntro
        eyebrow={t("sleepRecovery")}
        title={t("sleepRecovery")}
        description="How your rest is going, and when you'll be ready to drive again."
        action={<Pill tone={inRest ? "good" : "default"}>{inRest ? "Rest session active" : "Not currently resting"}</Pill>}
      />

      {!inRest && (
        <Card>
          <p className="text-sm text-muted-foreground">
            SmartSense switches to Rest Mode automatically once you arrive at a recommended rest spot from{" "}
            <b>{t("restManagement")}</b>. Sleep tracking and smart wake-up become active during that session.
          </p>
        </Card>
      )}

      <section className="grid gap-6 sm:grid-cols-3">
        <Card>
          <SectionLabel>{t("sleepDuration")}</SectionLabel>
          <p className="mt-2 font-display text-3xl font-extrabold">{state.restSessionMinutes} min</p>
        </Card>
        <Card>
          <SectionLabel>{t("sleepState")}</SectionLabel>
          <p className="mt-2 font-display text-2xl font-extrabold">{sleepStateFriendly[displaySleepState]}</p>
        </Card>
        <Card>
          <SectionLabel>Wearable</SectionLabel>
          <p className="mt-2 font-display text-2xl font-extrabold">Monitoring</p>
          <Pill tone={state.eegStatus === "CONNECTED" ? "good" : "warn"}>{state.eegStatus === "CONNECTED" ? t("connected") : "Not paired"}</Pill>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-7">
        <Card className="xl:col-span-4">
          <SectionLabel>How you're resting</SectionLabel>
          <p className="mt-1 font-display text-lg font-bold">
            {displaySleepState === "N2" ? "You've reached deep, restful sleep." : displaySleepState === "NON_N2" ? "You're in light sleep." : "You're still settling in."}
          </p>
          <div className="mt-5">
            <Waveform variant="rest" height={130} live={inRest} />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            We wait for a steady, stable rest before considering waking you — never on a single fluky reading.
          </p>

          <div className="mt-5 border-t border-border/60 pt-5">
            <Button variant="secondary" onClick={runAnalysis} disabled={analyzing}>
              {analyzing ? (
                <>
                  Analyzing… <Loader2 size={15} className="animate-spin" />
                </>
              ) : (
                <>
                  Analyze Sleep <Moon size={15} />
                </>
              )}
            </Button>

            {analysisError && (
              <div className="mt-3 flex items-start gap-3 rounded-2xl bg-destructive/10 p-3.5">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
                <p className="text-xs leading-relaxed text-destructive">{analysisError}</p>
              </div>
            )}

            {analysis && !analysisError && (
              <p className="mt-3 text-xs text-muted-foreground">
                Last analysis from the ML backend: <b>{analysis.prediction}</b> · {analysis.confidence.toFixed(1)}% confidence.
              </p>
            )}
          </div>
        </Card>

        <Card className="xl:col-span-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Sunrise size={18} />
            </span>
            <div>
              <SectionLabel>{t("wakeWindow")}</SectionLabel>
              <h3 className="font-display text-lg font-bold">
                {state.wakeWindowStart} — {state.wakeWindowEnd}
              </h3>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Recomputed live from your current vigilance score and recovery rate — not a fixed alarm that might catch you mid-sleep.
            {state.arriveByTime && " It's never shortened to meet an arrival time, even if your deadline is tight — see below."}
          </p>
          <div className="mt-5 h-2 rounded-full bg-secondary">
            <div className={`h-full rounded-full transition-all duration-500 ${satisfied ? "w-[72%] bg-success" : "w-[38%] bg-primary"}`} />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {satisfied ? "A good moment to wake was found." : "Still watching for the right moment…"}
          </p>
          {deadlineTight && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl bg-warning/10 p-3.5">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
              <p className="text-xs leading-relaxed text-warning">
                Based on your recovery so far, waking at the end of this window and then driving to{" "}
                <b>{state.destination?.name ?? "your destination"}</b> would land after your {state.arriveByTime} arrival target.
                SmartSense won't cut your rest short to help — consider a later arrival time instead.
              </p>
            </div>
          )}
          <div className="mt-5">
            {satisfied ? (
              <Button className="w-full" onClick={() => dispatch({ type: "wakeUp" })}>
                {t("wakeUp")} <Sunrise size={15} />
              </Button>
            ) : (
              <Button className="w-full" variant="secondary" onClick={() => dispatch({ type: "setWakeStatus", status: "SATISFIED" })}>
                {t("simulateCondition")} <CheckCircle2 size={15} />
              </Button>
            )}
          </div>
        </Card>
      </section>

      <Card className="overflow-hidden">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <SectionLabel>Recovery comparison</SectionLabel>
            <div className="mt-6 flex items-end gap-5">
              <div>
                <p className="font-display text-5xl font-extrabold text-muted-foreground">{state.recoveryBefore}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{t("recoveryBefore")}</p>
              </div>
              <ArrowUpRight className="mb-5 text-success" size={24} />
              <div>
                <p className="font-display text-6xl font-extrabold text-success">{state.recoveryAfter}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{t("recoveryAfter")}</p>
              </div>
            </div>
            <div className="mt-6 h-3 rounded-full bg-secondary">
              <div className="h-full rounded-full bg-success" style={{ width: `${state.recoveryAfter}%` }} />
            </div>
          </div>
          <div className="rounded-2xl bg-success/10 p-6">
            <Sparkles className="text-success" size={24} />
            <h3 className="mt-4 font-display text-2xl font-bold">{satisfied ? "Recovery improved" : "Recovery in progress"}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              This shows how much more ready to drive you are after resting. Always confirm you feel alert and check your
              surroundings before continuing — this is a wellness indicator, not a fitness-to-drive certification.
            </p>
            {satisfied && (
              <Button className="mt-6" onClick={() => dispatch({ type: "resume" })}>
                {t("resumeDriving")} <CarFront size={15} />
              </Button>
            )}
          </div>
        </div>
      </Card>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Moon size={13} /> Sleep insights are simulated for this demo and update automatically while you rest.
      </p>
    </DashboardShell>
  );
}
