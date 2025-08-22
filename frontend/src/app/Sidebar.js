// src/app/Sidebar.js – 流動科幻風 Sidebar
// ---------------------------------------------------------------------------
// 特色：
// • 透明水滴漸層背景動畫
// • Hover 流體擴散 + 光暈陰影
// • 用戶名放大顯示，移除頭像
// • 動態粒子 + 光條掃描 + 連續 shimmer
// • 已加入 PCBA Tracking 導覽
// ---------------------------------------------------------------------------

import React, { useContext } from "react";
import { Link, useLocation } from "react-router-dom";
import { AuthCtx } from "../auth/AuthContext";
import {
  BarChart2,
  BatteryMedium,
  Package,
  ClipboardList,
  Search,
  Users,
  CheckCircle,
  LogOut,
  Bot,
  TrendingUp,
  Cpu,
  Activity,//  ← 新增圖標：PCBA Tracking
} from "lucide-react";

/* ------------------------------------------------------------------ */

export default function Sidebar() {
  const { role, logout, username } = useContext(AuthCtx);
  const { pathname } = useLocation();

  const isActive = (path) => pathname.startsWith(path);

  const navItemClass = (path) => `
    group relative flex items-center gap-3 px-4 py-3 rounded-xl
    font-medium text-base transition-all duration-500 overflow-hidden
    ${
      isActive(path)
        ? "bg-gradient-to-r from-blue-500/30 to-cyan-500/20 text-cyan-300 border border-blue-400/30 shadow-xl shadow-blue-500/20 backdrop-blur-sm"
        : "text-gray-300 hover:text-cyan-300 hover:bg-gradient-to-r hover:from-blue-500/10 hover:to-cyan-500/5 hover:border-blue-400/20 hover:shadow-lg hover:shadow-blue-500/10 hover:backdrop-blur-sm border border-transparent"
    }
  `;

  return (
    <nav className="w-72 h-screen bg-gradient-to-br from-gray-900 via-blue-900/20 to-gray-950 text-white flex flex-col shadow-2xl shadow-black/50 relative overflow-hidden">
      {/* -------- 背景粒子 / 水滴 -------- */}
      <div className="absolute inset-0 opacity-40 pointer-events-none">
        <div className="absolute -top-20 -right-20 w-80 h-80 bg-gradient-radial from-blue-400/20 via-cyan-300/10 to-transparent rounded-full blur-2xl animate-float-slow" />
        <div className="absolute top-1/3 -left-16 w-60 h-60 bg-gradient-radial from-cyan-400/15 via-blue-300/8 to-transparent rounded-full blur-xl animate-float-reverse" />
        <div className="absolute bottom-1/4 right-10 w-40 h-40 bg-gradient-radial from-blue-300/20 via-cyan-400/10 to-transparent rounded-full blur-lg animate-pulse-slow" />
        <div className="absolute top-1/4 left-1/4 w-8 h-8 bg-cyan-400/20 rounded-full blur-sm animate-bounce-gentle" />
        <div className="absolute top-3/4 right-1/3 w-6 h-6 bg-blue-400/25 rounded-full blur-sm animate-float-micro" />
        <div className="absolute top-1/2 left-3/4 w-4 h-4 bg-cyan-300/30 rounded-full blur-sm animate-drift" />
      </div>

      {/* -------- Shimmer 光線 -------- */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent animate-shimmer" />
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-400/50 to-transparent animate-shimmer-reverse" />
      </div>

      {/* -------- User 區塊 -------- */}
      <div className="flex-shrink-0 p-6 relative z-10">
        <div className="relative p-6 bg-gradient-to-br from-blue-500/10 via-cyan-500/5 to-transparent border border-blue-400/20 rounded-2xl backdrop-blur-md shadow-lg shadow-blue-500/10 overflow-hidden group">
          {/* 背景點綴 */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700">
            <div className="absolute -top-2 -right-2 w-16 h-16 bg-gradient-radial from-cyan-400/30 to-transparent rounded-full blur-md animate-pulse-gentle" />
            <div className="absolute -bottom-2 -left-2 w-12 h-12 bg-gradient-radial from-blue-400/25 to-transparent rounded-full blur-sm animate-float-micro" />
          </div>

          <div className="relative z-10">
            <p className="text-3xl font-bold text-white mb-2 tracking-wide">Hi, {username}</p>
            <div className="flex items-center gap-2 text-cyan-300">
              <span className="w-2 h-2 bg-gradient-to-r from-green-400 to-cyan-400 rounded-full animate-pulse-soft shadow-sm shadow-green-400/50" />
              <span className="text-sm capitalize font-medium">{role}</span>
            </div>
          </div>
        </div>
      </div>

      {/* -------- Nav 區域 -------- */}
      <div className="flex-1 overflow-y-auto px-6 relative z-10 custom-scrollbar">
        <div className="space-y-8 pb-6">
          {/* -------- Production -------- */}
          <section>
            <h4 className="nav-label">Production</h4>
            <div className="space-y-2">
              <SidebarLink to="/dashboard" icon={BarChart2}   text="Dashboard"         navItemClass={navItemClass} />
              <SidebarLink to="/production-charts" icon={TrendingUp} text="Production Charts" navItemClass={navItemClass} />
              <SidebarLink to="/pcba-tracking"  icon={Cpu}          text="PCBA Tracking"    navItemClass={navItemClass} />
              <SidebarLink to="/module_production"   icon={BatteryMedium} text="Module Production" navItemClass={navItemClass} />
              <SidebarLink to="/assembly_production" icon={Package}       text="Assembly Production" navItemClass={navItemClass} />
              <SidebarLink to="/downtime" icon={ClipboardList} text="Downtime" navItemClass={navItemClass} />
              <SidebarLink to="/equipment"          icon={Activity}    text="Performance "   navItemClass={navItemClass} />
            </div>
          </section>

          {/* -------- Tools -------- */}
          <section>
            <h4 className="nav-label">Tools & Analytics</h4>
            <div className="space-y-2">
              <SidebarLink to="/search"   icon={Search}   text="Data Search"    navItemClass={navItemClass} />
              <SidebarLink to="/ai-query" icon={Bot}      text="AI Analytics"   navItemClass={navItemClass} />
              <SidebarLink to="/qc-check" icon={CheckCircle} text="Quality Control" navItemClass={navItemClass} />
              {role === "admin" && (
                <SidebarLink to="/user-perm" icon={Users} text="User Management" navItemClass={navItemClass} />
              )}
            </div>
          </section>
        </div>
      </div>

      {/* -------- Logout -------- */}
      <div className="flex-shrink-0 p-6 relative z-10">
        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-red-600/80 via-red-500/90 to-red-600/80 hover:from-red-500 hover:via-red-400 hover:to-red-500 text-white font-medium text-sm rounded-xl shadow-xl shadow-red-900/40 transition-all duration-500 relative overflow-hidden group border border-red-400/30 hover:border-red-300/50 hover:shadow-2xl hover:shadow-red-500/30"
        >
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            <div className="absolute top-1 right-2 w-3 h-3 bg-gradient-radial from-white/40 to-transparent rounded-full blur-sm animate-drift" />
            <div className="absolute bottom-1 left-3 w-2 h-2 bg-gradient-radial from-red-200/50 to-transparent rounded-full blur-sm animate-bounce-gentle" />
          </div>
          <LogOut size={18} className="relative z-10" />
          <span className="relative z-10">Logout</span>
        </button>
      </div>

      {/* -------- 自定義 CSS -------- */}
      <style jsx>{`
        .nav-label {
          @apply text-xs font-semibold text-cyan-400/80 uppercase tracking-widest px-4 mb-4 relative;
        }
        .nav-label::after {
          content: "";
          position: absolute;
          left: 0;
          bottom: 0;
          width: 2rem;
          height: 1px;
          background: linear-gradient(to right, rgba(34, 211, 238, 0.6), transparent);
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, rgba(34, 211, 238, 0.3), rgba(59, 130, 246, 0.3));
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.3);
          border-radius: 3px;
        }

        /* keyframes（若已在 tailwind.config 擴充，可移除） */
        @keyframes float-slow   { 0%,100%{transform:translate(0,0) scale(1)} 25%{transform:translate(10px,-20px) scale(1.05)} 50%{transform:translate(-5px,-10px) scale(.95)} 75%{transform:translate(8px,-15px) scale(1.02)} }
        @keyframes float-reverse{ 0%,100%{transform:translate(0,0) rotate(0)} 33%{transform:translate(-8px,15px) rotate(120deg)} 66%{transform:translate(12px,-10px) rotate(240deg)} }
        @keyframes pulse-slow   { 0%,100%{opacity:.4;transform:scale(1)} 50%{opacity:.8;transform:scale(1.1)} }
        @keyframes bounce-gentle{ 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes float-micro  { 0%,100%{transform:translate(0,0)} 50%{transform:translate(2px,-4px)} }
        @keyframes drift        { 0%,100%{transform:translate(0,0)} 25%{transform:translate(3px,-2px)} 50%{transform:translate(-2px,2px)} 75%{transform:translate(4px,1px)} }
        @keyframes pulse-gentle { 0%,100%{opacity:.6} 50%{opacity:1} }
        @keyframes pulse-soft   { 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:.9;transform:scale(1.05)} }
        @keyframes shimmer      { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }
        @keyframes shimmer-reverse{ 0%{transform:translateX(200%)} 100%{transform:translateX(-100%)} }

        .animate-float-slow      { animation: float-slow 8s ease-in-out infinite; }
        .animate-float-reverse   { animation: float-reverse 12s ease-in-out infinite; }
        .animate-pulse-slow      { animation: pulse-slow 4s ease-in-out infinite; }
        .animate-bounce-gentle   { animation: bounce-gentle 3s ease-in-out infinite; }
        .animate-float-micro     { animation: float-micro 5s ease-in-out infinite; }
        .animate-drift           { animation: drift 6s ease-in-out infinite; }
        .animate-pulse-gentle    { animation: pulse-gentle 2s ease-in-out infinite; }
        .animate-pulse-soft      { animation: pulse-soft 3s ease-in-out infinite; }
        .animate-shimmer         { animation: shimmer 3s linear infinite; }
        .animate-shimmer-reverse { animation: shimmer-reverse 4s linear infinite; }

        .bg-gradient-radial { background: radial-gradient(circle, var(--tw-gradient-stops)); }
      `}</style>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  小型封裝：可重用的 Link                                            */
/* ------------------------------------------------------------------ */
function SidebarLink({ to, icon: Icon, text, navItemClass, badge }) {
  return (
    <Link to={to} className={navItemClass(to)}>
      {/* Hover 閃光 / 火花 */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-8 bg-gradient-to-b from-cyan-400 to-blue-500 rounded-r-full blur-sm animate-pulse-gentle" />
        <div className="absolute right-2 top-2 w-4 h-4 bg-gradient-radial from-cyan-400/40 to-transparent rounded-full blur-sm animate-float-micro" />
      </div>

      <Icon size={20} className="relative z-10" />
      <span className="relative z-10">{text}</span>

      {badge && (
        <span className="ml-auto text-xs bg-gradient-to-r from-cyan-500 to-blue-500 text-white px-3 py-1 rounded-full font-medium shadow-lg shadow-cyan-500/30 animate-pulse-soft relative z-10">
          {badge}
        </span>
      )}
    </Link>
  );
}
