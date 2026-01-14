import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./index.css";             // ← 只 @import 三份全局樣式

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);





