"use client";

import { Moon, Sun, LogOut, User, Wifi, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useThemeStore } from "@/store/theme-store";
import { useAuthStore } from "@/store/auth-store";
import { useSettingsStore } from "@/store/settings-store";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/store/toast-store";
import { authService } from "@/services/auth.service";
import { MOCK_MODE } from "@/lib/mock";

export function TopNav() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const environment = useSettingsStore((s) => s.environment);
  const router = useRouter();

  async function handleLogout() {
    await authService.logout();
    clearSession();
    toast({ title: "Signed out", variant: "default" });
    router.push("/login");
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b-2 border-border bg-card px-5">
      <div className="flex items-center gap-3">
        <StatusBadge variant={environment === "production" ? "destructive" : "info"} dot>
          {environment === "production" ? "Production" : "Sandbox"}
        </StatusBadge>
        <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
          {MOCK_MODE ? (
            <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Wifi className="h-3.5 w-3.5 text-success" />
          )}
          {MOCK_MODE ? "Mock data" : "Live - real backend"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="nb-press flex h-9 w-9 items-center justify-center rounded-sm border-2 border-[var(--nb-ink)] bg-card text-foreground shadow-sm"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <div className="mx-1 h-6 w-0.5 bg-border" />

        <div className="flex items-center gap-2 pl-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--nb-ink)] bg-[var(--bk-pink)] text-[#111111]">
            <User className="h-4 w-4" />
          </span>
          <div className="hidden leading-tight sm:block">
            <p className="text-xs font-medium text-foreground">{user?.displayName ?? "Guest"}</p>
            <p className="text-[10px] text-muted-foreground">{user?.officeName ?? ""}</p>
          </div>
          <button
            onClick={handleLogout}
            className="nb-press flex h-9 w-9 items-center justify-center rounded-sm border-2 border-[var(--nb-ink)] bg-card text-foreground shadow-sm hover:bg-[var(--bk-red)] hover:text-[#111111]"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
