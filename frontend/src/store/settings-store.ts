import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ApiIntegrationSettings } from "@/types/api";

interface SettingsState extends ApiIntegrationSettings {
  update: (patch: Partial<ApiIntegrationSettings>) => void;
  reset: () => void;
}

export const DEFAULT_SETTINGS: ApiIntegrationSettings = {
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000",
  bearerToken: "",
  timeoutMs: 15000,
  retryCount: 2,
  webhookSecret: "",
  environment: "sandbox",
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set((state) => ({ ...state, ...patch })),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    { name: "soila-pay-api-settings" }
  )
);
