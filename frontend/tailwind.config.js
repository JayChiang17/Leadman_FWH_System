/* tailwind.config.js -------------------------------------------------- */
/* eslint-disable prettier/prettier */
const plugin = require("tailwindcss/plugin");

module.exports = {
  content: [
    "./public/index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],

  theme: {
    extend: {
      /* ---------- keyframes ---------- */
      keyframes: {
        /* 背景漸層圓 blob 浮動 */
        "blob-float": {
          "0%,100%": { transform: "translate(0,0) scale(1)" },
          "50%":      { transform: "translate(50px,-30px) scale(1.15)" },
        },
        "blob-float-rev": {
          "0%,100%": { transform: "translate(0,0) scale(1)" },
          "50%":      { transform: "translate(-40px,25px) scale(1.1)" },
        },
        /* 背景柔光閃爍 */
        "back-glow": {
          "0%,100%": { boxShadow: "0 0 40px rgba(34,211,238,0.05)" },
          "50%":      { boxShadow: "0 0 60px 10px rgba(34,211,238,0.12)" },
        },
        /* 新資料卡片彈跳 */
        "board-pop": {
          "0%":   { transform: "scale(1)" },
          "20%":  { transform: "scale(1.05)" },
          "100%": { transform: "scale(1)" },
        },
        /* 數字滑入 */
        "number-slide": {
          "0%":   { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },

      /* ---------- animation helpers ---------- */
      animation: {
        "blob-float":        "blob-float 12s ease-in-out infinite",
        "blob-float-rev":    "blob-float-rev 14s ease-in-out infinite",
        "back-glow":         "back-glow 6s ease-in-out infinite",
        "board-pop":         "board-pop 0.8s ease-out",
        "number-slide":      "number-slide 0.6s ease-out both",
      },

      /* 例：若想快取一個可重用的 glow 陰影 */
      boxShadow: {
        glow: "0 0 20px var(--tw-shadow-color)",
      },
    },
  },

  /* ---------- safelist ---------- */
  /* 動態字串 (bg-${color}-50/100…, text-${color}-500, border-${color}-400, stroke-*)
     在 JIT 可能掃不到，用正規式一次 safelist。 */
  safelist: [
    {
      // 基本色階（含透明度）
      pattern:
        /(bg|text|border|shadow|stroke|fill)-(sky|indigo|amber|emerald|violet|blue|cyan|yellow|orange|green|purple|red|gray|rose)-(50|100|200|300|400|500|600|700|800|900)(\/\d{2})?/,
    },
    {
      // 漸層用色
      pattern:
        /(from|via|to)-(sky|indigo|amber|emerald|violet|blue|cyan|yellow|orange|green|purple|red|gray|rose)-(50|100|200|300|400|500|600|700|800|900)(\/\d{2})?/,
    },
  ],

  plugins: [
    // 提供 bg-gradient-radial / bg-gradient-conic
    plugin(function ({ addUtilities }) {
      addUtilities({
        ".bg-gradient-radial": {
          backgroundImage: "radial-gradient(var(--tw-gradient-stops))",
        },
        ".bg-gradient-conic": {
          backgroundImage:
            "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        },
      });
    }),
  ],
};
