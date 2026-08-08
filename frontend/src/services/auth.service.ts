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

// The real backend's admin session token is a self-contained signed value
// (app/services/integrator_auth.py's create_session_token) valid for 7 days -
// see SESSION_TTL_SECONDS there. There is no separate refresh token and no
// server-side /refresh or /logout endpoint to call: the token just expires
// and the operator logs in again. This mirrors that, rather than pretending a
// refresh/logout flow exists on the backend when it doesn't.
const ADMIN_SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

function tokensFromAdminToken(token: string): AuthTokens {
  return {
    accessToken: token,
    refreshToken: token,
    expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString(),
  };
}

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
   * Real endpoint: POST /api/v1/admin/auth/login (app/api/v1/admin_auth.py) -
   * returns { token }, not { user, tokens }. Adapted to this app's generic
   * LoginResponse shape here, at the service boundary, so nothing above this
   * file needs to know the backend's admin-specific response format.
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
        const { data } = await apiClient.post<{ token: string }>("/api/v1/admin/auth/login", payload);
        if (data?.token) tokens.accessToken = data.token;
      } catch {
        // Backend down or credentials don't match ADMIN_USERNAME/PASSWORD - fine, stay mock-only.
      }
      return { user: MOCK_USER, tokens };
    }

    const { data } = await apiClient.post<{ token: string }>("/api/v1/admin/auth/login", payload);
    return {
      user: { ...MOCK_USER, username: payload.username },
      tokens: tokensFromAdminToken(data.token),
    };
  },

  /**
   * No real refresh endpoint exists (see ADMIN_SESSION_TTL_MS above) - the
   * access token IS the refresh token here. Re-wraps it with a fresh
   * expiresAt rather than calling a route that would 404.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    if (MOCK_MODE) {
      await simulateLatency(150, 350);
      if (!refreshToken) throw new Error("Missing refresh token");
      return issueMockTokens();
    }
    if (!refreshToken) throw new Error("Missing refresh token");
    return tokensFromAdminToken(refreshToken);
  },

  /**
   * No real server-side session to invalidate (stateless signed token, see
   * ADMIN_SESSION_TTL_MS above) - logging out is purely a client-side
   * clearSession() call. Nothing to send the backend.
   */
  async logout(): Promise<void> {
    if (MOCK_MODE) {
      await simulateLatency(100, 200);
    }
  },

  async me(): Promise<AuthUser> {
    if (MOCK_MODE) {
      await simulateLatency(150, 300);
      return MOCK_USER;
    }
    // No real /me endpoint - a valid session implies the shared admin
    // account, so this is reconstructed locally rather than fetched.
    return MOCK_USER;
  },
};
