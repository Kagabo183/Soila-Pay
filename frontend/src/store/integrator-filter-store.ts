import { create } from "zustand";

/** Admin: show every money screen for one integrator only. `null` = everyone,
 * `0` = the admin console's own transactions (no integrator). Not persisted:
 * every visit starts on "All integrators". */
interface IntegratorFilterState {
  id: number | null;
  set: (id: number | null) => void;
}

export const useIntegratorFilterStore = create<IntegratorFilterState>()((set) => ({
  id: null,
  set: (id) => set({ id }),
}));

export function currentIntegratorFilter(): number | null {
  return useIntegratorFilterStore.getState().id;
}
