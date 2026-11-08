"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, ShieldCheck, Zap } from "lucide-react";
import { BkField } from "@/components/payments/brutal";
import { integratorPortalService } from "@/services/integrator-portal.service";
import { paymentErrorMessage } from "@/services/payment.service";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import { toast } from "@/store/toast-store";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,60}$/;

function phoneProblem(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (!d) return "Enter your phone number";
  if (d.startsWith("250")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  return d.length === 9 && d.startsWith("7") ? null : "Use a Rwandan number like 0788 123 456";
}

const EMPTY = {
  name: "", firstName: "", lastName: "", email: "", phoneNumber: "", username: "", password: "", confirm: "",
  address: "", location: "", city: "Kigali", country: "Rwanda", bankName: "", bankAccount: "",
};

/** Become an integrator - the application form (like LMBTech's "Create one").
 * Company, owner, contact and login are required; address and bank can be
 * added now or later on the Account page. Starts in Test Mode. */
export default function IntegratorSignupPage() {
  const router = useRouter();
  const setSession = useIntegratorPortalStore((s) => s.setSession);
  const isAuthenticated = useIntegratorPortalStore((s) => s.isAuthenticated);
  const [f, setF] = React.useState(EMPTY);
  const [agree, setAgree] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const [showPw, setShowPw] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (isAuthenticated) router.replace("/portal/dashboard");
  }, [isAuthenticated, router]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const errors: Partial<Record<keyof typeof EMPTY | "agree", string>> = {};
  if (!f.name.trim()) errors.name = "Enter your company name";
  if (!f.firstName.trim()) errors.firstName = "Enter your first name";
  if (!f.lastName.trim()) errors.lastName = "Enter your last name";
  if (!EMAIL_RE.test(f.email.trim())) errors.email = "Enter a valid email";
  const pp = phoneProblem(f.phoneNumber);
  if (pp) errors.phoneNumber = pp;
  if (f.username && !USERNAME_RE.test(f.username.trim())) errors.username = "3-60 letters, numbers, . _ -";
  if (f.password.length < 8) errors.password = "At least 8 characters";
  if (f.confirm !== f.password) errors.confirm = "Passwords don't match";
  if (!agree) errors.agree = "Please accept to continue";
  const show = (k: keyof typeof errors) => (touched || (k !== "agree" && f[k as keyof typeof EMPTY]) ? errors[k] : undefined);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) {
      toast({ title: "Check the form", description: "Some required fields need attention.", variant: "error" });
      return;
    }
    setLoading(true);
    try {
      const { token, integrator } = await integratorPortalService.signup({
        name: f.name,
        firstName: f.firstName,
        lastName: f.lastName,
        email: f.email,
        phoneNumber: f.phoneNumber,
        username: f.username,
        password: f.password,
        address: f.address,
        location: f.location,
        city: f.city,
        country: f.country,
        bankName: f.bankName,
        bankAccount: f.bankAccount,
      });
      setSession(token, integrator);
      toast({ title: `Welcome, ${integrator.firstName ?? integrator.name}`, description: "Your account is ready in Test Mode.", variant: "success" });
      router.push("/portal/dashboard");
    } catch (err) {
      toast({ title: "Account not created", description: paymentErrorMessage(err), variant: "error" });
    } finally {
      setLoading(false);
    }
  }

  const input = (k: keyof typeof EMPTY, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`su-${k}`} className="bk-input" value={f[k]} onChange={set(k)} aria-invalid={!!show(k)} {...props} />
  );

  return (
    <div className="min-h-screen bg-[var(--bk-page)] px-4 py-10 text-[var(--bk-ink)]">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col items-center gap-2 text-center">
          <span className="bk-box bk-fill-yellow flex h-12 w-12 items-center justify-center shadow-[var(--bk-shadow-sm)]">
            <Zap className="h-6 w-6" />
          </span>
          <h1 className="bk-display text-3xl font-bold uppercase">Become a Soila Pay integrator</h1>
          <p className="bk-muted max-w-lg text-sm">
            Accept cards and MTN MoMo, and send payouts. Fill in your details - you can start testing right away.
          </p>
        </header>

        <form onSubmit={submit} noValidate className="bk-card flex flex-col gap-7 p-5 sm:p-7">
          <Section title="1. Your business">
            <BkField label="Company *" htmlFor="su-name" error={show("name")}>
              {input("name", { placeholder: "Kigali Shop Ltd", autoComplete: "organization", autoFocus: true })}
            </BkField>
            <BkField label="First name *" htmlFor="su-firstName" error={show("firstName")}>
              {input("firstName", { autoComplete: "given-name" })}
            </BkField>
            <BkField label="Last name *" htmlFor="su-lastName" error={show("lastName")}>
              {input("lastName", { autoComplete: "family-name" })}
            </BkField>
          </Section>

          <Section title="2. Contact & login">
            <BkField label="Email *" htmlFor="su-email" hint="You log in with this" error={show("email")}>
              {input("email", { type: "email", placeholder: "you@company.rw", autoComplete: "email" })}
            </BkField>
            <BkField label="Phone *" htmlFor="su-phoneNumber" hint="MTN number for MoMo cash-outs" error={show("phoneNumber")}>
              {input("phoneNumber", { inputMode: "tel", placeholder: "0788 123 456", autoComplete: "tel" })}
            </BkField>
            <BkField label="Username (optional)" htmlFor="su-username" hint="You can log in with it too" error={show("username")}>
              {input("username", { placeholder: "kigalishop", autoComplete: "username" })}
            </BkField>
            <BkField label="Password *" htmlFor="su-password" hint="At least 8 characters" error={show("password")}>
              <div className="flex gap-2">
                <input
                  id="su-password"
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
              </div>
            </BkField>
            <BkField label="Confirm password *" htmlFor="su-confirm" error={show("confirm")}>
              {input("confirm", { type: showPw ? "text" : "password", autoComplete: "new-password" })}
            </BkField>
          </Section>

          <Section title="3. Address" hint="Optional now - you can add it later on your Account page.">
            <BkField label="Address" htmlFor="su-address">{input("address", { placeholder: "KG 11 Ave", autoComplete: "street-address" })}</BkField>
            <BkField label="Location" htmlFor="su-location" hint="District / sector">{input("location", { placeholder: "Gasabo" })}</BkField>
            <BkField label="City" htmlFor="su-city">{input("city")}</BkField>
            <BkField label="Country" htmlFor="su-country">{input("country", { autoComplete: "country-name" })}</BkField>
          </Section>

          <Section title="4. Bank account" hint="Where Soila Pay sends the money you collect. Optional now.">
            <BkField label="Bank name" htmlFor="su-bankName">{input("bankName", { placeholder: "Bank of Kigali" })}</BkField>
            <BkField label="Bank account" htmlFor="su-bankAccount">{input("bankAccount", { inputMode: "numeric", className: "bk-input font-mono" })}</BkField>
          </Section>

          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--bk-ink)]" />
            <span>
              I confirm these details are correct and accept Soila Pay&apos;s terms of service.
              {show("agree") && <span className="block font-semibold text-[var(--bk-red)]">✕ {errors.agree}</span>}
            </span>
          </label>

          <button type="submit" disabled={loading} className="bk-btn bk-fill-green h-14 text-lg">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Create my account
          </button>

          <p className="bk-box flex items-start gap-2 p-3 text-xs">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            You start in Test Mode with a sandbox key - no documents needed. To go live, upload your RDB and tax documents from your dashboard.
          </p>
        </form>

        <p className="text-center text-sm">
          Already have an account?{" "}
          <Link href="/login" className="font-bold underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="bk-display mb-1 text-base font-bold uppercase">{title}</legend>
      {hint && <p className="bk-muted text-xs">{hint}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
