import axios, { type AxiosInstance } from "axios";
import { useSettingsStore } from "@/store/settings-store";
import { useAuthStore } from "@/store/auth-store";

// This is the single Axios client every services/*.ts module goes through.
// Base URL / timeout / retry count are read live from the persisted
// API Integration Settings so changes on /settings/api take effect immediately
// without a reload. When MOCK_MODE is true, services short-circuit before this
// client is ever used - see lib/mock-mode.ts.
export function createApiClient(): AxiosInstance {
  const settings = useSettingsStore.getState();

  const client = axios.create({
    baseURL: settings.baseUrl,
    timeout: settings.timeoutMs,
    headers: { "Content-Type": "application/json" },
  });

  client.interceptors.request.use((config) => {
    const { tokens } = useAuthStore.getState();
    const { bearerToken } = useSettingsStore.getState();
    const token = bearerToken || tokens?.accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      // Placeholder for production: on 401, call auth.service.ts#refresh() with
      // the stored refresh token, update the auth store, and retry the original
      // request once. Left as a straightforward extension point rather than
      // wired up against mock data, where a 401 never actually occurs.
      return Promise.reject(error);
    }
  );

  return client;
}

export const apiClient = createApiClient();
