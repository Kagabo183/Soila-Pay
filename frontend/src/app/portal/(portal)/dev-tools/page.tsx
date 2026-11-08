"use client";

import { ApiDocs } from "@/components/payments/api-docs";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";

export default function PortalApiDocsPage() {
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  return <ApiDocs integratorKey={integrator?.sandboxApiKey} />;
}
