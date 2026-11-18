"use client";

import * as React from "react";
import { Download, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/store/toast-store";
import { paymentErrorMessage, paymentService, type ReconcileReport } from "@/services/payment.service";
import { BkPanel, rwf } from "./brutal";

/** Admin: make Soila Pay match LMBTech. "Check" re-asks LMBTech about every
 * recent transaction and corrects any that disagree (LMBTech is the source
 * of truth). "Import" adds a transaction that exists only at LMBTech. */
export function ReconcilePanel({ onChanged }: { onChanged: () => void }) {
  const [running, setRunning] = React.useState(false);
  const [report, setReport] = React.useState<ReconcileReport | null>(null);
  const [showImport, setShowImport] = React.useState(false);
  const [ref, setRef] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [channel, setChannel] = React.useState("OTHER_CARD");
  const [direction, setDirection] = React.useState<"COLLECTION" | "DISBURSEMENT" | "CASHOUT">("COLLECTION");
  const [phone, setPhone] = React.useState("");
  const [cashoutTo, setCashoutTo] = React.useState<"MOMO" | "BANK">("MOMO");
  const payout = direction === "DISBURSEMENT";
  const cashout = direction === "CASHOUT";
  const [importing, setImporting] = React.useState(false);

  async function check() {
    setRunning(true);
    try {
      const r = await paymentService.reconcile(30);
      setReport(r);
      if (r.corrected.length) onChanged();
    } catch (e) {
      toast({ title: "Check failed", description: paymentErrorMessage(e), variant: "error" });
    } finally {
      setRunning(false);
    }
  }

  async function doImport(e: React.FormEvent) {
    e.preventDefault();
    setImporting(true);
    try {
      const p = await paymentService.importFromLmbtech({
        referenceId: ref, amountRwf: Math.floor(Number(amount)), channel, direction, recipientPhone: phone, cashoutTo,
      });
      toast({
        title: cashout ? "Cash-out recorded" : payout ? "Payout imported" : "Imported",
        description: `${p.referenceId} - ${rwf(p.amountRwf)} - ${p.status}${payout || cashout ? " · see Disbursements" : ""}`,
        variant: "success",
      });
      setRef("");
      setAmount("");
      setPhone("");
      onChanged();
    } catch (err) {
      toast({ title: "Not imported", description: paymentErrorMessage(err), variant: "error" });
    } finally {
      setImporting(false);
    }
  }

  return (
    <BkPanel
      title="Match with LMBTech"
      tone="bk-fill-yellow"
      action={
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setShowImport((s) => !s)} className="bk-btn bk-fill-paper min-h-9 px-3 text-xs">
            <Download className="h-4 w-4" /> Import
          </button>
          <button type="button" onClick={check} disabled={running} className="bk-btn bk-fill-ink min-h-9 px-3 text-xs">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Check against LMBTech
          </button>
        </div>
      }
    >
      <p className="text-sm">
        Asks LMBTech about every transaction from the last 30 days and fixes any that don&apos;t match. Recently failed payments are also re-checked
        automatically in the background.
      </p>

      {report && (
        <div className={cn("bk-box mt-3 p-3 text-sm", report.corrected.length ? "bk-fill-green" : "bk-fill-paper")}>
          <p className="font-bold">
            Checked {report.checked} · {report.corrected.length ? `corrected ${report.corrected.length}` : "everything already matches ✓"}
            {report.errors ? ` · ${report.errors} could not be checked` : ""}
          </p>
          {report.corrected.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {report.corrected.map((c) => (
                <li key={c.referenceId} className="font-mono">
                  {c.referenceId} · {c.name} · {rwf(c.amountRwf)} · {c.fromStatus} → {c.toStatus}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showImport && (
        <form onSubmit={doImport} className="bk-box mt-3 flex flex-col gap-3 p-3">
          <p className="text-xs">
            For a transaction you can see on LMBTech&apos;s dashboard but not here - made outside Soila Pay, like a payout or a{" "}
            <b>cash-out</b> (money you withdrew from Soila Pay&apos;s LMBTech balance). Copy its reference from LMBTech and use the NET
            amount LMBTech shows. A cash-out LMBTech can&apos;t look up is recorded from what you enter.
          </p>
          <div className="flex gap-2">
            {([["COLLECTION", "Payment in"], ["DISBURSEMENT", "Payout out"], ["CASHOUT", "Cash-out"]] as const).map(([d, label]) => (
              <button key={d} type="button" onClick={() => setDirection(d)} aria-pressed={direction === d}
                className={cn("bk-btn min-h-9 flex-1 px-3 text-xs", direction === d ? "bk-fill-ink" : "bk-fill-paper")}>
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <label className="flex flex-col gap-1 text-[11px] font-bold uppercase">
              LMBTech reference
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="SP-…" className="bk-input min-h-10 font-mono text-sm normal-case" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-bold uppercase">
              Net amount (RWF)
              <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className="bk-input min-h-10 text-sm" />
            </label>
            {cashout ? (
              <label className="flex flex-col gap-1 text-[11px] font-bold uppercase">
                Cashed out to
                <select value={cashoutTo} onChange={(e) => setCashoutTo(e.target.value as "MOMO" | "BANK")} className="bk-input min-h-10 text-sm">
                  <option value="MOMO">MoMo</option>
                  <option value="BANK">Bank account</option>
                </select>
              </label>
            ) : payout ? (
              <label className="flex flex-col gap-1 text-[11px] font-bold uppercase">
                Sent to (optional)
                <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0788 123 456" className="bk-input min-h-10 text-sm" />
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-[11px] font-bold uppercase">
                Method
                <select value={channel} onChange={(e) => setChannel(e.target.value)} className="bk-input min-h-10 text-sm">
                  <option value="VISA">Visa</option>
                  <option value="MASTERCARD">Mastercard</option>
                  <option value="OTHER_CARD">Other card</option>
                  <option value="MTN">MTN MoMo</option>
                </select>
              </label>
            )}
            <button type="submit" disabled={importing || !ref.trim() || !Number(amount)} className="bk-btn bk-fill-green min-h-10 px-4 text-xs">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import"}
            </button>
          </div>
        </form>
      )}
    </BkPanel>
  );
}
