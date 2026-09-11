import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/AppShell";
import { signInWithPassword, useAuthSession } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

export default function Login() {
  const { status } = useAuthSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "signed-in") return <Navigate to="/" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signInWithPassword(email.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't sign you in — check your email and password.");
    }
    // On success, useAuthSession's listener flips status to "signed-in" and
    // the Navigate above takes over.
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Heart size={20} fill="currentColor" strokeWidth={0} />
          </span>
          <div className="text-center">
            <p className="text-[16px] font-bold leading-none tracking-tight">SmartSense</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Predict · Rest · Recover</p>
          </div>
        </div>

        <div className="soft-card-lg rounded-[1.75rem] bg-card p-6 sm:p-8">
          <h1 className="font-display text-xl font-bold">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Welcome back — pick up where you left off.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field label="Email">
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl bg-secondary/60 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </Field>
            <Field label="Password">
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl bg-secondary/60 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Your password"
                autoComplete="current-password"
              />
            </Field>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {!isSupabaseConfigured && <p className="text-sm text-warning">Database isn't configured — see the README to connect Supabase before signing in.</p>}

            <Button type="submit" className="w-full" disabled={submitting || !isSupabaseConfigured}>
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link to="/register" className="font-semibold text-primary">
              Create one
            </Link>
          </p>
        </div>
        <p className="mt-6 text-center text-[11px] text-muted-foreground">This is a demo experience with simulated data — not a real medical device.</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
