"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder = "Search...", className }: SearchInputProps) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      leftIcon={<Search className="h-4 w-4" />}
      rightIcon={
        value ? (
          <button onClick={() => onChange("")} aria-label="Clear search" className="pointer-events-auto">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : undefined
      }
    />
  );
}
