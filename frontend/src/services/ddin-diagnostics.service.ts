import { apiClient } from "@/lib/axios";
import { useSettingsStore } from "@/store/settings-store";
import { useAuthStore } from "@/store/auth-store";

// Deliberately no MOCK_MODE branch here - the entire point of this service is
// to actually verify the real Soila Pay <-> DDIN connection, so faking a
// result would be actively misleading. If the middleware isn't running, this
// throws a real network error, which the page surfaces as "backend unreachable".

export type DdinDiagnosticStepName =
  | "config"
  | "login"
  | "refresh_token"
  | "balance"
  | "test_collection";
export type DdinDiagnosticStatus = "PASS" | "FAIL" | "SKIPPED" | "RUNNING";
export type DdinErrorCategory =
  | "NETWORK"
  | "TLS"
  | "TIMEOUT"
  | "UNAUTHORIZED"
  | "DDIN_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "CONFIG"
  | "UNEXPECTED";

export interface DiagnosticHttpDetail {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
  statusCode: number | null;
  responseBody: Record<string, unknown> | null;
}

export interface DdinDiagnosticStep {
  step: DdinDiagnosticStepName;
  status: DdinDiagnosticStatus;
  latencyMs: number | null;
  message: string;
  category: DdinErrorCategory | null;
  troubleshooting: string[];
  detail: Record<string, unknown> | null;
  requestResponse: DiagnosticHttpDetail | null;
  correlationId: string;
  startedAt: string;
}

export interface DdinDiagnosticsResult {
  overallStatus: "PASS" | "FAIL";
  baseUrl: string;
  correlationId: string;
  steps: DdinDiagnosticStep[];
  ranAt: string;
  totalDurationMs: number;
}

export interface DdinConnectionInfo {
  middlewareVersion: string;
  apiPathVersion: string;
  ddinBaseUrl: string;
  ddinLoginPath: string;
  ddinRefreshPath: string;
  ddinBalancePath: string;
  ddinCollectionPath: string;
  environment: string;
  authenticationMethod: string;
  tlsEnabled: boolean;
  requestTimeoutSeconds: number;
  retryPolicy: string;
  credentialsConfigured: boolean;
  webhookSecretConfigured: boolean;
}

export interface DiagnosticsRunOptions {
  includeRefresh?: boolean;
  includeBalance?: boolean;
  runTestCollection?: boolean;
}

interface ApiHttpDetail {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
  status_code: number | null;
  response_body: Record<string, unknown> | null;
}

interface ApiStep {
  step: DdinDiagnosticStepName;
  status: DdinDiagnosticStatus;
  latency_ms: number | null;
  message: string;
  category: DdinErrorCategory | null;
  troubleshooting: string[];
  detail: Record<string, unknown> | null;
  request_response: ApiHttpDetail | null;
  correlation_id: string;
  started_at: string;
}

function stepFromApi(s: ApiStep): DdinDiagnosticStep {
  return {
    step: s.step,
    status: s.status,
    latencyMs: s.latency_ms,
    message: s.message,
    category: s.category,
    troubleshooting: s.troubleshooting,
    detail: s.detail,
    requestResponse: s.request_response
      ? {
          method: s.request_response.method,
          url: s.request_response.url,
          headers: s.request_response.headers,
          body: s.request_response.body,
          statusCode: s.request_response.status_code,
          responseBody: s.request_response.response_body,
        }
      : null,
    correlationId: s.correlation_id,
    startedAt: s.started_at,
  };
}

function requestBody(options: DiagnosticsRunOptions) {
  return {
    include_refresh: options.includeRefresh ?? true,
    include_balance: options.includeBalance ?? true,
    run_test_collection: options.runTestCollection ?? false,
  };
}

function resultFromApi(data: {
  overall_status: "PASS" | "FAIL";
  base_url: string;
  correlation_id: string;
  ran_at: string;
  total_duration_ms: number;
  steps: ApiStep[];
}): DdinDiagnosticsResult {
  return {
    overallStatus: data.overall_status,
    baseUrl: data.base_url,
    correlationId: data.correlation_id,
    ranAt: data.ran_at,
    totalDurationMs: data.total_duration_ms,
    steps: data.steps.map(stepFromApi),
  };
}

export const ddinDiagnosticsService = {
  /** POST /api/v1/admin/ddin/diagnostics - waits for the full chain, always a real call. */
  async run(options: DiagnosticsRunOptions = {}): Promise<DdinDiagnosticsResult> {
    const { data } = await apiClient.post("/api/v1/admin/ddin/diagnostics", requestBody(options));
    return resultFromApi(data);
  },

  /** GET /api/v1/admin/ddin/diagnostics/history - server-side run history, survives a reload. */
  async getHistory(limit = 20): Promise<DdinDiagnosticsResult[]> {
    const { data } = await apiClient.get("/api/v1/admin/ddin/diagnostics/history", { params: { limit } });
    return (data as Parameters<typeof resultFromApi>[0][]).map(resultFromApi);
  },

  /** GET /api/v1/admin/ddin/ping - lightweight login-only check for uptime monitors. */
  async ping(): Promise<{ reachable: boolean; latencyMs: number | null; message: string }> {
    const { data } = await apiClient.get("/api/v1/admin/ddin/ping");
    return { reachable: data.reachable, latencyMs: data.latency_ms, message: data.message };
  },

  /**
   * POST /api/v1/admin/ddin/diagnostics/stream - real-time progress. Reads
   * newline-delimited JSON off the response body as each step completes and
   * invokes onStep immediately, rather than waiting for the whole chain.
   * fetch()+ReadableStream is used instead of EventSource because EventSource
   * can't send a POST body.
   */
  async runStream(
    options: DiagnosticsRunOptions,
    onStep: (step: DdinDiagnosticStep) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const baseUrl = useSettingsStore.getState().baseUrl || "http://localhost:8000";
    const { bearerToken } = useSettingsStore.getState();
    const adminToken = bearerToken || useAuthStore.getState().tokens?.accessToken;
    const res = await fetch(`${baseUrl}/api/v1/admin/ddin/diagnostics/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
      },
      body: JSON.stringify(requestBody(options)),
      signal,
    });
    if (res.status === 401) {
      throw new Error("Not authenticated - log in again");
    }
    if (!res.ok || !res.body) {
      throw new Error(`Diagnostics stream failed with HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        onStep(stepFromApi(JSON.parse(line) as ApiStep));
      }
    }
    if (buffer.trim()) {
      onStep(stepFromApi(JSON.parse(buffer) as ApiStep));
    }
  },

  /** GET /api/v1/admin/ddin/connection-info - static config snapshot, no network call to DDIN. */
  async getConnectionInfo(): Promise<DdinConnectionInfo> {
    const { data } = await apiClient.get("/api/v1/admin/ddin/connection-info");
    return {
      middlewareVersion: data.middleware_version,
      apiPathVersion: data.api_path_version,
      ddinBaseUrl: data.ddin_base_url,
      ddinLoginPath: data.ddin_login_path,
      ddinRefreshPath: data.ddin_refresh_path,
      ddinBalancePath: data.ddin_balance_path,
      ddinCollectionPath: data.ddin_collection_path,
      environment: data.environment,
      authenticationMethod: data.authentication_method,
      tlsEnabled: data.tls_enabled,
      requestTimeoutSeconds: data.request_timeout_seconds,
      retryPolicy: data.retry_policy,
      credentialsConfigured: data.credentials_configured,
      webhookSecretConfigured: data.webhook_secret_configured,
    };
  },
};
