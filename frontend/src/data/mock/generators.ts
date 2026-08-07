import { seededRandom, mockId } from "@/lib/mock";
import type {
  Client,
  Loan,
  SavingsAccount,
  SavingsTransaction,
  JournalEntry,
  CollectionTransaction,
  Disbursement,
  WebhookSubscription,
  WebhookDelivery,
  Provider,
  Integrator,
  IntegratorSummary,
} from "@/types/api";

const FIRST_NAMES = [
  "Jean", "Alice", "Eric", "Grace", "Patrick", "Diane", "Emmanuel", "Claudine",
  "Vincent", "Solange", "Aline", "Bosco", "Chantal", "Damascene", "Esperance",
];
const LAST_NAMES = [
  "Uwimana", "Mugisha", "Nkurunziza", "Mukamana", "Habimana", "Ingabire",
  "Niyonsenga", "Uwase", "Bizimana", "Nyiraneza", "Karenzi", "Mutesi",
];
const OFFICES = ["Head Office", "Kigali Branch", "Musanze Branch", "Huye Branch", "Rubavu Branch"];
const LOAN_PRODUCTS = ["Agri Growth Loan", "SME Working Capital", "Salary Advance", "Asset Finance"];
const SAVINGS_PRODUCTS = ["Everyday Savings", "Youth Savings", "Fixed Term Deposit", "Group Savings"];
const GL_ACCOUNTS = [
  { code: "10101", name: "Cash at Head Office" },
  { code: "10201", name: "Loan Portfolio - Principal" },
  { code: "20101", name: "Savings Deposits" },
  { code: "40101", name: "Interest Income - Loans" },
  { code: "50201", name: "Mobile Money Collection Suspense" },
];

const rand = seededRandom(42);
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function randomInt(min: number, max: number) {
  return Math.floor(min + rand() * (max - min));
}
function randomMsisdn(prefix: string) {
  return `07${prefix}${String(randomInt(1000000, 9999999))}`;
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

export function generateClients(count = 48): Client[] {
  return Array.from({ length: count }, (_, i) => {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const statuses: Client["status"][] = ["ACTIVE", "ACTIVE", "ACTIVE", "PENDING", "INACTIVE"];
    return {
      id: mockId("CLT", i + 1),
      accountNo: `2000${String(100000 + i)}`,
      firstName: first,
      lastName: last,
      displayName: `${first} ${last}`,
      officeName: pick(OFFICES),
      status: pick(statuses),
      mobileNo: randomMsisdn(pick(["8", "9"])),
      activationDate: daysAgo(randomInt(10, 900)),
    };
  });
}

export function generateLoans(clients: Client[], count = 36): Loan[] {
  return Array.from({ length: count }, (_, i) => {
    const client = pick(clients);
    const principal = randomInt(5, 50) * 100000;
    const statuses: Loan["status"][] = ["ACTIVE", "ACTIVE", "SUBMITTED", "APPROVED", "CLOSED", "OVERPAID"];
    const status = pick(statuses);
    return {
      id: mockId("LN", i + 1),
      accountNo: `3000${String(200000 + i)}`,
      clientId: client.id,
      clientName: client.displayName,
      productName: pick(LOAN_PRODUCTS),
      principal,
      currency: "RWF",
      status,
      outstandingBalance: status === "CLOSED" ? 0 : Math.round(principal * rand()),
      interestRatePerPeriod: [12, 14, 16, 18][randomInt(0, 4)],
      submittedOnDate: daysAgo(randomInt(30, 400)),
      expectedDisbursementDate: daysAgo(randomInt(1, 30)),
    };
  });
}

export function generateSavingsAccounts(clients: Client[], count = 40): SavingsAccount[] {
  return Array.from({ length: count }, (_, i) => {
    const client = pick(clients);
    const statuses: SavingsAccount["status"][] = ["ACTIVE", "ACTIVE", "ACTIVE", "APPROVED", "PENDING", "DORMANT"];
    return {
      id: mockId("SAV", i + 1),
      accountNo: `4000${String(300000 + i)}`,
      clientId: client.id,
      clientName: client.displayName,
      productName: pick(SAVINGS_PRODUCTS),
      currency: "RWF",
      accountBalance: randomInt(2, 800) * 1000,
      status: pick(statuses),
      interestRate: [2, 3, 4, 5][randomInt(0, 4)],
      lastActiveTransactionDate: daysAgo(randomInt(0, 60)),
    };
  });
}

export function generateSavingsTransactions(accountId: string, count = 12): SavingsTransaction[] {
  let balance = randomInt(50, 500) * 1000;
  return Array.from({ length: count }, (_, i) => {
    const type: SavingsTransaction["transactionType"] = rand() > 0.4 ? "DEPOSIT" : "WITHDRAWAL";
    const amount = randomInt(2, 60) * 1000;
    balance = type === "DEPOSIT" ? balance + amount : Math.max(0, balance - amount);
    return {
      id: mockId("STX", i + 1),
      savingsAccountId: accountId,
      transactionType: type,
      amount,
      runningBalance: balance,
      date: daysAgo(count - i),
    };
  });
}

export function generateJournalEntries(count = 30): JournalEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const gl = pick(GL_ACCOUNTS);
    return {
      id: mockId("JE", i + 1),
      transactionId: mockId("TXN", i + 1),
      officeName: pick(OFFICES),
      glAccountName: gl.name,
      glAccountCode: gl.code,
      type: rand() > 0.5 ? "DEBIT" : "CREDIT",
      amount: randomInt(5, 400) * 1000,
      currency: "RWF",
      entryDate: daysAgo(randomInt(0, 45)),
      description: `Auto-posted entry for ${gl.name.toLowerCase()}`,
    };
  });
}

