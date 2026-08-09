import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Integrator } from "@/types/api";

interface IntegratorPortalState {
  token: string | null;
  integrator: Integrator | null;
  isAuthenticated: boolean;
  /** The integrator's Fineract savings account ID — set once in Account Settings
   * and reused automatically on every collection request. */
  fineractAccountId: string;
  setSession: (token: string, integrator: Integrator) => void;
  updateIntegrator: (integrator: Integrator) => void;
  setFineractAccountId: (id: string) => void;
  clearSession: () => void;
}

// Deliberately separate from useAuthStore (the superadmin console's own
// login) - an integrator is a different identity, calling a different set of
// endpoints (/api/v1/integrator-portal/*, not /api/v1/auth/*).
export const useIntegratorPortalStore = create<IntegratorPortalState>()(
  persist(
    (set) => ({
      token: null,
      integrator: null,
      isAuthenticated: false,
      fineractAccountId: "1",
      setSession: (token, integrator) => set({ token, integrator, isAuthenticated: true }),
      updateIntegrator: (integrator) => set({ integrator }),
      setFineractAccountId: (id) => set({ fineractAccountId: id }),
      clearSession: () => set({ token: null, integrator: null, isAuthenticated: false }),
    }),
    { name: "soila-pay-integrator-portal" }
  )
);
