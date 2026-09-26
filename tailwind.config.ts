import type { Config } from "tailwindcss";

/**
 * Palette extracted from the CodeBiome Claude Design artifact
 * (Main/World/Investigation/Scanning.dc.html), extended once for the
 * "explorable architectural world" redesign (docs — WorldExperience/
 * world-engine). Fixed meaning per accent: teal = healthy business
 * domain/traveled, amber = important/active, periwinkle = Bob,
 * ember = danger/security, slateBlue = infrastructure (tests/docs)
 * domains — explicitly required to read as distinct from both the
 * business teal/moss language and Bob's own periwinkle. Everything else is
 * slate/forest neutrals.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        biome: {
          bg: "#0A0D12",
          panel: "#12171D",
          panelAlt: "#0F1319",
          code: "#0D1116",
          field: "#171E26",
          border: "rgba(255,255,255,0.10)",
          borderStrong: "rgba(255,255,255,0.16)",
        },
        ink: {
          primary: "#F3F1EA",
          bright: "#F8F6EF",
          secondary: "#B7BDC3",
          faint: "#9CA6AC",
          muted: "#6B7580",
          dim: "#4D4C48",
        },
        teal: { DEFAULT: "#4FD1C5" },
        amber: { DEFAULT: "#F2B84B", ink: "#171208" },
        periwinkle: { DEFAULT: "#7C9CFF", light: "#B9C8FF", pale: "#DCE3FF" },
        ember: { DEFAULT: "#E0553F" },
        slateBlue: { DEFAULT: "#5E7A9E" },
        canopy: { deep: "#1F5C41", mid: "#2E7A54", light: "#3FA672" },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "'SF Mono'", "Menlo", "monospace"],
      },
      keyframes: {
        "cb-pulse": { "0%,100%": { opacity: "0.55" }, "50%": { opacity: "1" } },
        "cb-float": { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-5px)" } },
      },
      animation: {
        "cb-pulse": "cb-pulse 3.2s ease-in-out infinite",
        "cb-float": "cb-float 4.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
