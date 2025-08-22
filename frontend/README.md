src/
├── index.js                # 唯一入口 (ReactDOM  · 引入 index.css)
├── index.css               # 只做三行 @import（variables / theme / layout）
│
├── styles/                 # 全局樣式 (三檔缺一不可)
│   ├── variables.css       # 色票、spacing、字級… Design Tokens
│   ├── theme.css           # reset + 公用工具 / 動畫 / glass-card…
│   └── layout.css          # Sidebar / TopBar / page-body 版型骨架
│
├── assets/                 # 靜態資源
│   ├── company-logo.png
│   └── avatar-default.png
│
├── services/               # API / axios instance
│   └── api.js
│
├── utils/                  # 公用 JS / hooks
│   └── wsConnect.js
│
├── components/             # 可重複 UI 元件
│   ├── FlipClockTimer.js
│   └── FlipClockTimer.css
│
├── auth/                   # 登入 & 權限
│   ├── AuthContext.js
│   ├── PrivateRoute.js
│   ├── Login.js
│   └── Login.css
│
├── app/                    # 全局應用層 (路由/佈局/側欄)
│   ├── App.js
│   ├── AppRouter.js
│   ├── AppLayout.js
│   ├── Sidebar.js
│   └── Sidebar.css
│
├── features/               # 各獨立業務模組
│   ├── dashboard/
│   │   ├── Dashboard.js
│   │   └── Dashboard.css
│   │
│   ├── moduleProduction/
│   │   ├── ModuleProduction.js
│   │   └── ModuleProduction.css
│   │
│   ├── assemblyProduction/
│   │   ├── AssemblyProduction.js
│   │   └── AssemblyProduction.css
│   │
│   ├── downtime/
│   │   ├── Downtime.js
│   │   └── Downtime.css
│   │
│   ├── qcCheck/
│   │   ├── QCCheck.js
│   │   └── QCCheck.css
│   │
│   └── userPerm/
│       ├── UserPerm.js
│       └── UserPerm.css
│
└── .env                    # (可選) VITE_API_BASE / REACT_APP_API_BASE / VITE_WS_BASE
