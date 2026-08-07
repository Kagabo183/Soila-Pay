import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Clock, Circle } from "lucide-react";

export interface TimelineEvent {
  id: string;
  title: string;
  description?: string;
  timestamp: string;
  status?: "complete" | "pending" | "error" | "default";
}

const ICON_MAP = {
  complete: { Icon: CheckCircle2, className: "text-success" },
  pending: { Icon: Clock, className: "text-warning" },
  error: { Icon: XCircle, className: "text-destructive" },
  default: { Icon: Circle, className: "text-muted-foreground" },
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative flex flex-col gap-6 pl-1">
      {events.map((event, i) => {
        const { Icon, className } = ICON_MAP[event.status ?? "default"];
        const isLast = i === events.length - 1;
        return (
          <li key={event.id} className="relative flex gap-3">
            {!isLast && (
              <span className="absolute left-[9px] top-6 h-[calc(100%+8px)] w-px bg-border" />
            )}
            <Icon className={cn("h-[18px] w-[18px] shrink-0 bg-card", className)} />
            <div className="flex-1 pb-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{event.title}</p>
                <time className="shrink-0 text-xs text-muted-foreground">{event.timestamp}</time>
              </div>
              {event.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">{event.description}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
