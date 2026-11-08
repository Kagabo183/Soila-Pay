"use client";

import * as React from "react";
import { Check, Copy, Eye, EyeOff, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "@/store/toast-store";
import { integratorsService } from "@/services/integrators.service";
import { paymentErrorMessage } from "@/services/payment.service";
import { BkField } from "@/components/payments/brutal";
import type { Integrator } from "@/types/api";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,60}$/;

function phoneProblem(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("250")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  return d.length === 9 && d.startsWith("7") ? null : "Use a Rwandan number like 0788 123 456";
}

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const pick = (n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => chars[x % chars.length]).join("");
  return `${pick(4)}-${pick(4)}-${pick(4)}`;
}

const EMPTY = {
  name: "", firstName: "", lastName: "", email: "", phoneNumber: "", username: "", password: "",
  address: "", location: "", city: "Kigali", country: "Rwanda", bankName: "", bankAccount: "",
  paymentFee: "", payoutFee: "",
};

type Created = { integrator: Integrator; password: string };

/** Admin "New Integrator": the full LMBTech-style profile in one form, with
 * an optional portal login (email or username + password). */
export function NewIntegratorDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (i: Integrator) => void }) {
  const [f, setF] = React.useState(EMPTY);
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [showPw, setShowPw] = React.useState(false);
  const [created, setCreated] = React.useState<Created | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const errors: Partial<Record<keyof typeof EMPTY, string>> = {};
  if (!f.name.trim()) errors.name = "Company name is required";
  if (f.email && !EMAIL_RE.test(f.email.trim())) errors.email = "Enter a valid email";
  if (f.phoneNumber && phoneProblem(f.phoneNumber)) errors.phoneNumber = phoneProblem(f.phoneNumber)!;
  if (f.username && !USERNAME_RE.test(f.username.trim())) errors.username = "3-60 letters, numbers, . _ -";
  if (f.password && f.password.length < 8) errors.password = "At least 8 characters";
  if (f.password && !f.email.trim() && !f.username.trim()) errors.password = "Add an email or username so they can log in";
  for (const k of ["paymentFee", "payoutFee"] as const) {
    if (f[k] && !(Number(f[k]) > 0 && Number(f[k]) < 100)) errors[k] = "Between 0 and 100";
  }
  const show = (k: keyof typeof EMPTY) => (touched || f[k] ? errors[k] : undefined);
  const valid = Object.keys(errors).length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    try {
      const integrator = await integratorsService.create({
        name: f.name,
        feePercentage: 2.2,
        firstName: f.firstName,
        lastName: f.lastName,
        email: f.email,
        phoneNumber: f.phoneNumber,
        username: f.username,
        password: f.password || undefined,
        address: f.address,
        location: f.location,
        city: f.city,
        country: f.country,
        bankName: f.bankName,
        bankAccount: f.bankAccount,
        paymentFeePercentage: f.paymentFee ? Number(f.paymentFee) : undefined,
        payoutFeePercentage: f.payoutFee ? Number(f.payoutFee) : undefined,
      });
      setCreated({ integrator, password: f.password });
      onCreated(integrator);
    } catch (err) {
      toast({ title: "Integrator not created", description: paymentErrorMessage(err), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  const input = (k: keyof typeof EMPTY, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`ni-${k}`} className="bk-input" value={f[k]} onChange={set(k)} aria-invalid={!!show(k)} {...props} />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="New integrator" onClick={() => !saving && onClose()}>
      <div className="bk-card flex max-h-[94vh] w-full max-w-3xl flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="bk-fill-yellow flex items-center justify-between border-b-2 border-[var(--bk-ink)] px-5 py-3">
          <h2 className="bk-display text-lg font-bold uppercase">{created ? "Integrator created" : "New integrator"}</h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="bk-btn bk-fill-paper min-h-8 px-2">
            <X className="h-4 w-4" />
          </button>
        </header>

        {created ? (
          <CreatedSummary created={created} onDone={onClose} />
        ) : (
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-col gap-6 overflow-y-auto p-5">
              <Section title="Business">
                <BkField label="Company *" htmlFor="ni-name" error={show("name")}>
                  {input("name", { placeholder: "Kigali Shop Ltd", autoFocus: true, autoComplete: "organization" })}
                </BkField>
                <BkField label="First name" htmlFor="ni-firstName">
                  {input("firstName", { placeholder: "Eric", autoComplete: "given-name" })}
                </BkField>
                <BkField label="Last name" htmlFor="ni-lastName">
                  {input("lastName", { placeholder: "Mugisha", autoComplete: "family-name" })}
                </BkField>
              </Section>

              <Section title="Contact & portal login" hint="With a password they can log in at /login using their email or username.">
                <BkField label="Email" htmlFor="ni-email" error={show("email")}>
                  {input("email", { type: "email", placeholder: "owner@shop.rw", autoComplete: "off" })}
                </BkField>
                <BkField label="Phone (MTN for MoMo cash-outs)" htmlFor="ni-phoneNumber" error={show("phoneNumber")}>
                  {input("phoneNumber", { inputMode: "tel", placeholder: "0788 123 456" })}
                </BkField>
                <BkField label="Username" htmlFor="ni-username" error={show("username")}>
                  {input("username", { placeholder: "kigalishop", autoComplete: "off" })}
                </BkField>
                <BkField label="Password" htmlFor="ni-password" hint="Leave empty if they will sign up themselves" error={show("password")}>
                  <div className="flex gap-2">
                    <input
                      id="ni-password"
                      type={showPw ? "text" : "password"}
                      className="bk-input"
                      value={f.password}
                      onChange={set("password")}
                      aria-invalid={!!show("password")}
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"} className="bk-btn bk-fill-paper px-2">
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setF((s) => ({ ...s, password: generatePassword() }));
                        setShowPw(true);
                      }}
                      title="Generate a strong password"
                      className="bk-btn bk-fill-pink px-2"
                    >
                      <Sparkles className="h-4 w-4" />
                    </button>
                  </div>
                </BkField>
              </Section>

              <Section title="Address">
                <BkField label="Address" htmlFor="ni-address">{input("address", { placeholder: "KG 11 Ave" })}</BkField>
                <BkField label="Location" htmlFor="ni-location" hint="District / sector">{input("location", { placeholder: "Gasabo" })}</BkField>
                <BkField label="City" htmlFor="ni-city">{input("city")}</BkField>
                <BkField label="Country" htmlFor="ni-country">{input("country")}</BkField>
              </Section>

              <Section title="Bank account for settlement">
                <BkField label="Bank name" htmlFor="ni-bankName">{input("bankName", { placeholder: "Bank of Kigali" })}</BkField>
                <BkField label="Bank account" htmlFor="ni-bankAccount">{input("bankAccount", { inputMode: "numeric", className: "bk-input font-mono" })}</BkField>
              </Section>

              <Section title="Pricing (optional)" hint="Leave empty to use the default fees from Pricing. Can't be below LMBTech's cost.">
                <BkField label="Collection fee %" htmlFor="ni-paymentFee" error={show("paymentFee")}>
                  {input("paymentFee", { inputMode: "decimal", placeholder: "Default" })}
                </BkField>
                <BkField label="Payout fee %" htmlFor="ni-payoutFee" error={show("payoutFee")}>
                  {input("payoutFee", { inputMode: "decimal", placeholder: "Default" })}
                </BkField>
              </Section>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-[var(--bk-ink)] px-5 py-3">
              <p className="bk-muted text-xs">Starts in Test Mode with a sandbox key. Switch to Production after approving Go Live.</p>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} disabled={saving} className="bk-btn bk-fill-paper">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="bk-btn bk-fill-green">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create integrator
                </button>
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="bk-display mb-1 text-sm font-bold uppercase">{title}</legend>
      {hint && <p className="bk-muted text-xs">{hint}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function CopyRow({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [done, setDone] = React.useState(false);
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <dt className="bk-display shrink-0 text-xs font-bold uppercase">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <code className={`truncate text-sm ${secret ? "font-mono" : ""}`}>{value}</code>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() =>
            navigator.clipboard?.writeText(value).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1000);
            })
          }
          className="bk-btn bk-fill-paper min-h-7 px-1.5"
        >
          {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </dd>
    </div>
  );
}

/** Everything to hand over to the new integrator, shown once. */
function CreatedSummary({ created, onDone }: { created: Created; onDone: () => void }) {
  const i = created.integrator;
  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";
  const loginWith = [i.email, i.username].filter(Boolean).join(" or ");
  const message = [
    `Welcome to Soila Pay, ${i.firstName ?? i.name}!`,
    `Log in: ${loginUrl}`,
    loginWith && `Email/username: ${loginWith}`,
    created.password && `Password: ${created.password}`,
    `Sandbox API key: ${i.sandboxApiKey}`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-5">
      <p className="bk-box bk-fill-green p-3 text-sm font-semibold">✓ {i.name} is ready. Share these details with them now - the password is not shown again.</p>
      <dl className="bk-box divide-y-2 divide-[var(--bk-ink)]">
        <CopyRow label="Login page" value={loginUrl} />
        {loginWith && <CopyRow label="Email / username" value={loginWith} />}
        {created.password && <CopyRow label="Password" value={created.password} secret />}
        <CopyRow label="Sandbox key" value={i.sandboxApiKey} secret />
      </dl>
      <CopyRow label="Copy all as one message" value={message} />
      <button type="button" onClick={onDone} className="bk-btn bk-fill-ink self-end">
        Done
      </button>
    </div>
  );
}
