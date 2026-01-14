import React, { useContext } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from "react-router-dom";

import { AuthProvider, AuthCtx } from "../auth/AuthContext";
import PrivateRoute from "../auth/PrivateRoute";
import AppLayout from "./AppLayout";

/* ───── public ───── */
import Login from "../auth/Login";

/* ───── features ───── */
import Dashboard from "../features/dashboard/Dashboard";
import ModuleProduction from "../features/moduleProduction/ModuleProduction";
import AssemblyProduction from "../features/assemblyProduction/AssemblyProduction";
import Downtime from "../features/downtime/Downtime";
import QCCheck from "../features/qcCheck/QCCheck";
import UserPerm from "../features/userPerm/UserPerm";
import Search from "../features/search/Search";
import AIQuery from "../features/aiQuery/AIQuery";
import ProductionCharts from "../features/productionCharts/ProductionCharts";
import NGDashboard from "../features/ngDashboard/NGDashboard";
import PCBATracking from "../features/pcbaTracking/PCBATracking";
import Equipment from "../features/equipment/Equipment";
import EmailSettings from "../features/emailSettings/EmailSettings";
import ATETesting from "../features/ateTesting/ATETesting";

/* ───── role guard (admin only) ───── */
function AdminRoute() {
  const { role, isInitialized } = useContext(AuthCtx);

  // 等待認證初始化完成，避免閃爍/錯誤重定向
  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return role === "admin" ? <Outlet /> : <Navigate to="/" replace />;
}

export default function AppRouter() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* -------- public -------- */}
          <Route path="/login" element={<Login />} />

          {/* -------- private (needs auth) -------- */}
          <Route element={<PrivateRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />

              {/* --- Production --- */}
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="production-charts" element={<ProductionCharts />} />
              <Route path="ng-dashboard" element={<NGDashboard />} />        {/* ★ NEW */}
              <Route path="pcba-tracking" element={<PCBATracking />} />
              <Route path="module_production" element={<ModuleProduction />} />
              <Route path="assembly_production" element={<AssemblyProduction />} />
              <Route path="downtime" element={<Downtime />} />
              <Route path="equipment" element={<Equipment />} />

              {/* --- Monitoring & Tools --- */}
              <Route path="search" element={<Search />} />
              <Route path="ai-query" element={<AIQuery />} />
              <Route path="qc-check" element={<QCCheck />} />
              <Route path="ate-testing" element={<ATETesting />} />

              {/* --- admin only --- */}
              <Route element={<AdminRoute />}>
                <Route path="user-perm" element={<UserPerm />} />
                <Route path="email-settings" element={<EmailSettings />} />
              </Route>
            </Route>
          </Route>

          {/* fallback */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
