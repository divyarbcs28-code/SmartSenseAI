import { Link } from "react-router-dom";
import { Button } from "@/components/AppShell";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center text-foreground">
      <h1 className="font-display text-7xl font-extrabold">404</h1>
      <h2 className="text-xl font-semibold">Page not found</h2>
      <p className="max-w-md text-sm text-muted-foreground">The page you're looking for doesn't exist or has been moved.</p>
      <Link to="/">
        <Button>Go to Overview</Button>
      </Link>
    </div>
  );
}
