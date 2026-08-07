import type { DocumentType, IntegratorDocument } from "@/types/api";

// Shared in-memory mock "file storage" for KYC documents, used by both the
// integrator portal (upload) and the admin console (view) so a document
// uploaded via /portal/dashboard is actually visible from
// /settings/integrators within the same browser session - a real upload
// simulation, not a placeholder. Resets on full page reload, same tradeoff
// every other mock service in this codebase makes.

interface MockDocumentEntry extends IntegratorDocument {
  objectUrl: string;
}

const store = new Map<string, MockDocumentEntry>();

function key(integratorId: number, documentType: DocumentType): string {
  return `${integratorId}:${documentType}`;
}

export const mockDocumentStore = {
  upload(integratorId: number, documentType: DocumentType, file: File): MockDocumentEntry {
    const existing = store.get(key(integratorId, documentType));
    if (existing) URL.revokeObjectURL(existing.objectUrl);
    const entry: MockDocumentEntry = {
      documentType,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      fileSizeBytes: file.size,
      uploadedAt: new Date().toISOString(),
      objectUrl: URL.createObjectURL(file),
    };
    store.set(key(integratorId, documentType), entry);
    return entry;
  },

  list(integratorId: number): MockDocumentEntry[] {
    const prefix = `${integratorId}:`;
    return Array.from(store.entries())
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v);
  },

  get(integratorId: number, documentType: DocumentType): MockDocumentEntry | undefined {
    return store.get(key(integratorId, documentType));
  },

  hasAllRequired(integratorId: number): boolean {
    const types = new Set(this.list(integratorId).map((d) => d.documentType));
    return types.has("TAX_CLEARANCE") && types.has("RDB_CERTIFICATE");
  },
};
