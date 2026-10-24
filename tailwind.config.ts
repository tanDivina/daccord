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
        background: "#050507",
        surface: "#0c0c0f",
        "surface-elevated": "#131318",
        "surface-border": "rgba(255, 255, 255, 0.07)",
        accent: {
          DEFAULT: "#a8ff35",
          alt: "#7cd315",
          glow: "rgba(168, 255, 53, 0.15)",
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
      },
      boxShadow: {
        "glass-sm": "0 4px 20px -2px rgba(0, 0, 0, 0.5), inset 0 1px 0 0 rgba(255, 255, 255, 0.05)",
        "glass-md": "0 8px 30px -4px rgba(0, 0, 0, 0.6), inset 0 1px 0 0 rgba(255, 255, 255, 0.08)",
        "accent-glow": "0 0 35px -5px rgba(168, 255, 53, 0.25)",
      },
      animation: {
        "pulse-subtle": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
export default config;
