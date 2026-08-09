import { apiClient } from "@/lib/axios";
import { MOCK_MODE, simulateLatency } from "@/lib/mock";
import {
  generateIntegrators,
  generateIntegratorSummaries,
  MOCK_DDIN_COST_PERCENTAGE,
} from "@/data/mock/generators";
import { mockDocumentStore } from "@/data/mock/mock-document-store";
import type {
  DocumentType,
  Integrator,
  IntegratorCreateRequest,
  IntegratorDocument,
  IntegratorSummary,
  IntegratorUpdateRequest,
} from "@/types/api";

let MOCK_INTEGRATORS = generateIntegrators();
let MOCK_DDIN_COST = MOCK_DDIN_COST_PERCENTAGE;

// snake_case <-> camelCase at the edge, matching app/schemas/integrator.py.
function fromApi(row: {
  id: number;
  name: string;
  sandbox_api_key: string;
  production_api_key: string | null;
  production_status: Integrator["productionStatus"];
  production_rejection_reason: string | null;
  email: string | null;
  phone_number: string | null;
  business_location: string | null;
  tax_clearance_reference: string | null;
  rdb_certificate_reference: string | null;
  ip_whitelist: string | null;
  fee_percentage: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}): Integrator {
  return {
    id: row.id,
    name: row.name,
    sandboxApiKey: row.sandbox_api_key,
    productionApiKey: row.production_api_key,
    productionStatus: row.production_status,
    productionRejectionReason: row.production_rejection_reason,
    email: row.email,
    phoneNumber: row.phone_number,
    businessLocation: row.business_location,
    taxClearanceReference: row.tax_clearance_reference,
    rdbCertificateReference: row.rdb_certificate_reference,
    ipWhitelist: row.ip_whitelist,
    feePercentage: row.fee_percentage,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function summaryFromApi(row: {
  integrator_id: number;
  integrator_name: string;
  current_fee_percentage: number;
  successful_transactions: number;
  total_collected_rwf: number;
  total_fee_charged_rwf: number;
  total_ddin_cost_rwf: number;
  total_margin_rwf: number;
}): IntegratorSummary {
  return {
    integratorId: row.integrator_id,
    integratorName: row.integrator_name,
    currentFeePercentage: row.current_fee_percentage,
    successfulTransactions: row.successful_transactions,
    totalCollectedRwf: row.total_collected_rwf,
    totalFeeChargedRwf: row.total_fee_charged_rwf,
    totalDdinCostRwf: row.total_ddin_cost_rwf,
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
        createdAt: now,
        updatedAt: now,
      };
      MOCK_INTEGRATORS = [created, ...MOCK_INTEGRATORS];
      return created;
    }
    const { data } = await apiClient.post("/api/v1/admin/integrators", {
      name: payload.name,
      fee_percentage: payload.feePercentage,
      ...(payload.phoneNumber ? { phone_number: payload.phoneNumber } : {}),
      ...(payload.password ? { password: payload.password } : {}),
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

  /** PATCH /api/v1/admin/integrators/{id} - fee_percentage, is_active, or name. */
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
    });
    return fromApi(data);
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

  /** GET /api/v1/admin/integrators/summary - collected/charged/cost/margin per integrator. */
  async summary(): Promise<IntegratorSummary[]> {
    if (MOCK_MODE) {
      await simulateLatency();
      return generateIntegratorSummaries(MOCK_INTEGRATORS);
    }
    const { data } = await apiClient.get("/api/v1/admin/integrators/summary");
    return (data as Parameters<typeof summaryFromApi>[0][]).map(summaryFromApi);
  },

  /** GET /api/v1/admin/settings/ddin-cost-percentage - what DDIN charges us. */
  async getDdinCostPercentage(): Promise<number> {
    if (MOCK_MODE) {
      await simulateLatency(150, 300);
      return MOCK_DDIN_COST;
    }
    const { data } = await apiClient.get("/api/v1/admin/settings/ddin-cost-percentage");
    return data.ddin_cost_percentage;
  },

  /** PATCH /api/v1/admin/settings/ddin-cost-percentage */
  async setDdinCostPercentage(value: number): Promise<number> {
    if (MOCK_MODE) {
      await simulateLatency(300, 600);
      MOCK_DDIN_COST = value;
      return MOCK_DDIN_COST;
    }
    const { data } = await apiClient.patch("/api/v1/admin/settings/ddin-cost-percentage", {
      ddin_cost_percentage: value,
    });
    return data.ddin_cost_percentage;
  },
};
