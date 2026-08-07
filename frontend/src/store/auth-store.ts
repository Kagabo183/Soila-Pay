import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthTokens, AuthUser } from "@/types/api";

interface AuthState {
  user: AuthUser | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  setSession: (user: AuthUser, tokens: AuthTokens) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,
      setSession: (user, tokens) => set({ user, tokens, isAuthenticated: true }),
      clearSession: () => set({ user: null, tokens: null, isAuthenticated: false }),
    }),
    { name: "soila-pay-auth" }
  )
);
