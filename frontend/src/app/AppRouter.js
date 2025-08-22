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
import PCBATracking from "../features/pcbaTracking/PCBATracking";          
import Equipment from "../features/equipment/Equipment";

/* ───── role guard (admin only) ───── */
function AdminRoute() {
  const { role } = useContext(AuthCtx);
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
              <Route path="pcba-tracking" element={<PCBATracking />} />      {/* ★ NEW */}
              <Route path="module_production" element={<ModuleProduction />} />
              <Route path="assembly_production" element={<AssemblyProduction />} />
              <Route path="downtime" element={<Downtime />} />
              <Route path="equipment" element={<Equipment />} />

              {/* --- Monitoring & Tools --- */}
              <Route path="search" element={<Search />} />
              <Route path="ai-query" element={<AIQuery />} />
              <Route path="qc-check" element={<QCCheck />} />

              {/* --- admin only --- */}
              <Route element={<AdminRoute />}>
                <Route path="user-perm" element={<UserPerm />} />
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
