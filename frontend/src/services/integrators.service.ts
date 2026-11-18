import { apiClient } from "@/lib/axios";
import { MOCK_MODE, simulateLatency } from "@/lib/mock";
import { generateIntegrators } from "@/data/mock/generators";
import { mockDocumentStore } from "@/data/mock/mock-document-store";
import { EMPTY_PROFILE, integratorFromApi } from "@/lib/integrator";
import { profileInputToApi } from "@/types/api";
import type { GoLiveChecklist } from "@/services/integrator-portal.service";
import type {
  DocumentType,
  Integrator,
  IntegratorCreateRequest,
  IntegratorDocument,
  IntegratorSummary,
  IntegratorUpdateRequest,
} from "@/types/api";

let MOCK_INTEGRATORS = generateIntegrators();

// snake_case <-> camelCase at the edge (shared with the portal service).
const fromApi = integratorFromApi;

function summaryFromApi(row: {
  integrator_id: number;
  integrator_name: string;
  successful_transactions: number;
  total_collected_rwf: number;
  total_disbursed_rwf: number;
  total_fee_charged_rwf: number;
  total_gateway_cost_rwf: number;
  total_margin_rwf: number;
}): IntegratorSummary {
  return {
    integratorId: row.integrator_id,
    integratorName: row.integrator_name,
    successfulTransactions: row.successful_transactions,
    totalCollectedRwf: row.total_collected_rwf,
    totalDisbursedRwf: row.total_disbursed_rwf,
    totalFeeChargedRwf: row.total_fee_charged_rwf,
    totalGatewayCostRwf: row.total_gateway_cost_rwf,
    totalMarginRwf: row.total_margin_rwf,
  };
}

