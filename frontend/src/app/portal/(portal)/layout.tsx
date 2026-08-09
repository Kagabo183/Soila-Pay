import { IntegratorPortalGuard } from "@/components/layout/integrator-portal-guard";
import { PortalShell } from "@/components/layout/portal-shell";

export default function PortalGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <IntegratorPortalGuard>
      <PortalShell>{children}</PortalShell>
    </IntegratorPortalGuard>
  );
}
