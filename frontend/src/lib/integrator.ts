import type { Integrator } from "@/types/api";

/** The integrator row as the API returns it (app/schemas/integrator.py). */
export interface IntegratorApiRow {
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
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  address?: string | null;
  location?: string | null;
  city?: string | null;
  country?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  account_mode?: Integrator["accountMode"];
  keys_rotated_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** snake_case -> camelCase, shared by the admin and portal services. */
export function integratorFromApi(row: IntegratorApiRow): Integrator {
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
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    username: row.username ?? null,
    address: row.address ?? null,
    location: row.location ?? null,
    city: row.city ?? null,
    country: row.country ?? null,
    bankName: row.bank_name ?? null,
    bankAccount: row.bank_account ?? null,
    accountMode: row.account_mode ?? "TEST",
    keysRotatedAt: row.keys_rotated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Empty profile, for locally-built (mock) integrators. */
export const EMPTY_PROFILE: Pick<
  Integrator,
  "firstName" | "lastName" | "username" | "address" | "location" | "city" | "country" | "bankName" | "bankAccount" | "accountMode" | "keysRotatedAt"
> = {
  firstName: null,
  lastName: null,
  username: null,
  address: null,
  location: null,
  city: null,
  country: "Rwanda",
  bankName: null,
  bankAccount: null,
  accountMode: "TEST",
  keysRotatedAt: null,
};
