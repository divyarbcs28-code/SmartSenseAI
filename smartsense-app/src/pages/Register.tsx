import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { Heart, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/AppShell";
import { registerWithPassword, useAuthSession } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

export default function Register() {
  const { status } = useAuthSession();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  if (status === "signed-in") return <Navigate to="/" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    const result = await registerWithPassword(fullName.trim(), email.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't create your account — try again.");
      return;
    }
    if (result.needsEmailConfirmation) {
      setCheckEmail(true);
    }
    // On success with an immediate session, useAuthSession's listener flips
    // status to "signed-in" and the Navigate above takes over.
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
          {checkEmail ? (
            <div className="text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
                <Mail size={22} />
              </span>
              <h1 className="mt-4 font-display text-xl font-bold">Check your inbox</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a confirmation link to <span className="font-semibold text-foreground">{email}</span>. Click it,
                then come back and sign in.
              </p>
              <Link to="/login" className="mt-6 inline-block">
                <Button className="w-full">Go to sign in</Button>
              </Link>
            </div>
          ) : (
            <>
              <h1 className="font-display text-xl font-bold">Create your account</h1>
              <p className="mt-1 text-sm text-muted-foreground">Set up SmartSense to start monitoring your drives.</p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <Field label="Full name">
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-xl bg-secondary/60 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Your name"
                    autoComplete="name"
                  />
                </Field>
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
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Confirm password">
                  <input
                    required
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-xl bg-secondary/60 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                  />
                </Field>

                {error && <p className="text-sm text-destructive">{error}</p>}
                {!isSupabaseConfigured && <p className="text-sm text-warning">Database isn't configured — see the README to connect Supabase before accounts can be created.</p>}

                <Button type="submit" className="w-full" disabled={submitting || !isSupabaseConfigured}>
                  {submitting ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Creating account…
                    </>
                  ) : (
                    "Create account"
                  )}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link to="/login" className="font-semibold text-primary">
                  Sign in
                </Link>
              </p>
            </>
          )}
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
