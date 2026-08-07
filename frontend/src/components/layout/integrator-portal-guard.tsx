"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import { useMounted } from "@/hooks/use-mounted";
import { Loader2 } from "lucide-react";

export function IntegratorPortalGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isAuthenticated = useIntegratorPortalStore((s) => s.isAuthenticated);
  const mounted = useMounted();

  React.useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.replace("/portal/login");
    }
  }, [mounted, isAuthenticated, router]);

  if (!mounted || !isAuthenticated) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
