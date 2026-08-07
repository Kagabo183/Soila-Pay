import {
  Server,
  ShieldCheck,
  KeyRound,
  RefreshCw,
  Wallet,
  FlaskConical,
  Timer,
  HeartPulse,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DdinDiagnosticStep, DdinDiagnosticStatus } from "@/services/ddin-diagnostics.service";

type CardTone = "success" | "warning" | "destructive" | "muted";

const TONE_CLASSES: Record<CardTone, { badge: string; icon: string }> = {
  success: { badge: "bg-success/10 text-success", icon: "text-success" },
  warning: { badge: "bg-warning/10 text-warning", icon: "text-warning" },
  destructive: { badge: "bg-destructive/10 text-destructive", icon: "text-destructive" },
  muted: { badge: "bg-secondary text-muted-foreground", icon: "text-muted-foreground" },
};

function toneForStatus(status: DdinDiagnosticStatus | "OFFLINE" | "ONLINE" | undefined): CardTone {
  switch (status) {
    case "PASS":
    case "ONLINE":
      return "success";
    case "FAIL":
    case "OFFLINE":
      return "destructive";
    case "RUNNING":
      return "warning";
    default:
      return "muted";
  }
}

function labelForStatus(status: DdinDiagnosticStatus | "OFFLINE" | "ONLINE" | undefined): string {
  switch (status) {
    case "PASS":
      return "Healthy";
    case "FAIL":
      return "Failing";
    case "SKIPPED":
      return "Not tested";
    case "RUNNING":
      return "Running";
    case "ONLINE":
      return "Online";
    case "OFFLINE":
      return "Offline";
    default:
      return "No data";
  }
}

function HealthCard({
  icon: Icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: CardTone;
  hint?: string;
}) {
  const classes = TONE_CLASSES[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", classes.badge)}>
          <Icon className={cn("h-3.5 w-3.5", classes.icon)} />
        </span>
      </div>
      <p className={cn("mt-2 text-lg font-semibold", classes.icon)}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export function HealthOverviewCards({
  middlewareOnline,
  steps,
}: {
  middlewareOnline: boolean | null;
  steps: DdinDiagnosticStep[];
}) {
  const byName = Object.fromEntries(steps.map((s) => [s.step, s]));
  const login = byName["login"];
  const refresh = byName["refresh_token"];
  const balance = byName["balance"];
  const collection = byName["test_collection"];

  const withLatency = steps.filter((s) => s.latencyMs !== null);
  const avgLatency = withLatency.length
    ? Math.round(withLatency.reduce((sum, s) => sum + (s.latencyMs ?? 0), 0) / withLatency.length)
    : null;

  const scoredSteps = steps.filter((s) => s.status === "PASS" || s.status === "FAIL");
  const healthScore = scoredSteps.length
    ? Math.round((scoredSteps.filter((s) => s.status === "PASS").length / scoredSteps.length) * 100)
    : null;

  const middlewareStatus = middlewareOnline === null ? undefined : middlewareOnline ? "ONLINE" : "OFFLINE";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <HealthCard
        icon={Server}
        label="Middleware"
        value={labelForStatus(middlewareStatus)}
        tone={toneForStatus(middlewareStatus)}
        hint="Our own API, not DDIN"
      />
      <HealthCard
        icon={ShieldCheck}
        label="DDIN Authentication"
        value={labelForStatus(login?.status)}
        tone={toneForStatus(login?.status)}
      />
      <HealthCard
        icon={KeyRound}
        label="Access Token"
        value={login?.status === "PASS" ? "Obtained" : labelForStatus(login?.status)}
        tone={toneForStatus(login?.status)}
      />
      <HealthCard
        icon={RefreshCw}
        label="Refresh Token"
        value={labelForStatus(refresh?.status)}
        tone={toneForStatus(refresh?.status)}
      />
      <HealthCard
        icon={Wallet}
        label="Accounts API"
        value={labelForStatus(balance?.status)}
        tone={toneForStatus(balance?.status)}
      />
      <HealthCard
        icon={FlaskConical}
        label="Sandbox Collection"
        value={labelForStatus(collection?.status)}
        tone={toneForStatus(collection?.status)}
        hint={collection?.status === "SKIPPED" ? "Opt-in, not run" : undefined}
      />
      <HealthCard
        icon={Timer}
        label="Avg Latency"
        value={avgLatency !== null ? `${avgLatency}ms` : "—"}
        tone="muted"
      />
      <HealthCard
        icon={HeartPulse}
        label="Overall Health"
        value={healthScore !== null ? `${healthScore}%` : "—"}
        tone={healthScore === null ? "muted" : healthScore === 100 ? "success" : healthScore > 0 ? "warning" : "destructive"}
      />
    </div>
  );
}
