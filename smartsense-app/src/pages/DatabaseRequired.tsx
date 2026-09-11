import { Database } from "lucide-react";

export default function DatabaseRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="soft-card-lg w-full max-w-lg rounded-[1.75rem] bg-card p-8 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-warning/15 text-warning">
          <Database size={22} />
        </span>
        <h1 className="mt-4 font-display text-xl font-bold">Database setup needed</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          SmartSense now signs drivers in with a real account, which means a connected Supabase project is required to
          run the app — there's no demo/anonymous mode anymore.
        </p>
        <ol className="mt-5 space-y-2 text-left text-sm text-muted-foreground">
          <li>1. Create a free project at supabase.com and run <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">supabase/migrations/0001_init_schema.sql</code> in its SQL Editor.</li>
          <li>2. Copy your Project URL and anon/publishable key from Project Settings → API Keys.</li>
          <li>3. Put them in <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">.env.local</code> as <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">VITE_SUPABASE_URL</code> and <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">VITE_SUPABASE_ANON_KEY</code>.</li>
          <li>4. Restart the dev server.</li>
        </ol>
        <p className="mt-5 text-xs text-muted-foreground">See the README for the full walkthrough.</p>
      </div>
    </div>
  );
}
