import { create } from "zustand";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";

/** Which ledger the money screens show. Test and real money are never shown
 * together. `null` = the account's default: Live for a live account (and the
 * admin console), Test for an account still in Test Mode. Deliberately NOT
 * persisted - every visit starts on the default (Live once you're live). */
export type MoneyView = "live" | "test";

interface MoneyViewState {
  admin: MoneyView | null;
  portal: MoneyView | null;
  /** Admin default, learned from the backend (Live unless the whole gateway is in test mode). */
  adminDefault: MoneyView;
  set: (kind: "admin" | "portal", view: MoneyView) => void;
  setAdminDefault: (view: MoneyView) => void;
}

export const useMoneyViewStore = create<MoneyViewState>()((set) => ({
  admin: null,
  portal: null,
  adminDefault: "live",
  set: (kind, view) => set(kind === "admin" ? { admin: view } : { portal: view }),
  setAdminDefault: (view) => set({ adminDefault: view }),
}));

export function portalDefaultView(): MoneyView {
  return useIntegratorPortalStore.getState().integrator?.accountMode === "PRODUCTION" ? "live" : "test";
}

/** The view a screen of this kind shows right now. */
export function currentMoneyView(kind: "admin" | "portal"): MoneyView {
  const s = useMoneyViewStore.getState();
  if (kind === "admin") return s.admin ?? s.adminDefault;
  return s.portal ?? portalDefaultView();
}

/** React hook version (re-renders when the choice or the default changes). */
export function useMoneyView(kind: "admin" | "portal"): MoneyView {
  const chosen = useMoneyViewStore((s) => (kind === "admin" ? s.admin : s.portal));
  const adminDefault = useMoneyViewStore((s) => s.adminDefault);
  const accountMode = useIntegratorPortalStore((s) => s.integrator?.accountMode);
  if (chosen) return chosen;
  if (kind === "admin") return adminDefault;
  return accountMode === "PRODUCTION" ? "live" : "test";
}
