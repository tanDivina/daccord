import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#F7F1E3",
        surface: "#FFFDF4",
        "surface-elevated": "#F1EAD8",
        "surface-border": "rgba(26, 22, 15, 0.15)",
        accent: {
          DEFAULT: "#A8D912",
          alt: "#8FBC0A",
          glow: "rgba(168, 217, 18, 0.25)",
        },
        paypal: {
          blue: "#0070ba",
          dark: "#003087",
          light: "#009cde",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
        display: ["var(--font-fraunces)", "Georgia", "serif"],
      },
      boxShadow: {
        "paper-sm": "3px 3px 0 #1A160F",
        "paper-md": "6px 6px 0 #1A160F",
        "accent-glow": "3px 3px 0 #A8D912",
      },
      animation: {
        "pulse-subtle": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
export default config;
