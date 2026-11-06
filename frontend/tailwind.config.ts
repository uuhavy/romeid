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
        rome: {
          gold: "#F59E0B",
          amber: "#D97706",
          crimson: "#DC2626",
          obsidian: "#090B10",
          panel: "#111520",
        },
      },
    },
  },
  plugins: [],
};

export default config;
