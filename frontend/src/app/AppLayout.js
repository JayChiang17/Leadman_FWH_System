// src/app/AppLayout.js

import React, { useState, useContext } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import {
  Menu, X,
  BarChart2, BatteryMedium, Package, ClipboardList,
  Search, CheckCircle, Users, LogOut, TrendingUp,
  Cpu, Activity, AlertTriangle, Mail, Monitor,
  Layers, PieChart,
} from "lucide-react";
import { AuthCtx } from "../auth/AuthContext";
import Sidebar from "./Sidebar";

/* ── Custom tooltip ───────────────────────────────────────────────── */
function MiniTooltip({ label, children }) {
  return (
    <div className="relative group/tip w-full flex justify-center">
      {children}
      <div className="pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2 z-[200]
                      opacity-0 group-hover/tip:opacity-100 scale-95 group-hover/tip:scale-100
                      transition-all duration-150
                      bg-gray-800 border border-white/10 text-white text-xs font-medium
                      px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap">
        {label}
        {/* left arrow */}
        <span className="absolute right-full top-1/2 -translate-y-1/2
                         border-[5px] border-transparent border-r-gray-800" />
      </div>
    </div>
  );
}

/* ── Single icon link ─────────────────────────────────────────────── */
function MiniItem({ to, icon: Icon, label }) {
  const { pathname } = useLocation();
  const active = pathname.startsWith(to);

  return (
    <MiniTooltip label={label}>
      <Link
        to={to}
        className={`
          relative flex h-11 w-11 items-center justify-center rounded-xl
          transition-all duration-200 border
          ${active
            ? "bg-gradient-to-br from-teal-600/30 to-signal-info/100/20 text-cyan-300 border-teal-400/30 shadow-lg shadow-teal-500/20"
            : "text-ink-muted border-transparent hover:text-cyan-300 hover:bg-teal-600/10 hover:border-teal-400/20"
          }
        `}
      >
        {/* active left-bar accent */}
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6
                           bg-gradient-to-b from-cyan-400 to-teal-500/100 rounded-r-full" />
        )}
        <Icon size={18} className="relative z-10" />
      </Link>
    </MiniTooltip>
  );
}

/* ── Section divider ──────────────────────────────────────────────── */
function MiniDivider() {
  return (
    <div className="flex flex-col items-center gap-[3px] py-0.5 pointer-events-none">
      <span className="w-[3px] h-[3px] bg-cyan-400/30 rounded-full" />
      <span className="w-px h-4 bg-gradient-to-b from-cyan-400/25 to-transparent" />
      <span className="w-[3px] h-[3px] bg-teal-400/20 rounded-full" />
    </div>
  );
}

/* ── Collapsed mini sidebar ───────────────────────────────────────── */
function CollapsedSidebar({ role, onLogout }) {
  return (
    <nav className="w-16 h-full flex flex-col items-center py-4
                    bg-gradient-to-b from-gray-900 via-teal-900/20 to-gray-950
                    shadow-lg shadow-black/50 relative overflow-hidden">

      {/* background ambient */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-20 h-20
                        bg-cyan-400/6 rounded-full blur-xl" />
        <div className="absolute bottom-1/3 left-1/2 -translate-x-1/2 w-14 h-14
                        bg-teal-400/5 rounded-full blur-lg" />
      </div>
      {/* shimmer top edge */}
      <div className="absolute top-0 left-0 w-full h-px
                      bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent
                      pointer-events-none" />

      {/* Favicon logo */}
      <div className="shrink-0 w-10 h-10 mb-5 rounded-xl overflow-hidden
                      border border-white/10 shadow-lg shadow-black/40
                      relative z-10 bg-white/5">
        <img
          src="/leadman_logo_icon.ico"
          alt="Leadman"
          className="w-full h-full object-contain p-1"
          draggable={false}
        />
      </div>

      {/* Scrollable nav */}
      <div className="flex-1 flex flex-col items-center gap-[7px] overflow-y-auto
                      w-full px-[10px] relative z-10 mini-scrollbar">

        {/* ── Production ── */}
        <MiniItem to="/dashboard"           icon={BarChart2}     label="Dashboard" />
        <MiniItem to="/production-charts"   icon={TrendingUp}    label="Production Charts" />
        <MiniItem to="/ng-dashboard"        icon={AlertTriangle} label="NG Dashboard" />
        <MiniItem to="/pcba-tracking"       icon={Cpu}           label="PCBA Tracking" />
        <MiniItem to="/module_production"   icon={BatteryMedium} label="Module Production" />
        <MiniItem to="/assembly_production" icon={Package}       label="Assembly Production" />
        <MiniItem to="/downtime"            icon={ClipboardList} label="Downtime" />
        <MiniItem to="/wip-tracking"        icon={Layers}        label="WIP Tracking" />
        <MiniItem to="/ng-analysis"         icon={PieChart}      label="ATE NG Analysis" />

        <MiniDivider />

        {/* ── Tools ── */}
        <MiniItem to="/search"      icon={Search}      label="Data Search" />
        <MiniItem to="/qc-check"    icon={CheckCircle} label="Quality Control" />
        <MiniItem to="/ate-testing" icon={Activity}    label="ATE Testing" />

        {/* ── Admin ── */}
        {role === "admin" && (
          <>
            <MiniDivider />
            <MiniItem to="/user-perm"      icon={Users}   label="User Management" />
            <MiniItem to="/email-settings" icon={Mail}    label="Email Settings" />
            <MiniItem to="/system-monitor" icon={Monitor} label="System Monitor" />
          </>
        )}
      </div>

      {/* Logout */}
      <MiniTooltip label="Logout">
        <button
          onClick={onLogout}
          className="shrink-0 mt-3 flex h-11 w-11 items-center justify-center rounded-xl
                     border border-transparent
                     text-red-400 hover:text-red-300 hover:bg-signal-error/15 hover:border-red-400/25
                     transition-all duration-200 relative z-10"
        >
          <LogOut size={18} />
        </button>
      </MiniTooltip>

      <style>{`
        .mini-scrollbar::-webkit-scrollbar { width: 3px; }
        .mini-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(34,211,238,0.18);
          border-radius: 2px;
        }
        .mini-scrollbar::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </nav>
  );
}

/* ── AppLayout ────────────────────────────────────────────────────── */
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

      {/* Sidebar container — smooth width + slide transition */}
      <div
        className={`
          ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0 fixed md:relative z-50 h-full
          transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0
        `}
        style={{ width: isCollapsed ? "64px" : "288px" }}
      >
        {isCollapsed ? (
          <CollapsedSidebar role={role} onLogout={logout} />
        ) : (
          <Sidebar />
        )}
      </div>

      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col bg-surface-base overflow-hidden min-w-0">

        {/* TopBar */}
        <header className="h-14 bg-surface-panel border-b border-stroke
                           flex items-center justify-between px-4 md:px-5
                           shadow-none sticky top-0 z-30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSidebar}
              className="p-2 text-ink-secondary hover:text-signal-info hover:bg-surface-raised
                         rounded-lg transition-colors duration-150"
              aria-label="Toggle sidebar"
            >
              {isMobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <div className="h-6 opacity-80 hidden md:block">
              <img
                src={require("../assets/Leadman_Logo.png")}
                alt="Leadman"
                className="h-full object-contain"
              />
            </div>
          </div>

          <div className="text-xs text-ink-muted font-mono tabular-nums">
            {new Date().toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto bg-surface-base">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
