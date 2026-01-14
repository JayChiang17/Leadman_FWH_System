// tailwind.config.js
module.exports = {
    content: [
      "./src/**/*.{js,jsx,ts,tsx}",
    ],
    // 禁用深色模式
    darkMode: 'class', // 改為 'class' 而不是 'media'
    theme: {
      extend: {
        colors: {
          // 自定義顏色
          gray: {
            950: '#0f1117',
          }
        },
        animation: {
          'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        },
        backdropBlur: {
          xs: '2px',
        },
        transitionDuration: {
          '400': '400ms',
        }
      },
    },
    plugins: [
      // 如果需要捲軸樣式插件
      require('tailwind-scrollbar')({ nocompatible: true }),
    ],
  }