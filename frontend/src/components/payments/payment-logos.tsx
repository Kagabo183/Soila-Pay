import { CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

/** Recognisable marks for payment methods. Drawn inline (no network, both
 * themes) - each sits on its own fixed brand colour with an ink border so it
 * reads as a brutalist "sticker". */

const sticker = "inline-flex h-10 w-16 shrink-0 items-center justify-center border-2 border-[var(--bk-ink)]";

export function MtnMomoLogo({ className }: { className?: string }) {
  return (
    <span className={cn(sticker, "bg-[#ffcc00] text-[12px] font-black leading-none text-[#004f71]", className)} aria-label="MTN Mobile Money">
      MoMo
    </span>
  );
}

export function VisaLogo({ className }: { className?: string }) {
  return (
    <span className={cn(sticker, "bg-[#1a1f71] text-lg font-extrabold italic tracking-tight text-white", className)} aria-label="Visa">
      VISA
    </span>
  );
}

export function MastercardLogo({ className }: { className?: string }) {
  return (
    <span className={cn(sticker, "bg-[#141413]", className)} aria-label="Mastercard">
      <svg viewBox="0 0 40 24" className="h-6 w-10" aria-hidden="true">
        <circle cx="15" cy="12" r="9" fill="#eb001b" />
        <circle cx="25" cy="12" r="9" fill="#f79e1b" />
        <path d="M20 4.5a9 9 0 0 1 0 15 9 9 0 0 1 0-15z" fill="#ff5f00" />
      </svg>
    </span>
  );
}

export function OtherCardLogo({ className }: { className?: string }) {
  return (
    <span className={cn(sticker, "bg-white text-[#111111]", className)} aria-label="Other card">
      <CreditCard className="h-5 w-5" />
    </span>
  );
}

export function ChannelLogo({ channel, className }: { channel: string; className?: string }) {
  switch (channel) {
    case "MTN":
    case "MTN_MOMO":
      return <MtnMomoLogo className={className} />;
    case "VISA":
      return <VisaLogo className={className} />;
    case "MASTERCARD":
      return <MastercardLogo className={className} />;
    default:
      return <OtherCardLogo className={className} />;
  }
}

export function channelLabel(channel: string): string {
  switch (channel) {
    case "MTN":
    case "MTN_MOMO":
      return "MTN Mobile Money";
    case "VISA":
      return "Visa";
    case "MASTERCARD":
      return "Mastercard";
    default:
      return "Other card";
  }
}

/** Flat accent colour per method for tiles/rows. */
export function channelFill(channel: string): string {
  switch (channel) {
    case "MTN":
    case "MTN_MOMO":
      return "bk-fill-yellow";
    case "VISA":
      return "bk-fill-blue";
    case "MASTERCARD":
      return "bk-fill-orange";
    default:
      return "bk-fill-pink";
  }
}
