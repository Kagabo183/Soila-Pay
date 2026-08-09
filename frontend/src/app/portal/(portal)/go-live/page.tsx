"use client";

import * as React from "react";
import { Rocket, CheckCircle2, Clock, XCircle, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { integratorPortalService } from "@/services/integrator-portal.service";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import { toast } from "@/store/toast-store";
import type { DocumentType, IntegratorDocument } from "@/types/api";

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
      toast({ title: `${label} uploaded`, variant: "success" });
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
        <Button type="button" variant="outline" size="sm" loading={uploading}
          onClick={() => inputRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" />
          {uploaded ? "Replace file" : "Upload file"}
        </Button>
        {uploaded ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> {uploaded.fileName}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">PDF, JPEG, or PNG — max 5 MB</span>
        )}
      </div>
    </div>
  );
}

export default function PortalGoLivePage() {
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
    return () => { mounted = false; };
  }, [token]);

  if (!integrator || !token) return null;

  const taxDoc = documents.find((d) => d.documentType === "TAX_CLEARANCE");
  const rdbDoc = documents.find((d) => d.documentType === "RDB_CERTIFICATE");

  function handleDocUploaded(doc: IntegratorDocument) {
    setDocuments((prev) => [...prev.filter((d) => d.documentType !== doc.documentType), doc]);
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
      toast({ title: "Submitted for review", variant: "success" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Submission failed", variant: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  if (integrator.productionStatus === "APPROVED" && integrator.productionApiKey) {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Go Live</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-4 w-4" /> You&apos;re live
            </CardTitle>
            <CardDescription>Your production key is active. Use it for real collections.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (integrator.productionStatus === "PENDING_REVIEW") {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Go Live</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <Clock className="h-4 w-4" /> Under review
            </CardTitle>
            <CardDescription>Your submission is being reviewed by Soila Pay.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Location</p><p>{integrator.businessLocation}</p></div>
            <div><p className="text-xs text-muted-foreground">Tax clearance</p><p>{integrator.taxClearanceReference}</p></div>
            <div><p className="text-xs text-muted-foreground">RDB certificate</p><p>{integrator.rdbCertificateReference}</p></div>
            <div><p className="text-xs text-muted-foreground">IP whitelist</p><p>{integrator.ipWhitelist || "—"}</p></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Go Live</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Submit your business details to unlock a production API key.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-4 w-4" /> Production application
          </CardTitle>
          {integrator.productionStatus === "REJECTED" && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Your previous submission was rejected
                {integrator.productionRejectionReason ? `: ${integrator.productionRejectionReason}` : "."} Please revise and resubmit.
              </span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <Input label="Business location" value={businessLocation}
              onChange={(e) => setBusinessLocation(e.target.value)}
              placeholder="Kigali, Nyarugenge" required />
            <DocumentUploadField label="Tax clearance certificate" documentType="TAX_CLEARANCE"
              token={token} uploaded={taxDoc} onUploaded={handleDocUploaded} />
            <DocumentUploadField label="RDB certificate" documentType="RDB_CERTIFICATE"
              token={token} uploaded={rdbDoc} onUploaded={handleDocUploaded} />
            <Input label="IP whitelist (optional)" value={ipWhitelist}
              onChange={(e) => setIpWhitelist(e.target.value)}
              placeholder="203.0.113.10, 203.0.113.11" />
            <div>
              <Button type="submit" loading={submitting} disabled={!taxDoc || !rdbDoc} className="w-fit">
                Submit for review
              </Button>
              {(!taxDoc || !rdbDoc) && (
                <p className="mt-2 text-xs text-muted-foreground">Upload both documents to enable submission.</p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
