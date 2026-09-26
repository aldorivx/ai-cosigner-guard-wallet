import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
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
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
