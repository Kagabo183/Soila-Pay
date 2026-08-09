// Shared API domain types. These are shaped to match:
//  - Our own FastAPI middleware (app/schemas/collection.py, transaction_logs table)
//  - Apache Fineract's REST resource shapes (clients, loans, savings, journal entries)
// so switching services/*.ts from mock to production data is a matter of pointing
// Axios at the real base URL, not reshaping the UI.

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  roles: string[];
  officeName: string;
}

export interface LoginResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

// ---------------------------------------------------------------------------
// Clients (Fineract-shaped)
// ---------------------------------------------------------------------------

export type ClientStatus = "ACTIVE" | "PENDING" | "INACTIVE" | "CLOSED";

export interface Client {
  id: string;
  accountNo: string;
  firstName: string;
  lastName: string;
  displayName: string;
  officeName: string;
  status: ClientStatus;
  mobileNo: string;
  activationDate: string;
}

// ---------------------------------------------------------------------------
// Loans (Fineract-shaped)
// ---------------------------------------------------------------------------

export type LoanStatus = "SUBMITTED" | "APPROVED" | "ACTIVE" | "OVERPAID" | "CLOSED" | "REJECTED";

export interface Loan {
  id: string;
  accountNo: string;
  clientId: string;
  clientName: string;
  productName: string;
  principal: number;
  currency: string;
  status: LoanStatus;
  outstandingBalance: number;
  interestRatePerPeriod: number;
  submittedOnDate: string;
  expectedDisbursementDate: string;
}

// ---------------------------------------------------------------------------
// Savings (Fineract-shaped)
// ---------------------------------------------------------------------------

export type SavingsStatus = "ACTIVE" | "APPROVED" | "PENDING" | "DORMANT" | "CLOSED";

export interface SavingsAccount {
  id: string;
  accountNo: string;
  clientId: string;
  clientName: string;
  productName: string;
  currency: string;
  accountBalance: number;
  status: SavingsStatus;
  interestRate: number;
  lastActiveTransactionDate: string;
}

export interface SavingsTransaction {
  id: string;
  savingsAccountId: string;
  transactionType: "DEPOSIT" | "WITHDRAWAL";
  amount: number;
  runningBalance: number;
  date: string;
}

// ---------------------------------------------------------------------------
// Accounting (Fineract-shaped)
// ---------------------------------------------------------------------------

