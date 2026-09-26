import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "AI Co-Signer Guard Wallet | BNB Smart Chain",
  description: "2-of-2 Multi-Sig Smart Contract Wallet with AI Pre-Execution Security Guardrails",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <script src="https://cdn.tailwindcss.com"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              tailwind.config = {
                darkMode: 'class',
                theme: {
                  extend: {
                    colors: {
                      vault: {
                        base: "#0c1017",
                        surface: "#121824",
                        card: "#161f2e",
                        cardHover: "#1b2638",
                        border: "#1e293b",
                        borderSubtle: "#2a394f",
                      },
                      bnb: {
                        gold: "#F0B90B",
                        goldDark: "#C99A09",
                      },
                      threat: {
                        crimson: "#ef4444",
                        crimsonBg: "rgba(239, 68, 68, 0.08)",
                        crimsonBorder: "rgba(239, 68, 68, 0.25)",
                      },
                      guardian: {
                        emerald: "#10b981",
                        emeraldBg: "rgba(16, 185, 129, 0.08)",
                        emeraldBorder: "rgba(16, 185, 129, 0.25)",
                      }
                    }
                  }
                }
              }
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-[#0c1017] text-slate-100 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
