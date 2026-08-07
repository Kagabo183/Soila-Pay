import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True once the component has hydrated on the client, false during SSR and
 * the first client render. Used to gate portal-based components (Modal,
 * Drawer) and hydration-sensitive state (persisted auth) without a
 * setState-in-effect render cascade.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