export const integratorsService = {
  /** GET /api/v1/admin/integrators */
  async list(): Promise<Integrator[]> {
    if (MOCK_MODE) {
      await simulateLatency();
      return MOCK_INTEGRATORS;
    }
    const { data } = await apiClient.get("/api/v1/admin/integrators");
    return (data as Parameters<typeof fromApi>[0][]).map(fromApi);
  },

  /**
   * POST /api/v1/admin/integrators - the returned sandboxApiKey is shown
   * once. Pass phoneNumber + password together to also give the integrator
   * working self-service portal login credentials (/portal/login) instead of
   * requiring them to sign up themselves.
   */
  async create(payload: IntegratorCreateRequest): Promise<Integrator> {
    if (MOCK_MODE) {
      await simulateLatency(400, 800);
      if (payload.phoneNumber && MOCK_INTEGRATORS.some((i) => i.phoneNumber === payload.phoneNumber)) {
        throw new Error("An integrator with this phone number already exists");
      }
      const now = new Date().toISOString();
      const created: Integrator = {
        id: Math.max(0, ...MOCK_INTEGRATORS.map((i) => i.id)) + 1,
        name: payload.name,
        sandboxApiKey: `sk_mock_${Math.random().toString(36).slice(2, 26)}`,
        productionApiKey: null,
        productionStatus: "NOT_SUBMITTED",
        productionRejectionReason: null,
        email: null,
        phoneNumber: payload.phoneNumber ?? null,
        businessLocation: null,
        taxClearanceReference: null,
        rdbCertificateReference: null,
        ipWhitelist: null,
        feePercentage: payload.feePercentage,
        isActive: true,
        ...EMPTY_PROFILE,
        createdAt: now,
        updatedAt: now,
      };
      MOCK_INTEGRATORS = [created, ...MOCK_INTEGRATORS];
      return created;
    }
    const { data } = await apiClient.post("/api/v1/admin/integrators", {
      name: payload.name.trim(),
      fee_percentage: payload.feePercentage,
      ...profileInputToApi(payload),
      ...(payload.email?.trim() ? { email: payload.email.trim() } : {}),
      ...(payload.password ? { password: payload.password } : {}),
      ...(payload.paymentFeePercentage ? { payment_fee_percentage: payload.paymentFeePercentage.toFixed(2) } : {}),
      ...(payload.payoutFeePercentage ? { payout_fee_percentage: payload.payoutFeePercentage.toFixed(2) } : {}),
    });
    return fromApi(data);
  },

  /** POST /api/v1/admin/integrators/{id}/approve-production - generates productionApiKey. */
  async approveProduction(id: number): Promise<Integrator> {
    if (MOCK_MODE) {
      await simulateLatency(300, 600);
      MOCK_INTEGRATORS = MOCK_INTEGRATORS.map((i) =>
        i.id === id
          ? {
              ...i,
              productionStatus: "APPROVED",
              productionApiKey: `sk_live_mock_${Math.random().toString(36).slice(2, 26)}`,
              productionRejectionReason: null,
              updatedAt: new Date().toISOString(),
            }
          : i
      );
      const updated = MOCK_INTEGRATORS.find((i) => i.id === id);
      if (!updated) throw new Error(`Integrator ${id} not found`);
      return updated;
    }
    const { data } = await apiClient.post(`/api/v1/admin/integrators/${id}/approve-production`);
    return fromApi(data);
  },

  /** POST /api/v1/admin/integrators/{id}/reject-production */
  async rejectProduction(id: number, reason: string): Promise<Integrator> {
    if (MOCK_MODE) {
      await simulateLatency(300, 600);
      MOCK_INTEGRATORS = MOCK_INTEGRATORS.map((i) =>
        i.id === id
          ? { ...i, productionStatus: "REJECTED", productionRejectionReason: reason, updatedAt: new Date().toISOString() }
          : i
      );
      const updated = MOCK_INTEGRATORS.find((i) => i.id === id);
      if (!updated) throw new Error(`Integrator ${id} not found`);
      return updated;
    }
    const { data } = await apiClient.post(`/api/v1/admin/integrators/${id}/reject-production`, { reason });
    return fromApi(data);
  },

  /** PATCH /api/v1/admin/integrators/{id} - name, is_active, and the
   * admin-only email / phone / username / Account Mode. */
  async update(id: number, payload: IntegratorUpdateRequest): Promise<Integrator> {
    if (MOCK_MODE) {
      await simulateLatency(300, 600);
      MOCK_INTEGRATORS = MOCK_INTEGRATORS.map((i) =>
        i.id === id
          ? {
              ...i,
              ...(payload.name !== undefined ? { name: payload.name } : {}),
              ...(payload.feePercentage !== undefined
                ? { feePercentage: payload.feePercentage }
                : {}),
              ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
              updatedAt: new Date().toISOString(),
            }
          : i
      );
      const updated = MOCK_INTEGRATORS.find((i) => i.id === id);
      if (!updated) throw new Error(`Integrator ${id} not found`);
      return updated;
    }
    const { data } = await apiClient.patch(`/api/v1/admin/integrators/${id}`, {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.feePercentage !== undefined ? { fee_percentage: payload.feePercentage } : {}),
      ...(payload.isActive !== undefined ? { is_active: payload.isActive } : {}),
      ...(payload.email !== undefined ? { email: payload.email } : {}),
      ...(payload.phoneNumber !== undefined ? { phone_number: payload.phoneNumber } : {}),
      ...(payload.username !== undefined ? { username: payload.username } : {}),
      ...(payload.accountMode !== undefined ? { account_mode: payload.accountMode } : {}),
      ...(payload.newPassword ? { new_password: payload.newPassword } : {}),
      ...(payload.firstName !== undefined ? { first_name: payload.firstName } : {}),
      ...(payload.lastName !== undefined ? { last_name: payload.lastName } : {}),
      ...(payload.address !== undefined ? { address: payload.address } : {}),
      ...(payload.location !== undefined ? { location: payload.location } : {}),
      ...(payload.city !== undefined ? { city: payload.city } : {}),
      ...(payload.country !== undefined ? { country: payload.country } : {}),
      ...(payload.bankName !== undefined ? { bank_name: payload.bankName } : {}),
      ...(payload.bankAccount !== undefined ? { bank_account: payload.bankAccount } : {}),
      ...(payload.businessLocation !== undefined ? { business_location: payload.businessLocation } : {}),
      ...(payload.ipWhitelist !== undefined ? { ip_whitelist: payload.ipWhitelist } : {}),
    });
    return fromApi(data);
  },

  /** POST /api/v1/admin/integrators/{id}/suspend-production - their live key
   * stops working now; they can't turn it back on themselves. */
  async suspendProduction(id: number, reason: string): Promise<Integrator> {
    const { data } = await apiClient.post(`/api/v1/admin/integrators/${id}/suspend-production`, { reason });
    return fromApi(data);
  },

  /** GET /api/v1/admin/integrators/{id}/checklist - the Go live checklist exactly as the integrator sees it. */
  async goLiveChecklist(id: number): Promise<GoLiveChecklist> {
    const { data } = await apiClient.get(`/api/v1/admin/integrators/${id}/checklist`);
    return { items: data.items, ready: data.ready, autoGoLive: data.auto_go_live };
  },

  /** Opens a stored document in a new tab (fetched with the admin auth header). */
  async openDocument(id: number, documentType: DocumentType): Promise<void> {
    const tab = window.open("", "_blank");
    const { data } = await apiClient.get(`/api/v1/admin/integrators/${id}/documents/${documentType}`, { responseType: "blob" });
    const url = URL.createObjectURL(data);
    if (tab) tab.location.href = url;
    else window.open(url, "_blank");
  },

  /** POST /api/v1/admin/integrators/{id}/documents - upload/replace a Go live document for them. */
  async uploadDocument(id: number, documentType: DocumentType, file: File): Promise<void> {
    const form = new FormData();
    form.append("document_type", documentType);
    form.append("file", file);
    await apiClient.post(`/api/v1/admin/integrators/${id}/documents`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  /** The integrator's profile picture as an object URL (admin auth header
   * is attached by the axios client), or null if they haven't uploaded one. */
  async profileImageUrl(integratorId: number): Promise<string | null> {
    try {
      const { data } = await apiClient.get(`/api/v1/admin/integrators/${integratorId}/documents/PROFILE_IMAGE`, {
        responseType: "blob",
      });
      return URL.createObjectURL(data);
    } catch {
      return null;
    }
  },

  /** GET /api/v1/admin/integrators/{id}/documents - metadata for KYC review, not the file bytes. */
  async listDocuments(integratorId: number): Promise<IntegratorDocument[]> {
    if (MOCK_MODE) {
      await simulateLatency(150, 300);
      return mockDocumentStore.list(integratorId);
    }
    const { data } = await apiClient.get(`/api/v1/admin/integrators/${integratorId}/documents`);
    return (data as { document_type: DocumentType; file_name: string; content_type: string; file_size_bytes: number; uploaded_at: string }[]).map(
      (row) => ({
        documentType: row.document_type,
        fileName: row.file_name,
        contentType: row.content_type,
        fileSizeBytes: row.file_size_bytes,
        uploadedAt: row.uploaded_at,
      })
    );
  },

  /** A viewable URL for GET /api/v1/admin/integrators/{id}/documents/{type} - only call for a
   * document that listDocuments() already confirmed exists. */
  documentViewUrl(integratorId: number, documentType: DocumentType): string | null {
    if (MOCK_MODE) {
      return mockDocumentStore.get(integratorId, documentType)?.objectUrl ?? null;
    }
    return `${apiClient.defaults.baseURL ?? ""}/api/v1/admin/integrators/${integratorId}/documents/${documentType}`;
  },

  /** GET /api/v1/admin/integrators/summary - collected / paid out / fees /
   * LMBTech cost / margin per integrator, from the real ledger (no mock). */
  async summary(): Promise<IntegratorSummary[]> {
    const { data } = await apiClient.get("/api/v1/admin/integrators/summary");
    return (data as Parameters<typeof summaryFromApi>[0][]).map(summaryFromApi);
  },
};
