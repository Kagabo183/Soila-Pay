"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Zap, Lock, User as UserIcon, Phone, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { integratorPortalService } from "@/services/integrator-portal.service";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import { toast } from "@/store/toast-store";

export default function IntegratorSignupPage() {
  const router = useRouter();
  const setSession = useIntegratorPortalStore((s) => s.setSession);
  const isAuthenticated = useIntegratorPortalStore((s) => s.isAuthenticated);
  const [name, setName] = React.useState("");
  const [phoneNumber, setPhoneNumber] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (isAuthenticated) router.replace("/portal/dashboard");
  }, [isAuthenticated, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, integrator } = await integratorPortalService.signup({
        name,
        phoneNumber,
        password,
      });
      setSession(token, integrator);
      toast({ title: `Welcome, ${integrator.name}`, description: "Your sandbox API key is ready.", variant: "success" });
      router.push("/portal/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
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
          <h1 className="text-lg font-semibold text-foreground">Become a Soila Pay Integrator</h1>
          <p className="text-sm text-muted-foreground">
            Sign up with your phone number and start testing collections in sandbox right away.
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Business or contact name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              leftIcon={<UserIcon className="h-4 w-4" />}
              placeholder="Acme Aggregator"
              required
            />
            <Input
              label="Phone number"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              leftIcon={<Phone className="h-4 w-4" />}
              placeholder="0788123456"
              autoComplete="tel"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              leftIcon={<Lock className="h-4 w-4" />}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              minLength={8}
              required
            />
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" loading={loading} className="mt-1 w-full">
              Create sandbox account
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/portal/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </p>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            No documents needed to start testing. Going live requires submitting your business
            details for review from your dashboard.
          </span>
        </div>
      </div>
    </div>
  );
}
