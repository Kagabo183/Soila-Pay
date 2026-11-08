"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-semibold disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Medium brutalism: 2px ink outline + 2px hard shadow; .nb-press
        // (globals.css) lifts on hover and sinks on press.
        default: "nb-press border-2 border-[var(--nb-ink)] bg-primary text-primary-foreground shadow-sm",
        secondary: "nb-press border-2 border-[var(--nb-ink)] bg-accent text-accent-foreground shadow-sm",
        outline: "nb-press border-2 border-[var(--nb-ink)] bg-card text-foreground shadow-sm hover:bg-secondary",
        ghost: "border-2 border-transparent hover:border-[var(--nb-ink)] hover:bg-secondary",
        destructive: "nb-press border-2 border-[var(--nb-ink)] bg-destructive text-destructive-foreground shadow-sm",
        link: "text-primary underline decoration-2 underline-offset-4 hover:decoration-[3px]",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-9 px-4",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
