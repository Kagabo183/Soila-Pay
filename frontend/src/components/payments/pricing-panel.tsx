"use client";

import * as React from "react";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/store/toast-store";
import { paymentErrorMessage, paymentService, type PaymentPricing } from "@/services/payment.service";
import { BkField, BkPanel, rwf } from "./brutal";

const EXAMPLE = 10000;
const num = (s: string) => Number(s) || 0;
const clean = (s: string) => s.replace(/[^\d.]/g, "");

function Example({ label, fee, cost }: { label: string; fee: number; cost: number }) {
  const f = (EXAMPLE * fee) / 100;
  const c = (EXAMPLE * cost) / 100;
  return (
    <div className="bk-box p-3 text-sm">
      <p className="bk-display text-xs font-bold uppercase">
        {label}: {rwf(EXAMPLE)}
      </p>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt>Integrator fee ({fee}%)</dt>
        <dd className="text-right font-semibold">+{rwf(f)}</dd>
        <dt>LMBTech cost ({cost}%)</dt>
        <dd className="text-right font-semibold">−{rwf(c)}</dd>
        <dt className="bk-display font-bold">You keep</dt>
        <dd className={cn("bk-display text-right font-bold", f - c < 0 && "text-destructive")}>{rwf(f - c)}</dd>
      </dl>
    </div>
  );
}

/** Admin: what LMBTech takes on collections and payouts, the default fees
 * integrators pay, and per-integrator overrides. The server refuses any fee
 * below LMBTech's cost, so a typo here can't make transactions lose money. */
