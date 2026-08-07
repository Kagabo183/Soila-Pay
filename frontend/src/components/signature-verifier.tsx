"use client";

import * as React from "react";
import { ShieldCheck, ShieldAlert, KeyRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { verifyWebhookSignature, type VerifySignatureResult } from "@/lib/hmac";
import { useSettingsStore } from "@/store/settings-store";

const SAMPLE_PAYLOAD = JSON.stringify(
  {
    event: "collection.success",
    idempotency_key: "idem-7f3a9c1e",
    fineract_savings_account_id: "12345",
    amount_rwf: 5000,
    status: "SUCCESS",
    utility_token: "REG-AB12CD34EF56",
    timestamp: "2026-08-07T11:42:00Z",
  },
  null,
  2
);

export function SignatureVerifier() {
  const webhookSecret = useSettingsStore((s) => s.webhookSecret);
  const [payload, setPayload] = React.useState(SAMPLE_PAYLOAD);
  const [secret, setSecret] = React.useState(webhookSecret || "whsec_example_secret");
  const [signature, setSignature] = React.useState("");
  const [result, setResult] = React.useState<VerifySignatureResult | null>(null);
  const [verifying, setVerifying] = React.useState(false);

  async function generateExpected() {
    const res = await verifyWebhookSignature(payload, secret, "");
    setSignature(res.computedSignature);
    setResult(null);
  }

  async function handleVerify() {
    setVerifying(true);
    const res = await verifyWebhookSignature(payload, secret, signature);
    setResult(res);
    setVerifying(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Signature Verifier
        </CardTitle>
        <CardDescription>
          Runs entirely in your browser via the Web Crypto API - your payload and secret never
          leave this page.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Textarea
          label="Raw webhook payload (exact request body, as received)"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          className="min-h-40"
          spellCheck={false}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Webhook Secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            spellCheck={false}
          />
          <Input
            label="X-Moola-Signature header value"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="sha256=... or raw hex"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={generateExpected}>
            Compute expected signature
          </Button>
          <Button onClick={handleVerify} loading={verifying}>
            Verify Signature
          </Button>
        </div>

        {result && (
          <div
            className={`flex items-start gap-3 rounded-md border p-4 text-sm ${
              result.valid
                ? "border-success/30 bg-success/10 text-success"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            }`}
          >
            {result.valid ? (
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {result.valid ? "Signature is valid" : "Signature does not match"}
              </p>
              <p className="mt-1 break-all font-mono text-xs opacity-80">
                computed: {result.computedSignature}
              </p>
              <p className="mt-0.5 break-all font-mono text-xs opacity-80">
                provided: {result.providedSignature || "(empty)"}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
