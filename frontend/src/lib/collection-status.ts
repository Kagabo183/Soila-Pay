import type { CollectionStatus } from "@/types/api";

/**
 * DDIN's own Collection API vocabulary is exactly three words: pending,
 * success, failed (confirmed live via GET /v1/momo/collection/{referenceId}
 * - see app/services/collection_provider.py). Everything else in our own
 * CollectionStatus type (DEBITED, DEBIT_FAILED, FAILED_REFUND_ERROR) is
 * Soila Pay's internal bookkeeping around the Fineract wallet debit and
 * refund - DDIN has no notion of those states at all. The customer/UI-facing
 * label always collapses to one of DDIN's three words; the internal detail
 * (e.g. "wallet debit failed before DDIN was ever contacted", or "refund
 * itself failed - needs manual reconciliation") belongs in the transaction's
 * message text, not the primary status word.
 */
export type DdinCollectionStatus = "Pending" | "Success" | "Failed";

export function collectionStatusLabel(status: CollectionStatus): DdinCollectionStatus {
  switch (status) {
    case "SUCCESS":
      return "Success";
    case "PENDING":
    case "DEBITED":
      return "Pending";
    case "FAILED_REFUNDED":
    case "FAILED_REFUND_ERROR":
    case "DEBIT_FAILED":
      return "Failed";
  }
}

export function collectionStatusTone(
  status: CollectionStatus
): "success" | "warning" | "destructive" {
  const label = collectionStatusLabel(status);
  if (label === "Success") return "success";
  if (label === "Pending") return "warning";
  return "destructive";
}