export interface JournalEntry {
  id: string;
  transactionId: string;
  officeName: string;
  glAccountName: string;
  glAccountCode: string;
  type: "DEBIT" | "CREDIT";
  amount: number;
  currency: string;
  entryDate: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Collection API (our middleware: POST /api/v1/collection/collect) - a mobile
// money collection aggregator. There is no utility-vending concept here.
// ---------------------------------------------------------------------------

export type CollectionStatus =
  | "SUCCESS"
  | "FAILED_REFUNDED"
  | "FAILED_REFUND_ERROR"
  | "PENDING"
  | "DEBITED"
  | "DEBIT_FAILED";

export interface CollectionTransaction {
  id: string;
  idempotencyKey: string;
  fineractSavingsAccountId: string;
  provider: "MTN" | "AIRTEL" | string;
  customerAccountNumber: string;
  customerName: string;
  amountRwf: number;
  status: CollectionStatus;
  debitTransactionId: string | null;
  refundTransactionId: string | null;
  providerTransactionReference: string | null;
  channel: "MTN" | "AIRTEL" | "BANK";
  createdAt: string;
}

export interface CollectionRequest {
  fineract_savings_account_id: string;
  provider: string;
  customer_account_number: string;
  customer_name: string;
  amount_rwf: number;
}

export interface CollectionResponse {
  status: CollectionStatus;
  idempotency_key: string;
  fineract_savings_account_id: string;
  debit_transaction_id: string | null;
  refund_transaction_id: string | null;
  provider_transaction_reference: string | null;
  amount_rwf: number;
  message: string;
  refunded: boolean;
}

// ---------------------------------------------------------------------------
// Disbursement API (placeholder - not yet implemented in the backend)
// ---------------------------------------------------------------------------

export type DisbursementStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface DisbursementRequest {
  fineract_savings_account_id: string;
  recipient_msisdn: string;
  channel: "MTN" | "AIRTEL" | "BANK";
  amount_rwf: number;
  narration?: string;
}

export interface Disbursement {
  id: string;
  recipientMsisdn: string;
  channel: "MTN" | "AIRTEL" | "BANK";
  amountRwf: number;
  status: DisbursementStatus;
  narration?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  secretPreview: string;
  active: boolean;
  createdAt: string;
  lastDeliveryStatus?: "DELIVERED" | "FAILED" | "PENDING";
  lastDeliveryAt?: string;
}

export interface WebhookRegistrationRequest {
  url: string;
  events: string[];
  description?: string;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  status: "DELIVERED" | "FAILED" | "RETRYING";
  attempt: number;
  httpStatus: number | null;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Providers (MTN / Airtel / Banks)
// ---------------------------------------------------------------------------

export type ProviderHealth = "HEALTHY" | "DEGRADED" | "DOWN";

export interface Provider {
  id: string;
  name: string;
  type: "MOBILE_MONEY" | "BANK";
  health: ProviderHealth;
  successRate: number;
  avgResponseMs: number;
  collectionsToday: number;
  disbursementsToday: number;
}

// ---------------------------------------------------------------------------
// API Playground
// ---------------------------------------------------------------------------

export interface PlaygroundEndpoint {
  id: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  name: string;
  category: string;
  description: string;
  defaultHeaders?: Record<string, string>;
  defaultBody?: Record<string, unknown>;
  requiresAuth: boolean;
}

export interface PlaygroundResult {
  status: number;
  statusText: string;
  timeMs: number;
  headers: Record<string, string>;
  body: unknown;
}

// ---------------------------------------------------------------------------
// Generic
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiIntegrationSettings {
  baseUrl: string;
  bearerToken: string;
  timeoutMs: number;
  retryCount: number;
  webhookSecret: string;
  environment: "sandbox" | "production";
}

// ---------------------------------------------------------------------------
// Integrators & margin (our own aggregator clients, and what we charge them
// on top of DDIN's cost) - shaped to match app/schemas/integrator.py and the
// GET/POST/PATCH /api/v1/admin/integrators endpoints.
// ---------------------------------------------------------------------------

export type ProductionStatus = "NOT_SUBMITTED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";

export interface Integrator {
  id: number;
  name: string;
  sandboxApiKey: string;
  productionApiKey: string | null;
  productionStatus: ProductionStatus;
  productionRejectionReason: string | null;
  email: string | null;
  phoneNumber: string | null;
  businessLocation: string | null;
  taxClearanceReference: string | null;
  rdbCertificateReference: string | null;
  ipWhitelist: string | null;
  feePercentage: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IntegratorCreateRequest {
  name: string;
  feePercentage: number;
  // Optional: set both to also hand the integrator working self-service
  // portal login credentials (they can then log in at /portal/login)
  // instead of requiring them to sign up themselves at /portal/signup.
  phoneNumber?: string;
  password?: string;
}

export interface IntegratorUpdateRequest {
  name?: string;
  feePercentage?: number;
  isActive?: boolean;
}

export interface IntegratorSummary {
  integratorId: number;
  integratorName: string;
  currentFeePercentage: number;
  successfulTransactions: number;
  totalCollectedRwf: number;
  totalFeeChargedRwf: number;
  totalDdinCostRwf: number;
  totalMarginRwf: number;
}

// ---------------------------------------------------------------------------
// Integrator self-service portal (app/api/v1/integrator_portal.py) - separate
// from the superadmin console's own auth (auth.service.ts / auth-store.ts).
// An integrator signs up with email to start testing in sandbox immediately,
// then submits KYC to unlock a production key.
// ---------------------------------------------------------------------------

export interface IntegratorSignupPayload {
  name: string;
  email: string;
  password: string;
}

export interface IntegratorLoginPayload {
  email: string;
  password: string;
}

export interface IntegratorSession {
  token: string;
  integrator: Integrator;
}

export interface ProductionKycPayload {
  businessLocation: string;
  ipWhitelist?: string;
}

export type DocumentType = "TAX_CLEARANCE" | "RDB_CERTIFICATE";

export interface IntegratorDocument {
  documentType: DocumentType;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  uploadedAt: string;
}
