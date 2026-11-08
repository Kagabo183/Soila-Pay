"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, leftIcon, rightIcon, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-semibold text-foreground">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <span className="pointer-events-none absolute left-3 text-muted-foreground">
              {leftIcon}
            </span>
          )}
          <input
            id={inputId}
            ref={ref}
            className={cn(
              "h-10 w-full rounded-sm border-2 border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-shadow focus:shadow-[3px_3px_0_0_var(--primary)] disabled:cursor-not-allowed disabled:opacity-50",
              leftIcon && "pl-9",
              rightIcon && "pr-9",
              error && "shadow-[3px_3px_0_0_var(--destructive)] focus:shadow-[3px_3px_0_0_var(--destructive)]",
              className
            )}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3 text-muted-foreground">{rightIcon}</span>
          )}
        </div>
        {error ? (
          <p className="text-xs font-semibold text-destructive" role="alert">{error}</p>
        ) : hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    );
  }
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }
>(({ className, label, id, ...props }, ref) => {
  const generatedId = React.useId();
  const areaId = id ?? generatedId;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={areaId} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <textarea
        id={areaId}
        ref={ref}
        className={cn(
          "min-h-24 w-full rounded-sm border-2 border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-shadow focus:shadow-[3px_3px_0_0_var(--primary)] font-mono",
          className
        )}
        {...props}
      />
    </div>
  );
});
Textarea.displayName = "Textarea";
