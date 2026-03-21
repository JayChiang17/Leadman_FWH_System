// src/app/Sidebar.js
import React, { useContext, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { AuthCtx } from "../auth/AuthContext";
import {
  BarChart2, BatteryMedium, Package, ClipboardList,
  Search, Users, CheckCircle, LogOut, TrendingUp,
  Cpu, Activity, AlertTriangle, Mail, Monitor,
  Layers, PieChart,
} from "lucide-react";

export default function Sidebar() {
  const { role, logout, name, allowedPages } = useContext(AuthCtx);
  const { pathname } = useLocation();

  const canSee = useCallback((pageKey) => {
    if (role === "admin") return true;
    if (allowedPages === null || allowedPages === undefined) return true;
    return allowedPages.includes(pageKey);
  }, [role, allowedPages]);

  const isActive = useCallback((path) => pathname.startsWith(path), [pathname]);

  return (
    <nav className="w-72 h-screen flex flex-col relative overflow-hidden"
         style={{ background: "linear-gradient(180deg, #111827 0%, #0f1e1e 50%, #0d1117 100%)" }}>

      {/* 頂部 teal 光邊 */}
      <div className="absolute top-0 left-0 right-0 h-px"
           style={{ background: "linear-gradient(90deg, transparent, rgba(34,211,238,0.4), transparent)" }} />

      {/* 右側邊線 */}
      <div className="absolute top-0 right-0 bottom-0 w-px"
           style={{ background: "linear-gradient(180deg, rgba(34,211,238,0.15), rgba(34,211,238,0.05) 50%, transparent)" }} />

      {/* ── Logo 區域 ── */}
      <div className="flex-shrink-0 px-5 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg overflow-hidden border flex-shrink-0"
               style={{ borderColor: "rgba(34,211,238,0.2)", background: "rgba(34,211,238,0.06)" }}>
            <img src="/leadman_logo_icon.ico" alt="Leadman"
                 className="w-full h-full object-contain p-1" draggable={false} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide" style={{ color: "#c8cedc" }}>Leadman FWH</p>
            <p className="text-xs" style={{ color: "#565e74" }}>Production System</p>
          </div>
        </div>
      </div>

      {/* ── 分隔線 ── */}
      <div className="mx-5 mb-4 h-px" style={{ background: "#2e3650" }} />

      {/* ── User 區塊 ── */}
      <div className="flex-shrink-0 px-4 pb-4">
        <div className="px-3 py-3 rounded-xl"
             style={{ background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.12)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                 style={{ background: "rgba(34,211,238,0.12)" }}>
              <span className="text-sm font-bold" style={{ color: "#22d3ee" }}>
                {name?.charAt(0)?.toUpperCase() || "U"}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: "#c8cedc" }}>
                {name || "User"}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: "#10b981", boxShadow: "0 0 6px rgba(16,185,129,0.5)" }} />
                <span className="text-xs capitalize" style={{ color: "#8d93a5" }}>{role}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Nav 區域 ── */}
      <div className="flex-1 overflow-y-auto px-3 sidebar-scroll">
        <div className="space-y-6 pb-4">

          {/* Production */}
          <section>
            <NavLabel text="Production" />
            <div className="space-y-0.5">
              {canSee("dashboard")           && <NavItem to="/dashboard"           icon={BarChart2}     text="Dashboard"           active={isActive("/dashboard")} />}
              {canSee("production-charts")   && <NavItem to="/production-charts"   icon={TrendingUp}    text="Production Charts"   active={isActive("/production-charts")} />}
              {canSee("ng-dashboard")        && <NavItem to="/ng-dashboard"        icon={AlertTriangle} text="NG Dashboard"        active={isActive("/ng-dashboard")} />}
              {canSee("pcba-tracking")       && <NavItem to="/pcba-tracking"       icon={Cpu}           text="PCBA Tracking"       active={isActive("/pcba-tracking")} />}
              {canSee("module_production")   && <NavItem to="/module_production"   icon={BatteryMedium} text="Module Production"   active={isActive("/module_production")} />}
              {canSee("assembly_production") && <NavItem to="/assembly_production" icon={Package}       text="Assembly Production" active={isActive("/assembly_production")} />}
              {canSee("downtime")            && <NavItem to="/downtime"            icon={ClipboardList} text="Downtime"            active={isActive("/downtime")} />}
              {canSee("wip-tracking")        && <NavItem to="/wip-tracking"        icon={Layers}        text="WIP Tracking"        active={isActive("/wip-tracking")} />}
              {canSee("ng-analysis")         && <NavItem to="/ng-analysis"         icon={PieChart}      text="ATE NG Analysis"     active={isActive("/ng-analysis")} />}
            </div>
          </section>

          {/* Tools */}
          <section>
            <NavLabel text="Tools & Analytics" />
            <div className="space-y-0.5">
              {canSee("search")      && <NavItem to="/search"      icon={Search}      text="Data Search"      active={isActive("/search")} />}
              {canSee("qc-check")    && <NavItem to="/qc-check"    icon={CheckCircle} text="Quality Control"  active={isActive("/qc-check")} />}
              {canSee("ate-testing") && <NavItem to="/ate-testing" icon={Activity}    text="ATE Testing"      active={isActive("/ate-testing")} />}
              {role === "admin" && <>
                <NavItem to="/user-perm"      icon={Users}   text="User Management" active={isActive("/user-perm")} />
                <NavItem to="/email-settings" icon={Mail}    text="Email Settings"  active={isActive("/email-settings")} />
                <NavItem to="/system-monitor" icon={Monitor} text="System Monitor"  active={isActive("/system-monitor")} />
              </>}
            </div>
          </section>
        </div>
      </div>

      {/* ── Logout ── */}
      <div className="flex-shrink-0 p-4">
        <div className="h-px mb-4" style={{ background: "#2e3650" }} />
        <button
          onClick={logout}
          className="logout-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl
                     text-sm font-medium transition-colors duration-150"
        >
          <LogOut size={17} />
          <span>Logout</span>
        </button>
      </div>

      <style>{`
        .sidebar-scroll::-webkit-scrollbar { width: 4px; }
        .sidebar-scroll::-webkit-scrollbar-thumb {
          background: rgba(34,211,238,0.15);
          border-radius: 2px;
        }
        .sidebar-scroll::-webkit-scrollbar-track { background: transparent; }

        .logout-btn {
          color: #f87171;
          border: 1px solid rgba(239,68,68,0.15);
          background: rgba(239,68,68,0.05);
        }
        .logout-btn:hover {
          color: #fca5a5;
          background: rgba(239,68,68,0.1);
          border-color: rgba(239,68,68,0.25);
        }

        .nav-item:not([style*="rgba(34,211,238"]):hover {
          color: #c8cedc;
          background: rgba(255,255,255,0.04);
          border-color: rgba(255,255,255,0.06) !important;
        }
        .nav-item:not([style*="rgba(34,211,238"]):hover svg {
          opacity: 1;
        }
      `}</style>
    </nav>
  );
}

/* ── Section Label ── */
function NavLabel({ text }) {
  return (
    <div className="flex items-center gap-2 px-3 mb-2">
      <span className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "rgba(34,211,238,0.5)" }}>
        {text}
      </span>
      <div className="flex-1 h-px" style={{ background: "rgba(34,211,238,0.1)" }} />
    </div>
  );
}

/* ── Nav Item ── */
function NavItem({ to, icon: Icon, text, active }) {
  return (
    <Link to={to} className="nav-item group relative flex items-center gap-3 px-3 py-2.5 rounded-lg
                              text-sm font-medium transition-colors duration-150"
          style={active ? {
            color: "#22d3ee",
            background: "rgba(34,211,238,0.08)",
            border: "1px solid rgba(34,211,238,0.12)",
          } : {
            color: "#8d93a5",
            border: "1px solid transparent",
          }}>

      {/* 左邊框 accent */}
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
              style={{ background: "linear-gradient(180deg, #22d3ee, #0d9488)" }} />
      )}

      <Icon size={17} className="flex-shrink-0" style={{ opacity: active ? 1 : 0.7 }} />
      <span>{text}</span>
    </Link>
  );
}
