"use client";

import * as React from "react";
import { Save, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import { toast } from "@/store/toast-store";

export default function PortalAccountPage() {
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  const fineractAccountId = useIntegratorPortalStore((s) => s.fineractAccountId);
  const setFineractAccountId = useIntegratorPortalStore((s) => s.setFineractAccountId);

  const [accountId, setAccountId] = React.useState(fineractAccountId);

  if (!integrator) return null;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId.trim()) return;
    setFineractAccountId(accountId.trim());
    toast({ title: "Fineract account ID saved", variant: "success" });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Account Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your integrator account details.</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Business name</p>
            <p className="mt-0.5 font-medium text-foreground">{integrator.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Phone number</p>
            <p className="mt-0.5 font-medium text-foreground">{integrator.phoneNumber ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fee percentage</p>
            <p className="mt-0.5 font-medium text-foreground">{integrator.feePercentage}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">IP whitelist</p>
            <p className="mt-0.5 font-medium text-foreground">{integrator.ipWhitelist || "Not set"}</p>
          </div>
        </CardContent>
      </Card>

      {/* Fineract savings account */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Fineract Savings Account
          </CardTitle>
          <CardDescription>
            Set the Fineract savings account ID that will be debited when you initiate a
            collection. This is your float account — it must have sufficient RWF balance.
            Contact Soila Pay to have your account created and funded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="flex items-end gap-3">
            <Input
              label="Account ID"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="e.g. 1"
              className="w-36 font-mono"
              required
            />
            <Button type="submit" size="sm" className="mb-0.5">
              <Save className="h-3.5 w-3.5" /> Save
            </Button>
          </form>
          {fineractAccountId && (
            <p className="mt-2 text-xs text-muted-foreground">
              Currently saved:{" "}
              <span className="font-mono text-foreground">{fineractAccountId}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
