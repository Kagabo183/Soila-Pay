import { apiClient } from "@/lib/axios";
import { MOCK_MODE, simulateLatency } from "@/lib/mock";
import { mockDocumentStore } from "@/data/mock/mock-document-store";
import type {
  DocumentType,
  Integrator,
  IntegratorDocument,
  IntegratorLoginPayload,
  IntegratorSession,
  IntegratorSignupPayload,
  ProductionKycPayload,
} from "@/types/api";

// snake_case <-> camelCase at the edge, matching app/schemas/integrator.py.
function integratorFromApi(row: {
  id: number;
  name: string;
  sandbox_api_key: string;
  production_api_key: string | null;
  production_status: Integrator["productionStatus"];
  production_rejection_reason: string | null;
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

function documentFromApi(row: {
  document_type: DocumentType;
  file_name: string;
  content_type: string;
  file_size_bytes: number;
  uploaded_at: string;
}): IntegratorDocument {
  return {
    documentType: row.document_type,
    fileName: row.file_name,
    contentType: row.content_type,
    fileSizeBytes: row.file_size_bytes,
    uploadedAt: row.uploaded_at,
  };
}

interface MockAccount {
  integrator: Integrator;
  password: string;
}

// Module-level mock "database" - resets on full page reload, same tradeoff
// every other mock service in this codebase makes. The persisted
// integrator-portal-store (localStorage) is what actually survives reloads.
// Seeded with one demo account so /portal/login has a real credential to
// test with out of the box - phone 0788000111 / password Sandbox1234.
const DEMO_ACCOUNT_CREATED_AT = new Date().toISOString();
const MOCK_ACCOUNTS: MockAccount[] = [
  {
    integrator: {
      id: 0,
      name: "Demo Integrator",
      sandboxApiKey: "sk_demo_sandbox_0000000000000000000000",
      productionApiKey: null,
      productionStatus: "NOT_SUBMITTED",
      productionRejectionReason: null,
      phoneNumber: "0788000111",
      businessLocation: null,
      taxClearanceReference: null,
      rdbCertificateReference: null,
      ipWhitelist: null,
      feePercentage: 2.2,
      isActive: true,
      createdAt: DEMO_ACCOUNT_CREATED_AT,
      updatedAt: DEMO_ACCOUNT_CREATED_AT,
    },
    password: "Sandbox1234",
  },
];
let mockNextId = 1;

function mockToken(integratorId: number): string {
  return `mock-portal-session.${integratorId}.${Math.random().toString(36).slice(2, 10)}`;
}

function mockAccountForToken(token: string): MockAccount {
  const account = MOCK_ACCOUNTS.find((a) => token.startsWith(`mock-portal-session.${a.integrator.id}.`));
  if (!account) throw new Error("Session expired - log in again");
  return account;
}

export const integratorPortalService = {
  /** POST /api/v1/integrator-portal/signup - sandbox-only, just a phone number to start. */
  async signup(payload: IntegratorSignupPayload): Promise<IntegratorSession> {
    if (MOCK_MODE) {
      await simulateLatency(400, 800);
      if (MOCK_ACCOUNTS.some((a) => a.integrator.phoneNumber === payload.phoneNumber)) {
        throw new Error("An account with this phone number already exists");
      }
      const now = new Date().toISOString();
      const integrator: Integrator = {
        id: mockNextId++,
        name: payload.name,
        sandboxApiKey: `sk_mock_${Math.random().toString(36).slice(2, 26)}`,
        productionApiKey: null,
        productionStatus: "NOT_SUBMITTED",
        productionRejectionReason: null,
        phoneNumber: payload.phoneNumber,
        businessLocation: null,
        taxClearanceReference: null,
        rdbCertificateReference: null,
        ipWhitelist: null,
        feePercentage: 2.2,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      MOCK_ACCOUNTS.push({ integrator, password: payload.password });
      return { token: mockToken(integrator.id), integrator };
    }
    const { data } = await apiClient.post("/api/v1/integrator-portal/signup", {
      name: payload.name,
      phone_number: payload.phoneNumber,
      password: payload.password,
    });
    return { token: data.token, integrator: integratorFromApi(data.integrator) };
  },

  /** POST /api/v1/integrator-portal/login */
  async login(payload: IntegratorLoginPayload): Promise<IntegratorSession> {
    if (MOCK_MODE) {
      await simulateLatency(300, 700);
      const account = MOCK_ACCOUNTS.find((a) => a.integrator.phoneNumber === payload.phoneNumber);
      if (!account || account.password !== payload.password) {
        throw new Error("Invalid phone number or password");
      }
      return { token: mockToken(account.integrator.id), integrator: account.integrator };
    }
    const { data } = await apiClient.post("/api/v1/integrator-portal/login", {
      phone_number: payload.phoneNumber,
      password: payload.password,
    });
    return { token: data.token, integrator: integratorFromApi(data.integrator) };
  },

  /**
   * POST /api/v1/integrator-portal/production/documents - a real file upload
   * (multipart/form-data), not a text reference/URL. Re-uploading the same
   * documentType replaces the previous file.
   */
  async uploadProductionDocument(
    token: string,
    documentType: DocumentType,
    file: File
  ): Promise<IntegratorDocument> {
    if (MOCK_MODE) {
      await simulateLatency(500, 1100);
      const account = mockAccountForToken(token);
      const entry = mockDocumentStore.upload(account.integrator.id, documentType, file);
      return entry;
    }
    const form = new FormData();
    form.append("document_type", documentType);
    form.append("file", file);
    const { data } = await apiClient.post("/api/v1/integrator-portal/production/documents", form, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" },
    });
    return documentFromApi(data);
  },

  /** GET /api/v1/integrator-portal/production/documents - what's uploaded so far. */
  async listProductionDocuments(token: string): Promise<IntegratorDocument[]> {
    if (MOCK_MODE) {
      await simulateLatency(150, 300);
      const account = mockAccountForToken(token);
      return mockDocumentStore.list(account.integrator.id);
    }
    const { data } = await apiClient.get("/api/v1/integrator-portal/production/documents", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (data as Parameters<typeof documentFromApi>[0][]).map(documentFromApi);
  },

  /** POST /api/v1/integrator-portal/production/submit - Bearer <session token>.
   * Requires both TAX_CLEARANCE and RDB_CERTIFICATE already uploaded. */
  async submitProductionKyc(token: string, payload: ProductionKycPayload): Promise<Integrator> {
    if (MOCK_MODE) {
      await simulateLatency(500, 900);
      const account = mockAccountForToken(token);
      if (!mockDocumentStore.hasAllRequired(account.integrator.id)) {
        throw new Error("Upload both a tax clearance certificate and an RDB certificate first");
      }
      const taxDoc = mockDocumentStore.get(account.integrator.id, "TAX_CLEARANCE");
      const rdbDoc = mockDocumentStore.get(account.integrator.id, "RDB_CERTIFICATE");
      account.integrator = {
        ...account.integrator,
        businessLocation: payload.businessLocation,
        taxClearanceReference: taxDoc?.fileName ?? null,
        rdbCertificateReference: rdbDoc?.fileName ?? null,
        ipWhitelist: payload.ipWhitelist ?? null,
        productionStatus: "PENDING_REVIEW",
        productionRejectionReason: null,
        updatedAt: new Date().toISOString(),
      };
      return account.integrator;
    }
    const { data } = await apiClient.post(
      "/api/v1/integrator-portal/production/submit",
      {
        business_location: payload.businessLocation,
        ip_whitelist: payload.ipWhitelist,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return integratorFromApi(data);
  },
};
