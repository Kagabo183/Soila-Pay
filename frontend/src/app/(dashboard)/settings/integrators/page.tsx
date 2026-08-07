"use client";

import * as React from "react";
import { Plus, Pencil, Copy, TrendingUp, Percent, Users, Wallet, FileText } from "lucide-react";
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
  const [ddinCost, setDdinCost] = React.useState<number>(2.0);
  const [loading, setLoading] = React.useState(true);

  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Integrator | null>(null);
  const [nameDraft, setNameDraft] = React.useState("");
  const [feeDraft, setFeeDraft] = React.useState("2.20");
  const [phoneDraft, setPhoneDraft] = React.useState("");
  const [passwordDraft, setPasswordDraft] = React.useState("");
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
    const [integratorList, summaryList, cost] = await Promise.all([
      integratorsService.list(),
      integratorsService.summary(),
      integratorsService.getDdinCostPercentage(),
    ]);
    setIntegrators(integratorList);
    setSummary(summaryList);
    setDdinCost(cost);
    setLoading(false);
    await loadDocuments(integratorList);
  }

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      const [integratorList, summaryList, cost] = await Promise.all([
        integratorsService.list(),
        integratorsService.summary(),
        integratorsService.getDdinCostPercentage(),
      ]);
      if (!mounted) return;
      setIntegrators(integratorList);
      setSummary(summaryList);
      setDdinCost(cost);
      setLoading(false);
      await loadDocuments(integratorList);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  function openCreate() {
    setEditing(null);
    setNameDraft("");
    setFeeDraft("2.20");
    setPhoneDraft("");
    setPasswordDraft("");
    setModalOpen(true);
  }

  function openEdit(integrator: Integrator) {
    setEditing(integrator);
    setNameDraft(integrator.name);
    setFeeDraft(integrator.feePercentage.toFixed(2));
    setModalOpen(true);
  }

  async function handleSaveIntegrator() {
    const feePercentage = Number(feeDraft);
    if (!nameDraft.trim() || !Number.isFinite(feePercentage) || feePercentage <= 0) {
      toast({ title: "Check the form", description: "Name and fee % are required.", variant: "error" });
      return;
    }
    if (!editing && (phoneDraft.trim() || passwordDraft) && (!phoneDraft.trim() || passwordDraft.length < 8)) {
      toast({
        title: "Check the login fields",
        description: "Set both phone number and an 8+ character password, or leave both blank.",
        variant: "error",
      });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await integratorsService.update(editing.id, { name: nameDraft, feePercentage });
        toast({ title: "Integrator updated", description: `${nameDraft} now charged at ${feePercentage}%.`, variant: "success" });
      } else {
        const created = await integratorsService.create({
          name: nameDraft,
          feePercentage,
          ...(phoneDraft.trim() ? { phoneNumber: phoneDraft.trim(), password: passwordDraft } : {}),
        });
        toast({
          title: "Integrator created",
          description: phoneDraft.trim()
            ? `${created.name} can now log in to the portal with the phone number and password you set.`
            : `${created.name} is ready to use.`,
          variant: "success",
        });
        setRevealedKey(created.sandboxApiKey);
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
    await integratorsService.update(integrator.id, { isActive: !integrator.isActive });
    toast({
      title: integrator.isActive ? "Integrator disabled" : "Integrator enabled",
      description: `${integrator.name} ${integrator.isActive ? "can no longer" : "can now"} call the purchase API.`,
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
      margin: acc.margin + s.totalMarginRwf,
    }),
    { collected: 0, margin: 0 }
  );

  const columns: Column<Integrator>[] = [
    { key: "name", header: "Integrator", render: (row) => <span className="font-medium">{row.name}</span> },
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
      key: "feePercentage",
      header: "Fee charged",
      align: "right",
      render: (row) => <span className="font-medium">{row.feePercentage.toFixed(2)}%</span>,
    },
    {
      key: "isActive",
      header: "Status",
      align: "center",
      render: (row) => (
        <button onClick={() => handleToggleActive(row)}>
          <StatusBadge variant={row.isActive ? "success" : "outline"}>
            {row.isActive ? "ACTIVE" : "DISABLED"}
          </StatusBadge>
        </button>
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
    { key: "totalFeeChargedRwf", header: "We charged", align: "right", render: (r) => formatRwf(r.totalFeeChargedRwf) },
    { key: "totalDdinCostRwf", header: "DDIN cost", align: "right", render: (r) => formatRwf(r.totalDdinCostRwf) },
    {
      key: "totalMarginRwf",
      header: "Our margin",
      align: "right",
      render: (r) => <span className="font-medium text-success">{formatRwf(r.totalMarginRwf)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <Breadcrumb items={[{ label: "Console" }, { label: "Integrators" }]} />
          <h1 className="mt-1 text-xl font-semibold text-foreground">Integrators & Margin</h1>
          <p className="text-sm text-muted-foreground">
            Each integrator is charged its own fee % on top of what DDIN charges Soila Pay.
            Integrator fees are editable right here - no code change or deploy needed. DDIN&apos;s
            cost is DDIN&apos;s call, not ours, so it&apos;s shown read-only below.
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
        <StatCard label="Total margin earned" value={formatRwf(totals.margin)} icon={TrendingUp} accent="success" />
        <StatCard label="DDIN cost (current)" value={`${ddinCost.toFixed(2)}%`} icon={Percent} accent="warning" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>DDIN cost percentage</CardTitle>
          <CardDescription>
            What DDIN charges Soila Pay per collection - DDIN sets this, not us, so it&apos;s
            read-only here. Every integrator&apos;s margin is computed as (their fee %) minus this
            value at the moment each purchase succeeds. If DDIN changes their published rate,
            update it via <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">PATCH /api/v1/admin/settings/ddin-cost-percentage</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold text-foreground">{ddinCost.toFixed(2)}%</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integrators</CardTitle>
          <CardDescription>Who can call /api/v1/collection/collect, and at what fee.</CardDescription>
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
            ? "Changes apply to future purchases - past transactions keep their original rate."
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
          <Input label="Name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Acme Aggregator" />
          <Input
            label="Fee percentage"
            type="number"
            step="0.01"
            min="0"
            value={feeDraft}
            onChange={(e) => setFeeDraft(e.target.value)}
            hint="What Soila Pay charges this integrator per collection (DDIN's own cost is set separately above)."
          />
          {!editing && (
            <>
              <div className="border-t border-border pt-4">
                <p className="text-sm font-medium text-foreground">Portal login (optional)</p>
                <p className="text-xs text-muted-foreground">
                  Set both to hand them working credentials for{" "}
                  <code className="rounded bg-secondary px-1 py-0.5 font-mono">/portal/login</code> right
                  now, instead of making them sign up themselves.
                </p>
              </div>
              <Input
                label="Phone number"
                value={phoneDraft}
                onChange={(e) => setPhoneDraft(e.target.value)}
                placeholder="0788123456"
              />
              <Input
                label="Password"
                type="password"
                value={passwordDraft}
                onChange={(e) => setPasswordDraft(e.target.value)}
                placeholder="At least 8 characters"
              />
            </>
          )}
        </div>
      </Modal>

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
          header on every <code className="rounded bg-secondary px-1 py-0.5 font-mono">POST /api/v1/collection/collect</code> call.
        </p>
      </Modal>
    </div>
  );
}
