// 應用進入點：引入路由與全域樣式
import React from "react";
import AppRouter from "./AppRouter";
import "../index.css";   // @import 變數 / 主題 / layout 已在此檔

export default function App() {
  return <AppRouter />;
}
