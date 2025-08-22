// src/app/AppLayout.js – UPDATED (collapsed sidebar w/o Monitoring section)

import React, { useState, useContext } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import {
  Menu,
  X,
  BarChart2,
  BatteryMedium,
  Package,
  ClipboardList,
  Search,
  CheckCircle,
  Users,
  LogOut,
  TrendingUp,
  Bot,
  Cpu,            // PCBA Tracking
} from "lucide-react";
import { AuthCtx } from "../auth/AuthContext";
import Sidebar from "./Sidebar"; // full (expanded) sidebar

/* ------------------------------------------------------------------ */
/* MiniLogo – shown only in collapsed sidebar                         */
/* ------------------------------------------------------------------ */
function MiniLogo() {
  return (
    <div
      className="h-8 w-8 mb-8 rounded-md bg-gradient-to-br from-blue-500 to-yellow-400 flex items-center justify-center text-[10px] font-bold text-white tracking-tight select-none"
    >
      LM
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SidebarMiniItem – icon-only button used in collapsed sidebar       */
/* ------------------------------------------------------------------ */
function SidebarMiniItem({ to, icon: Icon, label }) {
  const { pathname } = useLocation();
  const active = pathname.startsWith(to);

  return (
    <Link
      to={to}
      title={label}
      className={`
        relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors
        ${active
          ? "text-blue-400 bg-blue-500/10 ring-1 ring-inset ring-blue-400/40"
          : "text-gray-400 hover:text-blue-400 hover:bg-white/5"}
      `}
      style={active ? { boxShadow: "inset 4px 0 0 0 rgba(59,130,246,1)" } : undefined}
    >
      <Icon size={20} />
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* CollapsedSidebar – compact vertical rail (NO Monitoring section)   */
/* ------------------------------------------------------------------ */
function CollapsedSidebar({ role, onLogout }) {
  return (
    <nav className="w-16 bg-gradient-to-b from-gray-900 to-gray-950 h-full flex flex-col items-center py-6 shadow-2xl">
      <MiniLogo />

      <div className="mt-2 flex-1 flex flex-col items-center gap-3">
        {/* --- Production --- */}
        <SidebarMiniItem to="/dashboard"           icon={BarChart2}     label="Dashboard" />
        <SidebarMiniItem to="/production-charts"   icon={TrendingUp}    label="Production Charts" />
        <SidebarMiniItem to="/pcba-tracking"       icon={Cpu}           label="PCBA Tracking" />
        <SidebarMiniItem to="/module_production"   icon={BatteryMedium} label="Module Production" />
        <SidebarMiniItem to="/assembly_production" icon={Package}       label="Assembly Production" />
        <SidebarMiniItem to="/downtime"            icon={ClipboardList} label="Downtime" />

        <div className="h-px w-8 bg-white/10 my-2" />

        {/* --- Tools & Analytics --- */}
        <SidebarMiniItem to="/search"    icon={Search}      label="Data Search" />
        <SidebarMiniItem to="/ai-query"  icon={Bot}         label="AI Analytics" />
        <SidebarMiniItem to="/qc-check"  icon={CheckCircle} label="Quality Control" />

        {/* --- Admin only --- */}
        {role === "admin" && (
          <SidebarMiniItem to="/user-perm" icon={Users} label="User Management" />
        )}
      </div>

      <button
        onClick={onLogout}
        className="mt-4 p-3 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
        title="Logout"
      >
        <LogOut size={20} />
      </button>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* AppLayout – root shell (topbar + sidebar + routed page content)    */
/* ------------------------------------------------------------------ */
export default function AppLayout() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { role, logout } = useContext(AuthCtx);

  const toggleSidebar = () => {
    if (window.innerWidth <= 768) {
      setIsMobileOpen(!isMobileOpen);
    } else {
      setIsCollapsed(!isCollapsed);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      {/* Sidebar container */}
      <div
        className={`
          ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0 fixed md:relative z-50 h-full transition-transform duration-300
          ${isCollapsed ? "md:w-16" : "md:w-72"}
        `}
      >
        <div className={`h-full ${isCollapsed ? "md:overflow-hidden" : ""}`}>
          {isCollapsed ? (
            <CollapsedSidebar role={role} onLogout={logout} />
          ) : (
            <Sidebar />
          )}
        </div>
      </div>

      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Main content column */}
      <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-950 overflow-hidden transition-colors">
        {/* TopBar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6 shadow-md sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <button
              onClick={toggleSidebar}
              className="p-2 text-gray-600 hover:text-blue-600 hover:bg-gray-100 rounded-lg transition-all duration-200"
              aria-label="Toggle sidebar"
            >
              {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            <img
              src={require("../assets/Leadman_Logo.png")}
              alt="Leadman"
              className="h-9 hidden md:block"
            />
            <h2 className="text-3xl font-extrabold uppercase tracking-tight">
              <span className="bg-gradient-to-r from-gray-500 to-orange-500 text-transparent bg-clip-text">
                FranklinWH
              </span>
              <span className="ml-2 text-base font-medium text-gray-600">
                System
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-2 md:gap-6">
            <div className="text-sm text-gray-600 font-mono">
              {new Date().toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        </header>

        {/* Routed Page Body */}
        <div className="flex-1 overflow-y-auto bg-blue-50 dark:bg-gray-900">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
