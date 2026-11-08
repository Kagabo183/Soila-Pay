"use client";

import * as React from "react";
import { Plus, Pencil, Copy, TrendingUp, ArrowUpRight, Users, Wallet, FileText } from "lucide-react";
import { PricingPanel } from "@/components/payments/pricing-panel";
import { NewIntegratorDialog } from "@/components/integrators/new-integrator-dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { integratorsService } from "@/services/integrators.service";
import { toast } from "@/store/toast-store";
import type { Integrator, IntegratorDocument, IntegratorSummary } from "@/types/api";

function formatRwf(value: number): string {
  return new Intl.NumberFormat("en-RW", { maximumFractionDigits: 0 }).format(value) + " RWF";
}

function maskApiKey(key: string): string {
  if (key.length <= 10) return key;
  return `${key.slice(0, 7)}${"*".repeat(10)}${key.slice(-4)}`;
}

export default function IntegratorsPage() {
  const confirm = useConfirm();
  const [integrators, setIntegrators] = React.useState<Integrator[]>([]);
  const [summary, setSummary] = React.useState<IntegratorSummary[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Integrator | null>(null);
  const [nameDraft, setNameDraft] = React.useState("");
  // Admin-only identity fields + Account Mode (edit only).
  const [emailDraft, setEmailDraft] = React.useState("");
  const [usernameDraft, setUsernameDraft] = React.useState("");
  const [modeDraft, setModeDraft] = React.useState<"TEST" | "PRODUCTION">("TEST");
  const [phoneDraft, setPhoneDraft] = React.useState("");
  const [passwordDraft, setPasswordDraft] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [revealedKey, setRevealedKey] = React.useState<string | null>(null);
  const [documentsByIntegrator, setDocumentsByIntegrator] = React.useState<Record<number, IntegratorDocument[]>>({});

  async function loadDocuments(integratorList: Integrator[]) {
    // Only integrators that submitted at least once have documents worth fetching.
    const candidates = integratorList.filter((i) => i.productionStatus !== "NOT_SUBMITTED");
    const entries = await Promise.all(
      candidates.map(async (i) => [i.id, await integratorsService.listDocuments(i.id)] as const)
    );
    setDocumentsByIntegrator(Object.fromEntries(entries));
  }

  async function refresh() {
    setLoading(true);
    const [integratorList, summaryList] = await Promise.all([integratorsService.list(), integratorsService.summary()]);
    setIntegrators(integratorList);
    setSummary(summaryList);
    setLoading(false);
    await loadDocuments(integratorList);
  }

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      const [integratorList, summaryList] = await Promise.all([integratorsService.list(), integratorsService.summary()]);
      if (!mounted) return;
      setIntegrators(integratorList);
      setSummary(summaryList);
      setLoading(false);
      await loadDocuments(integratorList);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  function openCreate() {
    setCreateOpen(true);
  }

  function openEdit(integrator: Integrator) {
    setEditing(integrator);
    setNameDraft(integrator.name);
    setEmailDraft(integrator.email ?? "");
    setPhoneDraft(integrator.phoneNumber ?? "");
    setUsernameDraft(integrator.username ?? "");
    setModeDraft(integrator.accountMode);
    setPasswordDraft("");
    setModalOpen(true);
  }

  async function handleSaveIntegrator() {
    // Fees are set in the Pricing section below (collections + payouts).
    if (!nameDraft.trim()) {
      toast({ title: "Check the form", description: "A name is required.", variant: "error" });
      return;
    }
    if (passwordDraft && passwordDraft.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "error" });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        if (modeDraft === "PRODUCTION" && editing.accountMode !== "PRODUCTION" && !editing.productionApiKey) {
          toast({ title: "Approve Go Live first", description: "Production mode needs a production key, issued when you approve their Go Live request.", variant: "error" });
          return;
        }
        await integratorsService.update(editing.id, {
          name: nameDraft,
          ...(emailDraft.trim() && emailDraft.trim() !== (editing.email ?? "") ? { email: emailDraft.trim() } : {}),
          ...(phoneDraft.trim() && phoneDraft.trim() !== (editing.phoneNumber ?? "") ? { phoneNumber: phoneDraft.trim() } : {}),
          ...(usernameDraft.trim() && usernameDraft.trim() !== (editing.username ?? "") ? { username: usernameDraft.trim() } : {}),
          ...(modeDraft !== editing.accountMode ? { accountMode: modeDraft } : {}),
          ...(passwordDraft ? { newPassword: passwordDraft } : {}),
        });
        toast({
          title: "Integrator updated",
          description: passwordDraft ? "New password set - share it with them securely." : undefined,
          variant: "success",
        });
      }
      setModalOpen(false);
      await refresh();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Save failed", variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(integrator: Integrator) {
    // A disabled integrator's payments and payouts stop immediately, so a
    // stray click on the status badge must never do this silently.
    const ok = await confirm({
      title: integrator.isActive ? `Disable ${integrator.name}?` : `Enable ${integrator.name}?`,
      description: integrator.isActive
        ? "Their API keys stop working right away: no more payments or payouts until you enable them again."
        : "Their API keys start working again.",
      confirmLabel: integrator.isActive ? "Disable" : "Enable",
      destructive: integrator.isActive,
    });
    if (!ok) return;
    await integratorsService.update(integrator.id, { isActive: !integrator.isActive });
    toast({
      title: integrator.isActive ? "Integrator disabled" : "Integrator enabled",
      description: `${integrator.name} ${integrator.isActive ? "can no longer" : "can now"} take payments or send payouts.`,
      variant: "default",
    });
    await refresh();
  }

  async function handleApproveProduction(integrator: Integrator) {
    const ok = await confirm({
      title: `Approve ${integrator.name} for production?`,
      description: "Generates a live production API key immediately.",
      confirmLabel: "Approve",
    });
    if (!ok) return;
    await integratorsService.approveProduction(integrator.id);
    toast({ title: "Production approved", description: `${integrator.name} now has a production API key.`, variant: "success" });
    await refresh();
  }

  async function handleRejectProduction(integrator: Integrator) {
    const ok = await confirm({
      title: `Reject ${integrator.name}'s production request?`,
      description: "They'll need to resubmit their KYC info to try again.",
      confirmLabel: "Reject",
      destructive: true,
    });
    if (!ok) return;
    await integratorsService.rejectProduction(integrator.id, "Rejected by operator");
    toast({ title: "Production request rejected", variant: "default" });
    await refresh();
  }

  function copyKey(key: string) {
    navigator.clipboard?.writeText(key);
    toast({ title: "API key copied", variant: "default" });
  }

  const totals = summary.reduce(
    (acc, s) => ({
      collected: acc.collected + s.totalCollectedRwf,
      disbursed: acc.disbursed + s.totalDisbursedRwf,
      margin: acc.margin + s.totalMarginRwf,
    }),
    { collected: 0, disbursed: 0, margin: 0 }
  );

  const columns: Column<Integrator>[] = [
    {
      key: "name",
      header: "Integrator",
      render: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[[row.firstName, row.lastName].filter(Boolean).join(" "), row.email].filter(Boolean).join(" · ") || "—"}
          </p>
          {row.bankName && (
            <p className="truncate text-[11px] text-muted-foreground">
              Bank: {row.bankName} {row.bankAccount}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "sandboxApiKey",
      header: "Sandbox Key",
      render: (row) => (
        <div className="flex items-center gap-2 font-mono text-xs">
          <span>{revealedKey && row.sandboxApiKey === revealedKey ? row.sandboxApiKey : maskApiKey(row.sandboxApiKey)}</span>
          <button
            onClick={() => copyKey(row.sandboxApiKey)}
            className="text-muted-foreground hover:text-foreground"
            title="Copy sandbox API key"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      align: "center",
      render: (row) => (
        <button onClick={() => handleToggleActive(row)} title={row.isActive ? "Click to disable (asks first)" : "Click to enable"}>
          <StatusBadge variant={row.isActive ? "success" : "outline"}>
            {row.isActive ? "ACTIVE" : "DISABLED"}
          </StatusBadge>
        </button>
      ),
    },
    {
      key: "accountMode",
      header: "Mode",
      align: "center",
      render: (row) => (
        <StatusBadge variant={row.accountMode === "PRODUCTION" ? "success" : "warning"} dot={false}>
          {row.accountMode === "PRODUCTION" ? "PRODUCTION" : "TEST"}
        </StatusBadge>
      ),
    },
    {
      key: "productionStatus",
      header: "Production",
      render: (row) => {
        const docs = documentsByIntegrator[row.id] ?? [];
        const taxDoc = docs.find((d) => d.documentType === "TAX_CLEARANCE");
        const rdbDoc = docs.find((d) => d.documentType === "RDB_CERTIFICATE");
        return (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <StatusBadge
                variant={
                  row.productionStatus === "APPROVED"
                    ? "success"
                    : row.productionStatus === "PENDING_REVIEW"
                      ? "warning"
                      : row.productionStatus === "REJECTED"
                        ? "destructive"
                        : "outline"
                }
              >
                {row.productionStatus.replace("_", " ")}
              </StatusBadge>
              {row.productionStatus === "PENDING_REVIEW" && (
                <>
                  <Button variant="outline" size="sm" onClick={() => handleApproveProduction(row)}>
                    Approve
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleRejectProduction(row)}>
                    Reject
                  </Button>
                </>
              )}
            </div>
            {(taxDoc || rdbDoc) && (
              <div className="flex items-center gap-3 text-xs">
                {taxDoc && (
                  <a
                    href={integratorsService.documentViewUrl(row.id, "TAX_CLEARANCE") ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    <FileText className="h-3 w-3" /> Tax clearance
                  </a>
                )}
                {rdbDoc && (
                  <a
                    href={integratorsService.documentViewUrl(row.id, "RDB_CERTIFICATE") ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    <FileText className="h-3 w-3" /> RDB certificate
                  </a>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
      ),
    },
  ];

  const summaryColumns: Column<IntegratorSummary>[] = [
    { key: "integratorName", header: "Integrator" },
    { key: "successfulTransactions", header: "Txns", align: "right" },
    { key: "totalCollectedRwf", header: "Collected", align: "right", render: (r) => formatRwf(r.totalCollectedRwf) },
    { key: "totalDisbursedRwf", header: "Paid out", align: "right", render: (r) => formatRwf(r.totalDisbursedRwf) },
    { key: "totalFeeChargedRwf", header: "Fees charged", align: "right", render: (r) => formatRwf(r.totalFeeChargedRwf) },
    { key: "totalGatewayCostRwf", header: "LMBTech cost", align: "right", render: (r) => `−${formatRwf(r.totalGatewayCostRwf)}` },
    {
      key: "totalMarginRwf",
      header: "Our margin",
      align: "right",
      render: (r) => (
        <span className={r.totalMarginRwf < 0 ? "font-semibold text-destructive" : "font-semibold text-success"}>
          {formatRwf(r.totalMarginRwf)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <Breadcrumb items={[{ label: "Console" }, { label: "Integrators & Pricing" }]} />
          <h1 className="mt-1 text-xl font-semibold text-foreground">Integrators & Pricing</h1>
          <p className="text-sm text-muted-foreground">
            The businesses selling with Soila Pay, what each one pays you on collections and payouts, and the margin left after LMBTech&apos;s cut.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Integrators can also sign themselves up at{" "}
            <button
              onClick={() => copyKey(`${window.location.origin}/portal/signup`)}
              className="font-medium text-primary hover:underline"
            >
              /portal/signup
            </button>{" "}
            - no need to create every account manually below.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          New Integrator
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Integrators" value={String(integrators.length)} icon={Users} />
        <StatCard label="Total collected" value={formatRwf(totals.collected)} icon={Wallet} accent="primary" />
        <StatCard label="Total paid out" value={formatRwf(totals.disbursed)} icon={ArrowUpRight} accent="warning" />
        <StatCard
          label="Total margin earned"
          value={formatRwf(totals.margin)}
          icon={TrendingUp}
          accent={totals.margin < 0 ? "destructive" : "success"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Integrators</CardTitle>
          <CardDescription>Who can take payments (POST /api/v1/payments) and send payouts (POST /api/v1/disbursements).</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={integrators}
            loading={loading}
            rowKey={(row) => String(row.id)}
            emptyMessage="No integrators yet - create one to issue an Integrator-Key."
          />
        </CardContent>
      </Card>

      <div id="pricing" className="scroll-mt-4">
        <PricingPanel onSaved={refresh} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by integrator</CardTitle>
          <CardDescription>Where the margin actually comes from, per integrator.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={summaryColumns}
            data={summary}
            loading={loading}
            rowKey={(row) => String(row.integratorId)}
            emptyMessage="No successful transactions yet."
          />
        </CardContent>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : "New Integrator"}
        description={
          editing
            ? "Rename the integrator. Fees are set in the Pricing section."
            : "Issues a new API key the integrator sends as the Integrator-Key header."
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveIntegrator} loading={saving}>
              {editing ? "Save changes" : "Create integrator"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="Acme Shop"
            hint="Fees are set in the Pricing section of this page."
          />
          {editing && (
            <>
              <Input label="Email" type="email" value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} hint="Their login. Only admins can change it." />
              <Input label="Phone" value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} placeholder="+250788123456" />
              <Input label="Username" value={usernameDraft} onChange={(e) => setUsernameDraft(e.target.value)} hint="Letters, numbers, . _ - (they can log in with it)" />
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold text-foreground">Account Mode</span>
                <div className="flex gap-2">
                  {(["TEST", "PRODUCTION"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModeDraft(m)}
                      aria-pressed={modeDraft === m}
                      className={`nb-press flex-1 rounded-sm border-2 border-[var(--nb-ink)] px-3 py-2 text-sm font-bold shadow-sm ${
                        modeDraft === m ? (m === "PRODUCTION" ? "bg-[var(--bk-green)] text-[#111]" : "bg-[var(--bk-yellow)] text-[#111]") : "bg-card"
                      }`}
                    >
                      {m === "TEST" ? "Test Mode" : "Production"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Test: only their sandbox key works. Production: their production key works too.</p>
              </div>
            </>
          )}
          {editing && (
            <Input
              label="Set a new password (optional)"
              type="password"
              value={passwordDraft}
              onChange={(e) => setPasswordDraft(e.target.value)}
              placeholder="Leave empty to keep their current password"
              hint="For an integrator who forgot theirs. At least 8 characters."
              autoComplete="new-password"
            />
          )}
        </div>
      </Modal>

      {createOpen && (
        <NewIntegratorDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            refresh();
          }}
        />
      )}

      <Modal
        open={revealedKey !== null}
        onClose={() => setRevealedKey(null)}
        title="Integrator API key"
        description="Shown once - copy it now and share it securely with the integrator."
        footer={
          <Button onClick={() => setRevealedKey(null)}>Done</Button>
        }
      >
        <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 font-mono text-sm">
          <span className="flex-1 break-all">{revealedKey}</span>
          <button
            onClick={() => revealedKey && copyKey(revealedKey)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Send this as the <code className="rounded bg-secondary px-1 py-0.5 font-mono">Integrator-Key</code>{" "}
          header on every API call (payments and payouts).
        </p>
      </Modal>
    </div>
  );
}
