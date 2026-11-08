// Central mock-mode switch. Every services/*.ts module checks this before
// deciding whether to hit `apiClient` or return generated mock data.
// REAL API BY DEFAULT: mocks run only when NEXT_PUBLIC_USE_MOCKS=true is set
// explicitly (e.g. for a design demo with no backend). A build that forgets
// the variable must never silently show fake data or fake payments.
// Payments (services/payment.service.ts) never use mocks at all.
export const MOCK_MODE = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

export function simulateLatency(minMs = 250, maxMs = 700): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
  };
}

export function mockId(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(6, "0")}`;
}

// Small deterministic PRNG so mock datasets are stable across renders/reloads
// instead of reshuffling on every hot-reload.
export function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}
