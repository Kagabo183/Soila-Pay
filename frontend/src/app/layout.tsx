import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@/components/theme-script";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { NotificationViewport } from "@/components/ui/notification";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Soila Pay | Aggregator Console",
  description: "Provider dashboard, API playground, and developer portal for the Soila Pay mobile money aggregator middleware.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="h-full min-h-full">
        <ConfirmDialogProvider>
          {children}
          <NotificationViewport />
        </ConfirmDialogProvider>
      </body>
    </html>
  );
}
