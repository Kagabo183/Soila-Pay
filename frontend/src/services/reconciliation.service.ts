import { apiClient } from "@/lib/axios";
import { currentMoneyView } from "@/store/money-view-store";

/** Money columns shared by every breakdown (SUCCESS only; pending/failed counted apart). */
export interface ReconMoney {
  total_count: number;
  in_count: number;
  in_amount: number;
  out_count: number;
  out_amount: number;
  cashout_count: number;
  cashout_amount: number;
  fees: number;
  gateway_cost: number;
  margin: number;
  pending_count: number;
  pending_amount: number;
  failed_count: number;
  failed_amount: number;
}

export interface ReconBalance {
  integrator_id: number;
  integrator_name: string;
  account_mode: string;
  earned_net: number;
  spent: number;
  reserved: number;
  balance: number;
  last_activity: string | null;
}

export interface ReconAttention {
  reference_id: string;
  created_at: string;
  direction: string;
  is_cashout: number;
  status: string;
  status_message: string | null;
  gateway: string;
  channel: string;
  amount_rwf: number;
  margin_amount_rwf: number | null;
  integrator_name: string;
  source: string;
  reason: "STUCK" | "CORRECTED" | "IMPORTED" | "BELOW_COST";
}

export interface ReconReport {
  totals: ReconMoney;
  by_gateway: (ReconMoney & { gateway: string })[];
  by_channel: (ReconMoney & { direction: string; method: string; channel: string })[];
  by_route: (ReconMoney & { gateway: string; direction: string; channel: string })[];
  by_source: (ReconMoney & { source: string })[];
  by_integrator: (ReconMoney & { integrator_id: number | null; integrator_name: string })[];
  by_day: (ReconMoney & { day: string })[];
  balances: ReconBalance[];
  attention: ReconAttention[];
  owed_to_integrators: number;
  reserved_for_payouts: number;
  is_test: boolean;
  date_from: string | null;
  date_to: string | null;
}

export const reconciliationService = {
  /** One ledger (the Live / Test switch in the top bar) for a period. */
  async report(dateFrom?: string, dateTo?: string): Promise<ReconReport> {
    const { data } = await apiClient.get("/api/v1/admin/payments/reconciliation/report", {
      params: { date_from: dateFrom || undefined, date_to: dateTo || undefined, mode: currentMoneyView("admin") },
    });
    return data;
  },

  /** Pay an integrator what they're owed, on their behalf (lowers their balance). */
  async payIntegrator(integratorId: number, destination: "MOMO" | "BANK", amountRwf: number) {
    const { data } = await apiClient.post(`/api/v1/admin/payments/integrators/${integratorId}/cashout`, {
      destination,
      amount_rwf: amountRwf,
    });
    return data as { reference_id: string; status: string; status_message: string | null };
  },
};
