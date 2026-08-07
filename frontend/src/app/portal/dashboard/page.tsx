"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  LogOut,
  Copy,
  Rocket,
  CheckCircle2,
  Clock,
  XCircle,
  Upload,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntegratorPortalGuard } from "@/components/layout/integrator-portal-guard";
import { CollectMoneyPanel } from "@/components/portal/collect-money-panel";
import { integratorPortalService } from "@/services/integrator-portal.service";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import { toast } from "@/store/toast-store";
import { cn } from "@/lib/utils";
import type { DocumentType, IntegratorDocument } from "@/types/api";

function maskApiKey(key: string): string {
  if (key.length <= 10) return key;
  return `${key.slice(0, 7)}${"*".repeat(10)}${key.slice(-4)}`;
}

function copyKey(key: string) {
  navigator.clipboard?.writeText(key);
  toast({ title: "Copied to clipboard", variant: "default" });
}

function ApiKeyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 font-mono text-sm">
        <span className="flex-1 break-all">{maskApiKey(value)}</span>
        <button onClick={() => copyKey(value)} className="text-muted-foreground hover:text-foreground">
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function DocumentUploadField({
  label,
  documentType,
  token,
  uploaded,
  onUploaded,
}: {
  label: string;
  documentType: DocumentType;
  token: string;
  uploaded: IntegratorDocument | undefined;
  onUploaded: (doc: IntegratorDocument) => void;
}) {
  const [uploading, setUploading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const doc = await integratorPortalService.uploadProductionDocument(token, documentType, file);
      onUploaded(doc);
      toast({ title: `${label} uploaded`, description: file.name, variant: "success" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Upload failed", variant: "error" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-1.5 flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={handleFileChange}
          className="hidden"
          id={`upload-${documentType}`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          {uploaded ? "Replace file" : "Upload file"}
        </Button>
        {uploaded ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> {uploaded.fileName}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">PDF, JPEG, or PNG - up to 5MB</span>
        )}
      </div>
    </div>
  );
}

function ProductionStatusPanel() {
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  const token = useIntegratorPortalStore((s) => s.token);
  const updateIntegrator = useIntegratorPortalStore((s) => s.updateIntegrator);
  const [businessLocation, setBusinessLocation] = React.useState("");
  const [ipWhitelist, setIpWhitelist] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [documents, setDocuments] = React.useState<IntegratorDocument[]>([]);

  React.useEffect(() => {
    if (!token) return;
    let mounted = true;
    integratorPortalService.listProductionDocuments(token).then((docs) => {
      if (mounted) setDocuments(docs);
    });
    return () => {
      mounted = false;
    };
  }, [token]);

  if (!integrator || !token) return null;

  const taxDoc = documents.find((d) => d.documentType === "TAX_CLEARANCE");
  const rdbDoc = documents.find((d) => d.documentType === "RDB_CERTIFICATE");
  const bothUploaded = Boolean(taxDoc && rdbDoc);

  function handleDocumentUploaded(doc: IntegratorDocument) {
    setDocuments((docs) => [...docs.filter((d) => d.documentType !== doc.documentType), doc]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    try {
      const updated = await integratorPortalService.submitProductionKyc(token, {
        businessLocation,
        ipWhitelist: ipWhitelist || undefined,
      });
      updateIntegrator(updated);
      toast({ title: "Submitted for review", description: "We'll notify you once it's approved.", variant: "success" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Submission failed", variant: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  if (integrator.productionStatus === "APPROVED" && integrator.productionApiKey) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-success">
            <CheckCircle2 className="h-4 w-4" /> You&apos;re live
          </CardTitle>
          <CardDescription>Use this key for real collections - it charges and moves real money.</CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeyRow label="Production API Key" value={integrator.productionApiKey} />
        </CardContent>
      </Card>
    );
  }

  if (integrator.productionStatus === "PENDING_REVIEW") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-warning">
            <Clock className="h-4 w-4" /> Under review
          </CardTitle>
          <CardDescription>
            Your business details were submitted and are awaiting operator approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div><p className="text-xs text-muted-foreground">Location</p><p>{integrator.businessLocation}</p></div>
          <div><p className="text-xs text-muted-foreground">Tax clearance</p><p>{integrator.taxClearanceReference}</p></div>
          <div><p className="text-xs text-muted-foreground">RDB certificate</p><p>{integrator.rdbCertificateReference}</p></div>
          <div><p className="text-xs text-muted-foreground">IP whitelist</p><p>{integrator.ipWhitelist || "-"}</p></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="h-4 w-4" /> Go live
        </CardTitle>
        <CardDescription>
          Submit your business details for review to unlock a production API key.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {integrator.productionStatus === "REJECTED" && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Your previous submission was rejected{integrator.productionRejectionReason ? `: ${integrator.productionRejectionReason}` : "."} Please review and resubmit.
            </span>
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input label="Business location" value={businessLocation} onChange={(e) => setBusinessLocation(e.target.value)} placeholder="Kigali, Nyarugenge" required />
          <DocumentUploadField
            label="Tax clearance certificate"
            documentType="TAX_CLEARANCE"
            token={token}
            uploaded={taxDoc}
            onUploaded={handleDocumentUploaded}
          />
          <DocumentUploadField
            label="RDB certificate"
            documentType="RDB_CERTIFICATE"
            token={token}
            uploaded={rdbDoc}
            onUploaded={handleDocumentUploaded}
          />
          <Input label="IP whitelist (optional)" value={ipWhitelist} onChange={(e) => setIpWhitelist(e.target.value)} placeholder="203.0.113.10, 203.0.113.11" />
          <Button type="submit" loading={submitting} disabled={!bothUploaded} className="w-fit">
            Submit for review
          </Button>
          {!bothUploaded && (
            <p className="text-xs text-muted-foreground">Upload both documents above to enable submission.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function DashboardContent() {
  const router = useRouter();
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  const clearSession = useIntegratorPortalStore((s) => s.clearSession);
  const [tab, setTab] = React.useState<"sandbox" | "production">("sandbox");

  if (!integrator) return null;

  function handleLogout() {
    clearSession();
    router.push("/portal/login");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Zap className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-foreground">{integrator.name}</p>
            <p className="text-[11px] text-muted-foreground">Integrator Portal</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          <LogOut className="h-4 w-4" /> Log out
        </Button>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <div className="flex gap-2 rounded-lg border border-border bg-secondary/40 p-1">
          <button
            onClick={() => setTab("sandbox")}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              tab === "sandbox" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Sandbox
          </button>
          <button
            onClick={() => setTab("production")}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              tab === "production" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Go Live
          </button>
        </div>

        {tab === "sandbox" ? (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Sandbox API Key</CardTitle>
                <CardDescription>
                  Send this as the <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">Integrator-Key</code> header
                  on <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">POST /api/v1/collection/collect</code> - always
                  routes to the safe simulated provider, never real money.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ApiKeyRow label="Sandbox API Key" value={integrator.sandboxApiKey} />
              </CardContent>
            </Card>
            <CollectMoneyPanel integratorApiKey={integrator.sandboxApiKey} />
          </div>
        ) : (
          <ProductionStatusPanel />
        )}
      </div>
    </div>
  );
}

export default function IntegratorDashboardPage() {
  return (
    <IntegratorPortalGuard>
      <DashboardContent />
    </IntegratorPortalGuard>
  );
}
