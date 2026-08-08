import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "RWF") {
  return new Intl.NumberFormat("en-RW", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

// Soila Pay and DDIN both operate in Rwanda - every timestamp display should
// read in Rwanda's own time (CAT, UTC+2, no DST) regardless of the viewing
// browser's OS timezone, rather than silently drifting per-viewer.
export const RWANDA_TIME_ZONE = "Africa/Kigali";

export function formatDateTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: RWANDA_TIME_ZONE,
  }).format(date);
}

export function formatTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    timeStyle: "medium",
    timeZone: RWANDA_TIME_ZONE,
  }).format(date);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function truncateMiddle(value: string, chars = 6) {
  if (value.length <= chars * 2 + 3) return value;
  return `${value.slice(0, chars)}...${value.slice(-chars)}`;
}
