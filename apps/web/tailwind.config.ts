import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Rajdhani'", "sans-serif"],
        body: ["'Space Grotesk'", "sans-serif"],
      },
      colors: {
        ink: "#0b1b36",
        cloud: "#f4f8ff",
        ember: "#00b6ff",
        tide: "#4abff8",
        peach: "#e7f2ff",
        mint: "#d8eeff",
      },
      boxShadow: {
        card: "0 18px 44px rgba(5, 10, 26, 0.48)",
      },
    },
  },
  plugins: [],
} satisfies Config;
