"use client";

import * as React from "react";
import { Ban, CheckCircle2, Circle, FileText, RotateCcw, Upload, XCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { integratorsService } from "@/services/integrators.service";
import { paymentErrorMessage } from "@/services/payment.service";
import type { GoLiveChecklist } from "@/services/integrator-portal.service";
import { toast } from "@/store/toast-store";
import type { DocumentType, Integrator, IntegratorDocument, IntegratorUpdateRequest } from "@/types/api";

/** The editable text fields, all as strings ("" = empty). */
type Draft = {
  name: string; email: string; phoneNumber: string; username: string;
  firstName: string; lastName: string; address: string; location: string; city: string; country: string;
  bankName: string; bankAccount: string; businessLocation: string; ipWhitelist: string;
};
type DraftKey = keyof Draft;

function draftFrom(i: Integrator): Draft {
  return {
    name: i.name, email: i.email ?? "", phoneNumber: i.phoneNumber ?? "", username: i.username ?? "",
    firstName: i.firstName ?? "", lastName: i.lastName ?? "", address: i.address ?? "", location: i.location ?? "",
    city: i.city ?? "", country: i.country ?? "", bankName: i.bankName ?? "", bankAccount: i.bankAccount ?? "",
    businessLocation: i.businessLocation ?? "", ipWhitelist: i.ipWhitelist ?? "",
  };
}

// Login identity can be changed but not blanked (it's how they sign in).
const NO_CLEAR: DraftKey[] = ["name", "email", "phoneNumber", "username"];

const STATUS_VARIANT = {
  APPROVED: "success", PENDING_REVIEW: "warning", REJECTED: "destructive", SUSPENDED: "destructive", NOT_SUBMITTED: "outline",
} as const;

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b-2 border-border pb-5 last:border-b-0 last:pb-0">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">{title}</h3>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function DocumentRow({
  integratorId, label, type, doc, onChanged,
}: { integratorId: number; label: string; type: DocumentType; doc?: IntegratorDocument; onChanged: () => void }) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large - max 5 MB", variant: "error" });
      return;
    }
    setBusy(true);
    try {
      await integratorsService.uploadDocument(integratorId, type, file);
      toast({ title: `${label} uploaded`, variant: "success" });
      onChanged();
    } catch (e) {
      toast({ title: paymentErrorMessage(e), variant: "error" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border-2 border-border px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{doc ? doc.fileName : "Not uploaded"}</p>
      </div>
      <div className="flex gap-2">
        {doc && (
          <Button type="button" variant="ghost" size="sm" onClick={() => integratorsService.openDocument(integratorId, type).catch((e) => toast({ title: paymentErrorMessage(e), variant: "error" }))}>
            <FileText className="h-3.5 w-3.5" /> View
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" loading={busy} onClick={() => input.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> {doc ? "Replace" : "Upload"}
        </Button>
        <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
    </div>
  );
}

/** Admin "Edit integrator": everything the integrator filled in (Account page
 * and the Go live form, shown the way they see it), plus live access control. */
export function EditIntegratorDialog({
  integrator, onClose, onSaved,
}: { integrator: Integrator; onClose: () => void; onSaved: () => void }) {
  const confirm = useConfirm();
  const [current, setCurrent] = React.useState(integrator);
  const [d, setD] = React.useState<Draft>(() => draftFrom(integrator));
  const [mode, setMode] = React.useState(integrator.accountMode);
  const [password, setPassword] = React.useState("");
  const [suspendReason, setSuspendReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [busyLive, setBusyLive] = React.useState(false);
  const [docs, setDocs] = React.useState<IntegratorDocument[]>([]);
  const [checklist, setChecklist] = React.useState<GoLiveChecklist | null>(null);

  const loadGoLive = React.useCallback(() => {
    integratorsService.listDocuments(integrator.id).then(setDocs).catch(() => setDocs([]));
    integratorsService.goLiveChecklist(integrator.id).then(setChecklist).catch(() => setChecklist(null));
  }, [integrator.id]);
  React.useEffect(loadGoLive, [loadGoLive]);

  const field = (key: DraftKey, label: string, extra: Partial<React.ComponentProps<typeof Input>> = {}) => (
    <Input label={label} value={d[key]} onChange={(e) => setD((p) => ({ ...p, [key]: e.target.value }))} {...extra} />
  );

  const original = draftFrom(current);
  const changed = (Object.keys(d) as DraftKey[]).filter((k) => d[k].trim() !== original[k].trim());

  async function save() {
    const blanked = changed.filter((k) => NO_CLEAR.includes(k) && !d[k].trim());
    if (blanked.length) {
      toast({ title: "Name, email, phone and username can't be emptied", variant: "error" });
      return;
    }
    if (password && password.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "error" });
      return;
    }
    const payload: IntegratorUpdateRequest = {};
    for (const k of changed) (payload as Record<string, string>)[k] = d[k].trim();
    if (mode !== current.accountMode) payload.accountMode = mode;
    if (password) payload.newPassword = password;
    if (!Object.keys(payload).length) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await integratorsService.update(current.id, payload);
      toast({
        title: "Integrator updated",
        description: password ? "New password set - share it with them securely." : undefined,
        variant: "success",
      });
      onSaved();
      onClose();
    } catch (e) {
      toast({ title: paymentErrorMessage(e), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function liveAction(kind: "suspend" | "restore" | "approve" | "reject") {
    const copy = {
      suspend: { title: `Suspend ${current.name}'s live access?`, description: "Their production key stops working right now - real payments and payouts are refused. Their sandbox key keeps working, and they can't switch live back on themselves.", confirmLabel: "Suspend live", destructive: true },
      restore: { title: `Restore ${current.name}'s live access?`, description: "Their existing production key works again straight away - no changes needed on their side.", confirmLabel: "Restore live", destructive: false },
      approve: { title: `Approve ${current.name} for production?`, description: "Issues their live production key and switches them to Production.", confirmLabel: "Approve", destructive: false },
      reject: { title: `Reject ${current.name}'s Go live request?`, description: "They'll see the rejection in their portal and can fix it and submit again.", confirmLabel: "Reject", destructive: true },
    }[kind];
    if (!(await confirm(copy))) return;
    setBusyLive(true);
    try {
      const updated =
        kind === "suspend" ? await integratorsService.suspendProduction(current.id, suspendReason.trim())
        : kind === "reject" ? await integratorsService.rejectProduction(current.id, "Rejected by operator")
        : await integratorsService.approveProduction(current.id); // approve + restore
      setCurrent(updated);
      setMode(updated.accountMode);
      setSuspendReason("");
      toast({
        title: { suspend: "Live access suspended", restore: "Live access restored", approve: "Production approved", reject: "Go live request rejected" }[kind],
        variant: kind === "suspend" || kind === "reject" ? "default" : "success",
      });
      onSaved();
    } catch (e) {
      toast({ title: paymentErrorMessage(e), variant: "error" });
    } finally {
      setBusyLive(false);
    }
  }

  const status = current.productionStatus;
  const tax = docs.find((x) => x.documentType === "TAX_CLEARANCE");
  const rdb = docs.find((x) => x.documentType === "RDB_CERTIFICATE");

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Edit ${current.name}`}
      description="Everything this integrator filled in - their account details and Go live form - plus their live access."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save changes</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Section title="Live access" note="Whether their production key can move real money.">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant={STATUS_VARIANT[status]}>{status.replace("_", " ")}</StatusBadge>
            <StatusBadge variant={current.accountMode === "PRODUCTION" ? "success" : "warning"} dot={false}>
              {current.accountMode === "PRODUCTION" ? "PRODUCTION MODE" : "TEST MODE"}
            </StatusBadge>
            {!current.isActive && <StatusBadge variant="outline">ACCOUNT DISABLED</StatusBadge>}
          </div>
          {current.productionRejectionReason && (status === "REJECTED" || status === "SUSPENDED") && (
            <p className="text-xs text-muted-foreground">Reason: {current.productionRejectionReason}</p>
          )}

          {status === "APPROVED" && (
            <div className="flex flex-col gap-2 rounded-sm border-2 border-destructive/40 p-3">
              <Input label="Reason (they'll see it)" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="e.g. Documents expired - contact support" maxLength={255} />
              <Button variant="outline" size="sm" className="w-fit" loading={busyLive} onClick={() => liveAction("suspend")}>
                <Ban className="h-3.5 w-3.5" /> Suspend live access
              </Button>
            </div>
          )}
          {status === "SUSPENDED" && (
            <Button size="sm" className="w-fit" loading={busyLive} onClick={() => liveAction("restore")}>
              <RotateCcw className="h-3.5 w-3.5" /> Restore live access
            </Button>
          )}
          {status === "PENDING_REVIEW" && (
            <div className="flex gap-2">
              <Button size="sm" loading={busyLive} onClick={() => liveAction("approve")}>Approve</Button>
              <Button variant="ghost" size="sm" disabled={busyLive} onClick={() => liveAction("reject")}>
                <XCircle className="h-3.5 w-3.5" /> Reject
              </Button>
            </div>
          )}
          {(status === "NOT_SUBMITTED" || status === "REJECTED") && (
            <Button variant="outline" size="sm" className="w-fit" loading={busyLive} onClick={() => liveAction("approve")}>
              Approve for production without the form
            </Button>
          )}

          {status !== "SUSPENDED" && current.productionApiKey && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-foreground">Account Mode</span>
              <div className="flex gap-2">
                {(["TEST", "PRODUCTION"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
                    className={`nb-press flex-1 rounded-sm border-2 border-[var(--nb-ink)] px-3 py-2 text-sm font-bold shadow-sm ${
                      mode === m ? (m === "PRODUCTION" ? "bg-[var(--bk-green)] text-[#111]" : "bg-[var(--bk-yellow)] text-[#111]") : "bg-card"
                    }`}>
                    {m === "TEST" ? "Test Mode" : "Production"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">A temporary switch: they can still go live again themselves. To block live until you say so, use Suspend.</p>
            </div>
          )}
        </Section>

        <Section title="Go live form" note="What they submitted on their Go Live page - you can correct any of it.">
          {checklist && (
            <ul className="flex flex-col gap-1.5 text-sm">
              {checklist.items.map((i) => (
                <li key={i.key} className="flex items-center gap-2">
                  {i.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className={i.done ? "" : "text-muted-foreground"}>{i.label}</span>
                </li>
              ))}
            </ul>
          )}
          {field("businessLocation", "Business location", { placeholder: "Kigali, Nyarugenge" })}
          <DocumentRow integratorId={current.id} label="Tax clearance certificate" type="TAX_CLEARANCE" doc={tax} onChanged={loadGoLive} />
          <DocumentRow integratorId={current.id} label="RDB certificate" type="RDB_CERTIFICATE" doc={rdb} onChanged={loadGoLive} />
          {field("ipWhitelist", "Server IP addresses (optional)", {
            placeholder: "203.0.113.10, 203.0.113.11",
            hint: "If set, their live key only works from these IPs. Leave empty to allow any IP.",
          })}
        </Section>

        <Section title="Login & contact" note="How they sign in to the portal. Only admins can change these.">
          <div className="grid gap-3 sm:grid-cols-2">
            {field("name", "Company name")}
            {field("email", "Email", { type: "email" })}
            {field("phoneNumber", "Phone", { placeholder: "+250788123456" })}
            {field("username", "Username", { hint: "Letters, numbers, . _ -" })}
          </div>
          <Input label="Set a new password (optional)" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave empty to keep their current password" hint="For an integrator who forgot theirs. At least 8 characters."
            autoComplete="new-password" />
        </Section>

        <Section title="Profile" note="From their Account page.">
          <div className="grid gap-3 sm:grid-cols-2">
            {field("firstName", "First name")}
            {field("lastName", "Last name")}
            {field("address", "Address")}
            {field("location", "Location")}
            {field("city", "City")}
            {field("country", "Country")}
          </div>
        </Section>

        <Section title="Bank details" note="Where bank cash-outs are sent.">
          <div className="grid gap-3 sm:grid-cols-2">
            {field("bankName", "Bank name")}
            {field("bankAccount", "Bank account number")}
          </div>
        </Section>
      </div>
    </Modal>
  );
}