export function generateCollections(count = 60): CollectionTransaction[] {
  const statuses: CollectionTransaction["status"][] = [
    "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS", "FAILED_REFUNDED", "FAILED_REFUND_ERROR", "PENDING",
  ];
  const providers = ["MTN", "MTN", "AIRTEL"];
  const channels: CollectionTransaction["channel"][] = ["MTN", "AIRTEL", "BANK"];
  return Array.from({ length: count }, (_, i) => {
    const status = pick(statuses);
    const amount = randomInt(1, 30) * 1000;
    const provider = pick(providers);
    return {
      id: mockId("COL", i + 1),
      idempotencyKey: `idem-${mockId("", i + 1)}-${randomInt(1000, 9999)}`,
      fineractSavingsAccountId: `4000${String(300000 + randomInt(0, 40))}`,
      provider,
      customerAccountNumber: randomMsisdn(pick(["8", "9"])),
      customerName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      amountRwf: amount,
      status,
      debitTransactionId: status === "PENDING" ? null : mockId("DBT", i + 1),
      refundTransactionId: status.startsWith("FAILED") ? mockId("RFD", i + 1) : null,
      providerTransactionReference:
        status === "SUCCESS" ? `${provider}-${randomInt(100000, 999999)}` : null,
      channel: pick(channels),
      createdAt: daysAgo(randomInt(0, 14)),
    };
  }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function generateDisbursements(count = 40): Disbursement[] {
  const statuses: Disbursement["status"][] = ["COMPLETED", "COMPLETED", "COMPLETED", "PROCESSING", "QUEUED", "FAILED"];
  const channels: Disbursement["channel"][] = ["MTN", "AIRTEL", "BANK"];
  return Array.from({ length: count }, (_, i) => ({
    id: mockId("DIS", i + 1),
    recipientMsisdn: randomMsisdn(pick(["2", "3", "8"])),
    channel: pick(channels),
    amountRwf: randomInt(5, 200) * 1000,
    status: pick(statuses),
    narration: pick(["Loan disbursement", "Payroll", "Merchant settlement", "Refund"]),
    createdAt: daysAgo(randomInt(0, 20)),
  })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function generateWebhookSubscriptions(): WebhookSubscription[] {
  return [
    {
      id: mockId("WH", 1),
      url: "https://ops.soilapay.rw/webhooks/collections",
      events: ["collection.success", "collection.failed_refunded"],
      secretPreview: "whsec_****a91f",
      active: true,
      createdAt: daysAgo(120),
      lastDeliveryStatus: "DELIVERED",
      lastDeliveryAt: daysAgo(0),
    },
    {
      id: mockId("WH", 2),
      url: "https://staging.soilapay.rw/webhooks/disbursements",
      events: ["disbursement.completed", "disbursement.failed"],
      secretPreview: "whsec_****7c02",
      active: true,
      createdAt: daysAgo(60),
      lastDeliveryStatus: "FAILED",
      lastDeliveryAt: daysAgo(2),
    },
    {
      id: mockId("WH", 3),
      url: "https://partner-x.example.com/hooks/soila",
      events: ["collection.success"],
      secretPreview: "whsec_****11ab",
      active: false,
      createdAt: daysAgo(200),
    },
  ];
}

export function generateWebhookDeliveries(count = 15): WebhookDelivery[] {
  const events = ["collection.success", "collection.failed_refunded", "disbursement.completed"];
  const statuses: WebhookDelivery["status"][] = ["DELIVERED", "DELIVERED", "DELIVERED", "RETRYING", "FAILED"];
  return Array.from({ length: count }, (_, i) => {
    const event = pick(events);
    const status = pick(statuses);
    return {
      id: mockId("EVT", i + 1),
      event,
      status,
      attempt: status === "RETRYING" ? randomInt(2, 4) : 1,
      httpStatus: status === "FAILED" ? pick([500, 502, 504]) : 200,
      timestamp: daysAgo(randomInt(0, 10)),
      payload: {
        event,
        idempotency_key: `idem-${randomInt(100000, 999999)}`,
        amount_rwf: randomInt(1, 30) * 1000,
        status: "SUCCESS",
      },
    };
  });
}

export function generateProviders(): Provider[] {
  return [
    {
      id: "mtn",
      name: "MTN Mobile Money",
      type: "MOBILE_MONEY",
      health: "HEALTHY",
      successRate: 98.4,
      avgResponseMs: 640,
      collectionsToday: randomInt(120, 260),
      disbursementsToday: randomInt(40, 90),
    },
    {
      id: "airtel",
      name: "Airtel Money",
      type: "MOBILE_MONEY",
      health: "DEGRADED",
      successRate: 91.2,
      avgResponseMs: 1120,
      collectionsToday: randomInt(60, 150),
      disbursementsToday: randomInt(20, 60),
    },
    {
      id: "banks",
      name: "Bank Partners (RSwitch)",
      type: "BANK",
      health: "HEALTHY",
      successRate: 99.1,
      avgResponseMs: 410,
      collectionsToday: randomInt(30, 80),
      disbursementsToday: randomInt(15, 40),
    },
  ];
}

const INTEGRATOR_NAMES = [
  "Kigali Retail Traders",
  "Umurava Fintech Ltd",
  "Rwanda Agri Collect",
  "Byiringiro Enterprises",
];

// DDIN's cost to us, mirrored from the default seeded in
// db_init/002_integrators_and_fees.sql (platform_settings.ddin_cost_percentage).
export const MOCK_DDIN_COST_PERCENTAGE = 2.0;

export function generateIntegrators(count = 4): Integrator[] {
  const productionStatuses: Integrator["productionStatus"][] = [
    "APPROVED", "PENDING_REVIEW", "NOT_SUBMITTED", "REJECTED",
  ];
  return Array.from({ length: count }, (_, i) => {
    const productionStatus = productionStatuses[i] ?? "NOT_SUBMITTED";
    const approved = productionStatus === "APPROVED";
    return {
      id: i + 1,
      name: INTEGRATOR_NAMES[i] ?? `Integrator ${i + 1}`,
      sandboxApiKey: `sk_${mockId("mock", i + 1).replace(/-/g, "")}${String(randomInt(100000, 999999))}`,
      productionApiKey: approved
        ? `sk_live_${mockId("mock", i + 1).replace(/-/g, "")}${String(randomInt(100000, 999999))}`
        : null,
      productionStatus,
      productionRejectionReason: productionStatus === "REJECTED" ? "RDB certificate expired" : null,
      phoneNumber: randomMsisdn(pick(["8", "9"])),
      businessLocation: productionStatus === "NOT_SUBMITTED" ? null : "Kigali, Nyarugenge",
      taxClearanceReference: productionStatus === "NOT_SUBMITTED" ? null : `TAX-${randomInt(100000, 999999)}`,
      rdbCertificateReference: productionStatus === "NOT_SUBMITTED" ? null : `RDB-${randomInt(100000, 999999)}`,
      ipWhitelist: null,
      // "2.20 for start" - matches app/schemas/integrator.py's IntegratorCreate default.
      feePercentage: i === 0 ? 2.2 : Number((2.0 + rand() * 1.2).toFixed(2)),
      isActive: i !== count - 1,
      createdAt: daysAgo(randomInt(30, 400)),
      updatedAt: daysAgo(randomInt(0, 29)),
    };
  });
}

export function generateIntegratorSummaries(integrators: Integrator[]): IntegratorSummary[] {
  return integrators.map((integrator) => {
    const successfulTransactions = randomInt(40, 900);
    const totalCollectedRwf = successfulTransactions * randomInt(3000, 15000);
    const totalFeeChargedRwf = Math.round((totalCollectedRwf * integrator.feePercentage) / 100);
    const totalDdinCostRwf = Math.round(
      (totalCollectedRwf * MOCK_DDIN_COST_PERCENTAGE) / 100
    );
    return {
      integratorId: integrator.id,
      integratorName: integrator.name,
      currentFeePercentage: integrator.feePercentage,
      successfulTransactions,
      totalCollectedRwf,
      totalFeeChargedRwf,
      totalDdinCostRwf,
      totalMarginRwf: totalFeeChargedRwf - totalDdinCostRwf,
    };
  });
}

export function generateDailySeries(days = 14) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return {
      date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      collections: randomInt(80, 260),
      disbursements: randomInt(30, 120),
      failed: randomInt(2, 20),
    };
  });
}
