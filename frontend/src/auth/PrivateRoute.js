import { useContext } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthCtx } from "./AuthContext";

/**
 * PrivateRoute
 *  1. 讀取 AuthCtx 的 token 和初始化狀態
 *  2. 若還在初始化中 → 顯示載入中
 *  3. 若未登入 → 跳轉 /login
 *  4. 若已登入 → 正常渲染 Outlet
 */
export default function PrivateRoute() {
  const { token, isInitialized } = useContext(AuthCtx);
  const location = useLocation();

  // 還在初始化中，顯示載入畫面
  if (!isInitialized) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '18px',
        color: '#666'
      }}>
        Loading...
      </div>
    );
  }

  // 初始化完成，檢查是否已登入
  if (!token) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location }}
      />
    );
  }

  return <Outlet />;
}