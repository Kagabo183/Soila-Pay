"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Zap, Lock, User as UserIcon, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { authService } from "@/services/auth.service";
import { useAuthStore } from "@/store/auth-store";
import { toast } from "@/store/toast-store";

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (isAuthenticated) router.replace("/dashboard");
  }, [isAuthenticated, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { user, tokens } = await authService.login({ username, password });
      setSession(user, tokens);
      toast({ title: `Welcome back, ${user.displayName}`, variant: "success" });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Zap className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-semibold text-foreground">Soila Pay Console</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to manage collections, disbursements &amp; API integrations
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              leftIcon={<UserIcon className="h-4 w-4" />}
              autoComplete="username"
              placeholder="superadmin"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              leftIcon={<Lock className="h-4 w-4" />}
              autoComplete="current-password"
              placeholder="Enter your password"
              required
            />
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" loading={loading} className="mt-1 w-full">
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Are you an integrator, not Soila Pay staff?{" "}
          <Link href="/portal/login" className="font-medium text-primary hover:underline">
            Go to the Integrator Portal
          </Link>
        </p>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            Mock authentication - only the superadmin credential configured in{" "}
            <code className="rounded bg-secondary px-1 py-0.5 font-mono">auth.service.ts</code>{" "}
            signs in, issuing a mock JWT access/refresh token pair. Swap that file to call the
            real endpoint when ready.
          </span>
        </div>
      </div>
    </div>
  );
}
