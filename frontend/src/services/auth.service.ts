import { apiClient } from "@/lib/axios";
import { MOCK_MODE, simulateLatency } from "@/lib/mock";
import type { AuthTokens, AuthUser, LoginResponse } from "@/types/api";

export interface LoginPayload {
  username: string;
  password: string;
}

const MOCK_USER: AuthUser = {
  id: "usr-001",
  username: "superadmin",
  displayName: "Soila Pay Super Admin",
  email: "superadmin@soilapay.rw",
  roles: ["Super User", "Ops Admin"],
  officeName: "Head Office",
};

// Dev/mock-mode credential only - see frontend/README.md "Superadmin login".
// Swap for real credential verification once MOCK_MODE is switched off.
const MOCK_SUPERADMIN_USERNAME = "superadmin";
const MOCK_SUPERADMIN_PASSWORD = "BDEa7aCQIfDklhan";

function issueMockTokens(): AuthTokens {
  const now = Date.now();
  return {
    accessToken: `mock.${btoa(`access-${now}`)}.signature`,
    refreshToken: `mock.${btoa(`refresh-${now}`)}.signature`,
    expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
  };
}

export const authService = {
  /**
   * POST /api/v1/auth/login (production - not yet exposed by the middleware).
   * Mirrors a typical JWT login response: { user, tokens }.
   */
  async login(payload: LoginPayload): Promise<LoginResponse> {
    if (MOCK_MODE) {
      await simulateLatency(400, 900);
      if (!payload.username || !payload.password) {
        throw new Error("Username and password are required");
      }
      if (
        payload.username !== MOCK_SUPERADMIN_USERNAME ||
        payload.password !== MOCK_SUPERADMIN_PASSWORD
      ) {
        throw new Error("Invalid username or password");
      }
      const tokens = issueMockTokens();
      // Best-effort: also obtain a REAL admin session token from the
      // middleware using the same credentials, so pages that always call the
      // real API regardless of mock mode (e.g. DDIN Diagnostics) still work.
      // Falls back to the mock-only token if the backend is unreachable or
      // ADMIN_USERNAME/PASSWORD doesn't match - the mock console must not
      // depend on the backend being up.
      try {
        const { data } = await apiClient.post("/api/v1/admin/auth/login", payload);
        if (data?.token) tokens.accessToken = data.token;
      } catch {
        // Backend down or credentials don't match ADMIN_USERNAME/PASSWORD - fine, stay mock-only.
      }
      return { user: MOCK_USER, tokens };
    }
    const { data } = await apiClient.post<LoginResponse>("/api/v1/auth/login", payload);
    return data;
  },

  /** POST /api/v1/auth/refresh - exchanges a refresh token for a new access token. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    if (MOCK_MODE) {
      await simulateLatency(150, 350);
      if (!refreshToken) throw new Error("Missing refresh token");
      return issueMockTokens();
    }
    const { data } = await apiClient.post<AuthTokens>("/api/v1/auth/refresh", { refreshToken });
    return data;
  },

  async logout(): Promise<void> {
    if (MOCK_MODE) {
      await simulateLatency(100, 200);
      return;
    }
    await apiClient.post("/api/v1/auth/logout");
  },

  async me(): Promise<AuthUser> {
    if (MOCK_MODE) {
      await simulateLatency(150, 300);
      return MOCK_USER;
    }
    const { data } = await apiClient.get<AuthUser>("/api/v1/auth/me");
    return data;
  },
};
