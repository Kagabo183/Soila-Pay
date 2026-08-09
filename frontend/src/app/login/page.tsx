"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Zap, Lock, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { authService } from "@/services/auth.service";
import { integratorPortalService } from "@/services/integrator-portal.service";
import { useAuthStore } from "@/store/auth-store";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import { toast } from "@/store/toast-store";

export default function LoginPage() {
  const router = useRouter();
  const setAdminSession = useAuthStore((s) => s.setSession);
  const isAdmin = useAuthStore((s) => s.isAuthenticated);
  const setPortalSession = useIntegratorPortalStore((s) => s.setSession);
  const isPortal = useIntegratorPortalStore((s) => s.isAuthenticated);

  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (isAdmin) router.replace("/dashboard");
    else if (isPortal) router.replace("/portal/dashboard");
  }, [isAdmin, isPortal, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password) return;
    setError(null);
    setLoading(true);

    // Try admin auth first
    try {
      const { user, tokens } = await authService.login({ username: identifier.trim(), password });
      setAdminSession(user, tokens);
      toast({ title: `Welcome back, ${user.displayName}`, variant: "success" });
      router.push("/dashboard");
      return;
    } catch {
      // Not an admin — try integrator portal
    }

    // Try integrator portal auth
    try {
      const { token, integrator } = await integratorPortalService.login({
        phoneNumber: identifier.trim(),
        password,
      });
      setPortalSession(token, integrator);
      toast({ title: `Welcome, ${integrator.name}`, variant: "success" });
      router.push("/portal/dashboard");
      return;
    } catch {
      // Both failed
    }

    setError("Invalid credentials. Please check your details and try again.");
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Zap className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-semibold text-foreground">Soila Pay</h1>
          <p className="text-sm text-muted-foreground">Sign in to your account</p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Username or phone number"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              leftIcon={<UserIcon className="h-4 w-4" />}
              autoComplete="username"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              leftIcon={<Lock className="h-4 w-4" />}
              autoComplete="current-password"
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
          New integrator?{" "}
          <Link href="/portal/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
