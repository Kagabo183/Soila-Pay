import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DdinConnectionInfo } from "@/services/ddin-diagnostics.service";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

export function ConnectionDetailsCard({
  info,
  middlewareUrl,
}: {
  info: DdinConnectionInfo | null;
  middlewareUrl: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connection Details</CardTitle>
        <CardDescription>Where this check actually points, and how it authenticates.</CardDescription>
      </CardHeader>
      <CardContent>
        {!info ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="flex flex-col">
            <Row label="Middleware URL" value={middlewareUrl} />
            <Row label="DDIN Base URL" value={info.ddinBaseUrl} />
            <Row label="API Path Version" value={info.apiPathVersion} />
            <Row label="Environment" value={info.environment} />
            <Row label="Authentication Method" value={info.authenticationMethod} />
            <Row
              label="TLS"
              value={
                <StatusBadge variant={info.tlsEnabled ? "success" : "destructive"}>
                  {info.tlsEnabled ? "Enabled (https)" : "Disabled (http)"}
                </StatusBadge>
              }
            />
            <Row label="Request Timeout" value={`${info.requestTimeoutSeconds}s`} />
            <Row label="Retry Policy" value={info.retryPolicy} />
            <Row
              label="Credentials Configured"
              value={
                <StatusBadge variant={info.credentialsConfigured ? "success" : "destructive"}>
                  {info.credentialsConfigured ? "Yes" : "No"}
                </StatusBadge>
              }
            />
            <Row
              label="Webhook Secret Configured"
              value={
                <StatusBadge variant={info.webhookSecretConfigured ? "success" : "outline"}>
                  {info.webhookSecretConfigured ? "Yes" : "Not set"}
                </StatusBadge>
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
