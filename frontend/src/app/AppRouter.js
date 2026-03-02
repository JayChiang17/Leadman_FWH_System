import React, { useContext, Suspense, lazy } from "react";
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
import ErrorBoundary from "../components/ErrorBoundary";

/* ───── public ───── */
import Login from "../auth/Login";

/* ───── lazy-loaded features (code splitting) ───── */
const Dashboard          = lazy(() => import("../features/dashboard/Dashboard"));
const ModuleProduction   = lazy(() => import("../features/moduleProduction/ModuleProduction"));
const AssemblyProduction = lazy(() => import("../features/assemblyProduction/AssemblyProduction"));
const Downtime           = lazy(() => import("../features/downtime/Downtime"));
const QCCheck            = lazy(() => import("../features/qcCheck/QCCheck"));
const UserPerm           = lazy(() => import("../features/userPerm/UserPerm"));
const Search             = lazy(() => import("../features/search/Search"));
const AIQuery            = lazy(() => import("../features/aiQuery/AIQuery"));
const ProductionCharts   = lazy(() => import("../features/productionCharts/ProductionCharts"));
const NGDashboard        = lazy(() => import("../features/ngDashboard/NGDashboard"));
const PCBATracking       = lazy(() => import("../features/pcbaTracking/PCBATracking"));
const EmailSettings      = lazy(() => import("../features/emailSettings/EmailSettings"));
const ATETesting         = lazy(() => import("../features/ateTesting/ATETesting"));
const SystemMonitor      = lazy(() => import("../features/systemMonitor/SystemMonitor"));

/* ───── loading fallback ───── */
const PageLoader = () => (
  <div className="flex items-center justify-center h-screen bg-gray-50">
    <div className="flex flex-col items-center gap-3">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
      <span className="text-sm text-gray-400">Loading...</span>
    </div>
  </div>
);

/* ───── role guard (admin only) ───── */
function AdminRoute() {
  const { role, isInitialized } = useContext(AuthCtx);

  if (!isInitialized) {
    return <PageLoader />;
  }

  return role === "admin" ? <Outlet /> : <Navigate to="/" replace />;
}

export default function AppRouter() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
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
                <Route path="ng-dashboard" element={<NGDashboard />} />
                <Route path="pcba-tracking" element={<PCBATracking />} />
                <Route path="module_production" element={<ModuleProduction />} />
                <Route path="assembly_production" element={<AssemblyProduction />} />
                <Route path="downtime" element={<Downtime />} />
                {/* --- Monitoring & Tools --- */}
                <Route path="search" element={<Search />} />
                <Route path="ai-query" element={<AIQuery />} />
                <Route path="qc-check" element={<QCCheck />} />
                <Route path="ate-testing" element={<ATETesting />} />

                {/* --- admin only --- */}
                <Route element={<AdminRoute />}>
                  <Route path="user-perm" element={<UserPerm />} />
                  <Route path="email-settings" element={<EmailSettings />} />
                  <Route path="system-monitor" element={<SystemMonitor />} />
                </Route>
              </Route>
            </Route>

            {/* fallback */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  );
}
