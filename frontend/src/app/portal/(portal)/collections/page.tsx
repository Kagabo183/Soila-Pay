"use client";

import { CollectMoneyPanel } from "@/components/portal/collect-money-panel";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";

export default function PortalCollectionsPage() {
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  const fineractAccountId = useIntegratorPortalStore((s) => s.fineractAccountId);

  if (!integrator) return null;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Collections</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Test and run collection requests using your sandbox API key.
        </p>
      </div>
      <CollectMoneyPanel
        integratorApiKey={integrator.sandboxApiKey}
        defaultFineractAccountId={fineractAccountId}
      />
    </div>
  );
}
