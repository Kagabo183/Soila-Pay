import { CheckCircle2, XCircle, Loader2, MinusCircle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DdinDiagnosticStep, DdinDiagnosticStatus } from "@/services/ddin-diagnostics.service";

export type StepperNodeStatus = DdinDiagnosticStatus | "PENDING";

export interface StepperNode {
  id: string;
  title: string;
  status: StepperNodeStatus;
  latencyMs?: number | null;
  startedAt?: string | null;
  detailMessage?: string;
}

const ICON_MAP: Record<StepperNodeStatus, { Icon: React.ComponentType<{ className?: string }>; className: string }> = {
  PASS: { Icon: CheckCircle2, className: "text-success" },
  FAIL: { Icon: XCircle, className: "text-destructive" },
  SKIPPED: { Icon: MinusCircle, className: "text-muted-foreground" },
  RUNNING: { Icon: Loader2, className: "text-primary animate-spin" },
  PENDING: { Icon: Circle, className: "text-muted-foreground/40" },
};

/** Maps the backend's 5 real diagnostic steps onto the visual "Middleware ->
 * ... -> Diagnostics Complete" flow the ops team asked for, without
 * fabricating network calls that don't actually happen (there is no separate
 * "receive token" request - it's part of the login response). */
export function buildStepperNodes(
  steps: DdinDiagnosticStep[],
  phase: "idle" | "running" | "done"
): StepperNode[] {
  const byName = Object.fromEntries(steps.map((s) => [s.step, s]));
  const nodeFor = (name: string, title: string): StepperNode => {
    const step = byName[name];
    if (!step) {
      return { id: name, title, status: phase === "running" ? "PENDING" : "PENDING" };
    }
    return {
      id: name,
      title,
      status: step.status,
      latencyMs: step.latencyMs,
      startedAt: step.startedAt,
      detailMessage: step.message,
    };
  };

  const middlewareStatus: StepperNodeStatus =
    phase === "idle" ? "PENDING" : steps.length > 0 ? "PASS" : "RUNNING";

  const nodes: StepperNode[] = [
    { id: "middleware", title: "Middleware", status: middlewareStatus },
    nodeFor("config", "Configuration"),
    nodeFor("login", "Authenticate & Receive Token"),
    nodeFor("refresh_token", "Refresh Token"),
    nodeFor("balance", "Get Accounts"),
    nodeFor("test_collection", "Sandbox Collection (optional)"),
  ];

  const allResolved =
    steps.length >= 5 && steps.every((s) => s.status !== "RUNNING");
  nodes.push({
    id: "complete",
    title: "Diagnostics Complete",
    status: phase === "idle" ? "PENDING" : allResolved ? "PASS" : "PENDING",
  });

  return nodes;
}

export function DiagnosticsStepper({ nodes }: { nodes: StepperNode[] }) {
  return (
    <ol className="relative flex flex-col gap-0">
      {nodes.map((node, i) => {
        const { Icon, className } = ICON_MAP[node.status];
        const isLast = i === nodes.length - 1;
        return (
          <li key={node.id} className="relative flex gap-3 pb-6 last:pb-0">
            {!isLast && (
              <span className="absolute left-[11px] top-6 h-[calc(100%-8px)] w-px bg-border" />
            )}
            <Icon className={cn("h-[22px] w-[22px] shrink-0 bg-card", className)} />
            <div className="flex-1 pt-0.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium text-foreground">{node.title}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {node.latencyMs !== null && node.latencyMs !== undefined && (
                    <span>{Math.round(node.latencyMs)}ms</span>
                  )}
                  {node.startedAt && (
                    <span>{new Date(node.startedAt).toLocaleTimeString()}</span>
                  )}
                </div>
              </div>
              {node.detailMessage && (
                <p className="mt-0.5 text-xs text-muted-foreground">{node.detailMessage}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
