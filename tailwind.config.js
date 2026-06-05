export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "var(--theme-bg)",
          panel: "var(--theme-panel)",
          text: "var(--theme-text)",
          muted: "var(--theme-muted)",
          accent: "var(--theme-accent)",
          soft: "var(--theme-soft)"
        }
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
