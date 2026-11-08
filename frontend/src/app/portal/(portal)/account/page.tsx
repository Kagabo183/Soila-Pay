"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Copy, Eye, EyeOff, FileText, KeyRound, Loader2, Lock, RefreshCw, Save, Trash2, Upload, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/store/toast-store";
import { BkField, BkPanel, rwf } from "@/components/payments/brutal";
import { paymentErrorMessage, paymentService, type PaymentSummary } from "@/services/payment.service";
import { integratorPortalService } from "@/services/integrator-portal.service";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import type { IntegratorDocument } from "@/types/api";

const TYPE_LABEL = { NOT_SUBMITTED: "Not submitted", PENDING_REVIEW: "Pending", APPROVED: "Approved", REJECTED: "Rejected" } as const;
const MAX_FILE = 5 * 1024 * 1024;

function ReadOnly({ label, value, note }: { label: string; value: string | null; note: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="bk-display text-sm font-bold uppercase">{label}</span>
      <div className="bk-box bk-fill-paper flex min-h-12 items-center gap-2 px-3 text-sm opacity-80">
        <Lock className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{value || "—"}</span>
      </div>
      <p className="bk-muted text-xs">{note}</p>
    </div>
  );
}

function KeyField({ label, value }: { label: string; value: string }) {
  const [shown, setShown] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="min-w-0">
      <p className="bk-display text-xs font-bold uppercase">{label}</p>
      <div className="bk-box mt-1 flex items-center gap-2 px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-sm">{shown ? value : "•".repeat(28)}</code>
        <button type="button" aria-label={shown ? "Hide key" : "Show key"} onClick={() => setShown((s) => !s)} className="bk-btn bk-fill-paper min-h-8 px-2">
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() =>
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            })
          }
          className="bk-btn bk-fill-paper min-h-8 px-2"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export default function PortalAccountPage() {
  const token = useIntegratorPortalStore((s) => s.token);
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  const updateIntegrator = useIntegratorPortalStore((s) => s.updateIntegrator);

  const [summary, setSummary] = React.useState<PaymentSummary | null>(null);
  const [avatar, setAvatar] = React.useState<string | null>(null);
  const [docs, setDocs] = React.useState<IntegratorDocument[]>([]);
  const [form, setForm] = React.useState({
    firstName: "", lastName: "", company: "", address: "", location: "", city: "", country: "", bankName: "", bankAccount: "",
  });
  const [saving, setSaving] = React.useState(false);
  const [pw, setPw] = React.useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = React.useState(false);
  const [rotatePw, setRotatePw] = React.useState("");
  const [rotating, setRotating] = React.useState(false);
  const [busyUpload, setBusyUpload] = React.useState<string | null>(null);

  // Always start from a fresh copy of the account (keys/mode can change admin-side).
  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [fresh, s, img, d] = await Promise.all([
          integratorPortalService.me(token),
          paymentService.summary({ kind: "portal", token }),
          integratorPortalService.profileImageUrl(token),
          integratorPortalService.listProductionDocuments(token),
        ]);
        if (cancelled) return;
        updateIntegrator(fresh);
        setSummary(s);
        setAvatar(img);
        setDocs(d);
        setForm({
          firstName: fresh.firstName ?? "", lastName: fresh.lastName ?? "", company: fresh.name, address: fresh.address ?? "",
          location: fresh.location ?? "", city: fresh.city ?? "", country: fresh.country ?? "", bankName: fresh.bankName ?? "",
          bankAccount: fresh.bankAccount ?? "",
        });
      } catch (e) {
        toast({ title: "Could not load your account", description: paymentErrorMessage(e), variant: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, updateIntegrator]);

  if (!token || !integrator) return null;

  const rdb = docs.find((d) => d.documentType === "RDB_CERTIFICATE");
  const fullName = [integrator.firstName, integrator.lastName].filter(Boolean).join(" ") || integrator.name;
  const field = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company.trim()) {
      toast({ title: "Company name is required", variant: "error" });
      return;
    }
    setSaving(true);
    try {
      updateIntegrator(await integratorPortalService.updateProfile(token!, form));
      toast({ title: "Profile updated", variant: "success" });
    } catch (err) {
      toast({ title: "Not saved", description: paymentErrorMessage(err), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    if (!["image/jpeg", "image/png"].includes(file.type)) return toast({ title: "Use a JPG or PNG image", variant: "error" });
    if (file.size > MAX_FILE) return toast({ title: "Image too large - max 5MB", variant: "error" });
    setBusyUpload("avatar");
    try {
      await integratorPortalService.uploadProfileImage(token!, file);
      setAvatar(await integratorPortalService.profileImageUrl(token!));
      toast({ title: "Profile image updated", variant: "success" });
    } catch (err) {
      toast({ title: "Upload failed", description: paymentErrorMessage(err), variant: "error" });
    } finally {
      setBusyUpload(null);
    }
  }

  async function removeAvatar() {
    await integratorPortalService.removeProfileImage(token!);
    setAvatar(null);
  }

  async function uploadRdb(file: File) {
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) return toast({ title: "Use a PDF, JPG or PNG", variant: "error" });
    if (file.size > MAX_FILE) return toast({ title: "File too large - max 5MB", variant: "error" });
    setBusyUpload("rdb");
    try {
      await integratorPortalService.uploadProductionDocument(token!, "RDB_CERTIFICATE", file);
      setDocs(await integratorPortalService.listProductionDocuments(token!));
      toast({ title: "RDB certificate updated", variant: "success" });
    } catch (err) {
      toast({ title: "Upload failed", description: paymentErrorMessage(err), variant: "error" });
    } finally {
      setBusyUpload(null);
    }
  }

  async function viewRdb() {
    const url = await integratorPortalService.documentUrl(token!, "RDB_CERTIFICATE");
    if (url) window.open(url, "_blank", "noopener");
    else toast({ title: "Could not open the certificate", variant: "error" });
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next.length < 8) return toast({ title: "New password must be at least 8 characters", variant: "error" });
    if (pw.next !== pw.confirm) return toast({ title: "The new passwords don't match", variant: "error" });
    setPwSaving(true);
    try {
      await integratorPortalService.changePassword(token!, pw.current, pw.next);
      setPw({ current: "", next: "", confirm: "" });
      toast({ title: "Password changed", variant: "success" });
    } catch (err) {
      toast({ title: "Password not changed", description: paymentErrorMessage(err), variant: "error" });
    } finally {
      setPwSaving(false);
    }
  }

  async function rotateKeys(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm("Generate brand-new API keys? Every integration using your current keys stops working immediately.")) return;
    setRotating(true);
    try {
      updateIntegrator(await integratorPortalService.rotateKeys(token!, rotatePw));
      setRotatePw("");
      toast({ title: "New API keys issued", description: "Update your integration with the new keys.", variant: "success" });
    } catch (err) {
      toast({ title: "Keys not changed", description: paymentErrorMessage(err), variant: "error" });
    } finally {
      setRotating(false);
    }
  }

  const statusChips = [
    { label: "Role", value: "Integrator", fill: "bk-fill-paper" },
    { label: "Account Status", value: integrator.isActive ? "Active" : "Disabled", fill: integrator.isActive ? "bk-fill-green" : "bk-fill-red" },
    {
      label: "Account Type",
      value: TYPE_LABEL[integrator.productionStatus],
      fill: integrator.productionStatus === "APPROVED" ? "bk-fill-green" : integrator.productionStatus === "REJECTED" ? "bk-fill-red" : "bk-fill-yellow",
    },
    { label: "Account Mode", value: integrator.accountMode === "PRODUCTION" ? "Production" : "Test Mode", fill: integrator.accountMode === "PRODUCTION" ? "bk-fill-green" : "bk-fill-yellow" },
  ];

  return (
    <div className="-m-6 min-h-full bg-[var(--bk-page)] p-4 text-[var(--bk-ink)] sm:p-6">
      <div className="mx-auto flex min-w-0 max-w-5xl flex-col gap-6">
        {/* Header card */}
        <section className="bk-card flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
          <div className="bk-box flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden bk-fill-yellow shadow-[var(--bk-shadow-sm)]">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="Profile" className="h-full w-full object-cover" />
            ) : (
              <UserRound className="h-12 w-12" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="bk-display truncate text-3xl font-bold">{fullName}</h1>
            <span className="bk-tag bk-fill-ink mt-1">Integrator</span>
            <ul className="mt-2 grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
              <li>✉ {integrator.email ?? "—"}</li>
              <li>☎ {integrator.phoneNumber ?? "—"}</li>
              <li>🏢 {integrator.name}</li>
              <li>📍 {[integrator.city, integrator.country].filter(Boolean).join(", ") || "—"}</li>
            </ul>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statusChips.map((c) => (
            <div key={c.label} className={cn("bk-card p-3", c.fill)}>
              <p className="bk-display text-[11px] font-bold uppercase">{c.label}</p>
              <p className="bk-display mt-0.5 text-lg font-bold">{c.value}</p>
            </div>
          ))}
        </div>
        {integrator.accountMode === "TEST" && (
          <p className="bk-box bk-fill-yellow -mt-3 p-3 text-xs font-semibold">
            Test Mode: only your sandbox key works. Contact Soila Pay to switch between Production and Test Mode.
            {integrator.productionStatus !== "APPROVED" && (
              <>
                {" "}
                First complete{" "}
                <Link href="/portal/go-live" className="underline">
                  Go Live
                </Link>
                .
              </>
            )}
          </p>
        )}

        {/* Update profile */}
        <BkPanel title="Update profile" tone="bk-fill-blue">
          <form onSubmit={saveProfile} className="flex flex-col gap-6">
            <div className="grid gap-5 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="bk-display text-sm font-bold uppercase">Profile image</span>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="bk-btn bk-fill-paper cursor-pointer text-xs">
                    {busyUpload === "avatar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Choose image
                    <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
                  </label>
                  {avatar && (
                    <button type="button" onClick={removeAvatar} className="bk-btn bk-fill-paper text-xs">
                      <Trash2 className="h-4 w-4" /> Remove
                    </button>
                  )}
                </div>
                <p className="bk-muted text-xs">JPG or PNG, max 5MB.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="bk-display text-sm font-bold uppercase">RDB certificate</span>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="bk-btn bk-fill-paper cursor-pointer text-xs">
                    {busyUpload === "rdb" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {rdb ? "Replace" : "Upload"}
                    <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadRdb(e.target.files[0])} />
                  </label>
                  {rdb && (
                    <button type="button" onClick={viewRdb} className="bk-btn bk-fill-paper text-xs">
                      <FileText className="h-4 w-4" /> View current
                    </button>
                  )}
                </div>
                <p className="bk-muted text-xs">{rdb ? `Current: ${rdb.fileName}` : "Not uploaded yet"} · PDF, JPG or PNG, max 5MB.</p>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <BkField label="First name" htmlFor="pf-first">
                <input id="pf-first" className="bk-input" value={form.firstName} onChange={field("firstName")} autoComplete="given-name" />
              </BkField>
              <BkField label="Last name" htmlFor="pf-last">
                <input id="pf-last" className="bk-input" value={form.lastName} onChange={field("lastName")} autoComplete="family-name" />
              </BkField>
              <BkField label="Company" htmlFor="pf-company">
                <input id="pf-company" className="bk-input" value={form.company} onChange={field("company")} autoComplete="organization" />
              </BkField>
              <BkField label="Address" htmlFor="pf-address">
                <input id="pf-address" className="bk-input" value={form.address} onChange={field("address")} placeholder="KN 5 Rd" autoComplete="street-address" />
              </BkField>
              <BkField label="Location" htmlFor="pf-location" hint="District / sector">
                <input id="pf-location" className="bk-input" value={form.location} onChange={field("location")} placeholder="Nyarugenge" />
              </BkField>
              <BkField label="City" htmlFor="pf-city">
                <input id="pf-city" className="bk-input" value={form.city} onChange={field("city")} placeholder="Kigali" />
              </BkField>
              <BkField label="Country" htmlFor="pf-country">
                <input id="pf-country" className="bk-input" value={form.country} onChange={field("country")} autoComplete="country-name" />
              </BkField>
            </div>

            <div>
              <h3 className="bk-display text-sm font-bold uppercase">Bank account for settlement</h3>
              <p className="bk-muted text-xs">Where Soila Pay sends the money you collect.</p>
              <div className="mt-3 grid gap-5 md:grid-cols-2">
                <BkField label="Bank name" htmlFor="pf-bank">
                  <input id="pf-bank" className="bk-input" value={form.bankName} onChange={field("bankName")} placeholder="BK, BPR, Equity…" />
                </BkField>
                <BkField label="Bank account" htmlFor="pf-account">
                  <input id="pf-account" className="bk-input font-mono" value={form.bankAccount} onChange={field("bankAccount")} inputMode="numeric" />
                </BkField>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <ReadOnly label="Username" value={integrator.username} note="Contact Soila Pay to change your username." />
              <ReadOnly label="Email" value={integrator.email} note="Contact Soila Pay to change your email." />
              <ReadOnly label="Phone" value={integrator.phoneNumber} note="Contact Soila Pay to change your phone." />
            </div>

            <button type="submit" disabled={saving} className="bk-btn bk-fill-green self-start">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Update profile
            </button>
          </form>
        </BkPanel>

        {/* API credentials */}
        <BkPanel title="API credentials" tone="bk-fill-yellow">
          <p className="text-sm">
            Send your key in the <code className="font-mono font-bold">Integrator-Key</code> header to call the Soila Pay API (see API Docs).
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <KeyField label="Sandbox key (testing)" value={integrator.sandboxApiKey} />
            {integrator.productionApiKey ? (
              <KeyField label={`Production key${integrator.accountMode === "PRODUCTION" ? "" : " (inactive in Test Mode)"}`} value={integrator.productionApiKey} />
            ) : (
              <div className="bk-box flex items-center p-3 text-sm">No production key yet - it&apos;s issued when your Go Live request is approved.</div>
            )}
          </div>
          <form onSubmit={rotateKeys} className="bk-box bk-fill-red mt-5 flex flex-col gap-3 p-4">
            <p className="flex items-center gap-2 text-sm font-bold">
              <RefreshCw className="h-4 w-4" /> Regenerate my API keys
            </p>
            <p className="text-xs">Issues a brand new key. Any integration using the current keys stops working immediately.</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-[11px] font-bold uppercase">
                Your current password
                <input type="password" value={rotatePw} onChange={(e) => setRotatePw(e.target.value)} className="bk-input min-h-10 w-64 text-sm" autoComplete="current-password" />
              </label>
              <button type="submit" disabled={rotating || !rotatePw} className="bk-btn bk-fill-paper min-h-10 text-xs">
                {rotating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Regenerate keys
              </button>
            </div>
            {integrator.keysRotatedAt && <p className="text-[11px]">Last regenerated: {new Date(integrator.keysRotatedAt).toLocaleString()}</p>}
          </form>
        </BkPanel>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Password */}
          <BkPanel title="Change password">
            <form onSubmit={changePassword} className="flex flex-col gap-4">
              <BkField label="Current password" htmlFor="pw-current">
                <input id="pw-current" type="password" className="bk-input" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
              </BkField>
              <BkField label="New password" htmlFor="pw-new" hint="At least 8 characters">
                <input id="pw-new" type="password" className="bk-input" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
              </BkField>
              <BkField label="Confirm new password" htmlFor="pw-confirm" error={pw.confirm && pw.confirm !== pw.next ? "Passwords don't match" : null}>
                <input id="pw-confirm" type="password" className="bk-input" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />
              </BkField>
              <button type="submit" disabled={pwSaving || !pw.current || !pw.next} className="bk-btn bk-fill-ink self-start">
                {pwSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Change password
              </button>
            </form>
          </BkPanel>

          {/* Fees */}
          <BkPanel title="Your fees & balance" tone="bk-fill-pink">
            <dl className="flex flex-col gap-3 text-sm">
              <div className="bk-box flex items-center justify-between p-3">
                <dt className="bk-display text-xs font-bold uppercase">Collections fee</dt>
                <dd className="bk-display text-xl font-bold">{summary?.feePercentage ?? "—"}%</dd>
              </div>
              <div className="bk-box flex items-center justify-between p-3">
                <dt className="bk-display text-xs font-bold uppercase">Payout fee</dt>
                <dd className="bk-display text-xl font-bold">{summary?.payoutFeePercentage ?? "—"}%</dd>
              </div>
              <div className="bk-box flex items-center justify-between p-3">
                <dt className="bk-display text-xs font-bold uppercase">Available balance</dt>
                <dd className="bk-display text-xl font-bold">{summary?.availableBalanceRwf == null ? "—" : rwf(summary.availableBalanceRwf)}</dd>
              </div>
            </dl>
            <p className="bk-muted mt-3 text-xs">Fees are set by Soila Pay. Contact us to discuss pricing.</p>
          </BkPanel>
        </div>
      </div>
    </div>
  );
}