export function PricingPanel({ onSaved }: { onSaved?: () => void }) {
  const [pricing, setPricing] = React.useState<PaymentPricing | null>(null);
  const [form, setForm] = React.useState({ cost: "", fee: "", payoutCost: "", payoutFee: "" });
  const [saving, setSaving] = React.useState(false);
  const [rows, setRows] = React.useState<Record<number, { collection: string; payout: string }>>({});
  const [rowSaving, setRowSaving] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    try {
      const p = await paymentService.getPricing();
      setPricing(p);
      setForm({
        cost: String(p.gatewayCostPercentage),
        fee: String(p.defaultFeePercentage),
        payoutCost: String(p.payoutCostPercentage),
        payoutFee: String(p.payoutDefaultFeePercentage),
      });
      setRows(
        Object.fromEntries(
          p.integrators.map((i) => [
            i.id,
            {
              collection: i.paymentFeePercentage === null ? "" : String(i.paymentFeePercentage),
              payout: i.payoutFeePercentage === null ? "" : String(i.payoutFeePercentage),
            },
          ])
        )
      );
    } catch (e) {
      toast({ title: "Could not load pricing", description: paymentErrorMessage(e), variant: "error" });
    }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const feeError = form.fee && num(form.fee) < num(form.cost) ? `Must be at least ${num(form.cost)}%` : null;
  const payoutError = form.payoutFee && num(form.payoutFee) < num(form.payoutCost) ? `Must be at least ${num(form.payoutCost)}%` : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (feeError || payoutError) return;
    setSaving(true);
    try {
      const p = await paymentService.setPricing({
        gatewayCostPercentage: num(form.cost),
        defaultFeePercentage: num(form.fee),
        payoutCostPercentage: num(form.payoutCost),
        payoutDefaultFeePercentage: num(form.payoutFee),
      });
      setPricing(p);
      toast({ title: "Pricing saved", variant: "success" });
      onSaved?.();
    } catch (err) {
      toast({ title: "Not saved", description: paymentErrorMessage(err), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function saveRow(id: number) {
    const r = rows[id] ?? { collection: "", payout: "" };
    setRowSaving(id);
    try {
      await paymentService.setIntegratorFees(id, {
        collection: r.collection.trim() === "" ? null : num(r.collection),
        payout: r.payout.trim() === "" ? null : num(r.payout),
      });
      toast({ title: "Integrator fees saved", variant: "success" });
      await load();
      onSaved?.();
    } catch (err) {
      toast({ title: "Not saved", description: paymentErrorMessage(err), variant: "error" });
    } finally {
      setRowSaving(null);
    }
  }

  if (!pricing) {
    return (
      <div className="bk-card flex items-center gap-2 p-6 text-sm font-semibold">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading pricing…
      </div>
    );
  }

  const below = pricing.integrators.filter((i) => i.belowCost);
  const field = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: clean(e.target.value) }));

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <BkPanel title="Pricing" tone="bk-fill-orange">
        <form onSubmit={save} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <BkField label="LMBTech cost - collections (%)" htmlFor="pr-cost" hint="Taken from every card / MoMo payment.">
              <input id="pr-cost" inputMode="decimal" className="bk-input" value={form.cost} onChange={field("cost")} />
            </BkField>
            <BkField label="Default fee - collections (%)" htmlFor="pr-fee" error={feeError}>
              <input id="pr-fee" inputMode="decimal" aria-invalid={!!feeError} className="bk-input" value={form.fee} onChange={field("fee")} />
            </BkField>
            <BkField label="LMBTech cost - payouts (%)" htmlFor="pr-pcost" hint="5% until LMBTech confirms the payout rate.">
              <input id="pr-pcost" inputMode="decimal" className="bk-input" value={form.payoutCost} onChange={field("payoutCost")} />
            </BkField>
            <BkField label="Default fee - payouts (%)" htmlFor="pr-pfee" error={payoutError}>
              <input id="pr-pfee" inputMode="decimal" aria-invalid={!!payoutError} className="bk-input" value={form.payoutFee} onChange={field("payoutFee")} />
            </BkField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Example label="Customer pays" fee={num(form.fee)} cost={num(form.cost)} />
            <Example label="Payout of" fee={num(form.payoutFee)} cost={num(form.payoutCost)} />
          </div>
          <button type="submit" disabled={saving || !!feeError || !!payoutError} className="bk-btn bk-fill-green self-start">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save pricing
          </button>
        </form>
      </BkPanel>

      <BkPanel title="Fees per integrator" tone="bk-fill-blue">
        {below.length > 0 && (
          <p className="bk-box bk-fill-red mb-4 flex items-start gap-2 p-3 text-sm font-semibold">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Priced below LMBTech&apos;s cost: {below.map((i) => i.name).join(", ")}.
          </p>
        )}
        {pricing.integrators.length === 0 ? (
          <p className="bk-muted text-sm">No integrators yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pricing.integrators.map((i) => (
              <li key={i.id} className={cn("bk-box p-3", i.belowCost && "bk-fill-red")}>
                <p className="font-bold">{i.name}</p>
                <p className="text-xs opacity-80">
                  Collections {i.effectiveFeePercentage}% {i.paymentFeePercentage === null ? "(default)" : ""} · Payouts {i.effectivePayoutFeePercentage}%{" "}
                  {i.payoutFeePercentage === null ? "(default)" : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-[11px] font-bold uppercase">
                    Collections %
                    <input
                      inputMode="decimal"
                      placeholder={`${pricing.defaultFeePercentage}`}
                      value={rows[i.id]?.collection ?? ""}
                      onChange={(e) => setRows((r) => ({ ...r, [i.id]: { ...(r[i.id] ?? { payout: "" }), collection: clean(e.target.value) } }))}
                      className="bk-input min-h-10 w-28 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-bold uppercase">
                    Payouts %
                    <input
                      inputMode="decimal"
                      placeholder={`${pricing.payoutDefaultFeePercentage}`}
                      value={rows[i.id]?.payout ?? ""}
                      onChange={(e) => setRows((r) => ({ ...r, [i.id]: { ...(r[i.id] ?? { collection: "" }), payout: clean(e.target.value) } }))}
                      className="bk-input min-h-10 w-28 text-sm"
                    />
                  </label>
                  <button type="button" onClick={() => saveRow(i.id)} disabled={rowSaving === i.id} className="bk-btn bk-fill-paper min-h-10 px-3 text-xs">
                    {rowSaving === i.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="bk-muted mt-3 text-xs">Leave a box empty and save to use the default fee.</p>
      </BkPanel>
    </div>
  );
}
