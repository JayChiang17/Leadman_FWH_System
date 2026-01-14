import React from "react";
import { Calendar, Clock, Activity, CheckCircle, ArrowRight, TrendingDown, Package } from "lucide-react";

export default function PCBATodayScansCard({ today }) {
  const items = [
    { label: "Aging", value: today?.aging || 0, color: "text-amber-700", bg: "bg-amber-50", icon: Clock },
    { label: "Coating", value: today?.coating || 0, color: "text-cyan-700", bg: "bg-cyan-50", icon: Activity },
    { label: "Inventory", value: today?.completed || 0, color: "text-emerald-700", bg: "bg-emerald-50", icon: CheckCircle },
    { label: "Consumed", value: today?.consumed || 0, color: "text-rose-700", bg: "bg-rose-50", icon: TrendingDown },
  ];

  const consumedPairs = today?.consumedPairs || Math.min(
    today?.consumedAM7 || 0,
    today?.consumedAU8 || 0
  );

  return (
    <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-indigo-600" />
          <h3 className="text-base md:text-lg font-bold text-gray-900">Today's Activity</h3>
        </div>
        <span className="text-xs text-gray-500">{today?.date || ""}</span>
      </div>

      {/* WIP Flow Visualization */}
      <div className="mb-4 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
        <div className="flex items-center justify-between text-xs font-semibold text-gray-700">
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-amber-500"></div>
            Aging
          </span>
          <ArrowRight size={14} className="text-gray-400" />
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-cyan-500"></div>
            Coating
          </span>
          <ArrowRight size={14} className="text-gray-400" />
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            Inventory
          </span>
          <ArrowRight size={14} className="text-gray-400" />
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-rose-500"></div>
            Assembly
          </span>
        </div>
        <div className="mt-2 text-[10px] text-gray-600 text-center">
          Work in Process: Boards move through stages & leave at consumption
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.label} className="rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${it.bg}`}><Icon size={16} className={it.color} /></div>
                <div className="text-xs font-medium text-gray-600">{it.label}</div>
              </div>
              <div className="text-2xl font-bold text-gray-900">{it.value.toLocaleString()}</div>
            </div>
          );
        })}
      </div>

      {/* Consumed Pairs Highlight */}
      {consumedPairs > 0 && (
        <div className="mt-3 p-3 bg-gradient-to-r from-rose-50 to-pink-50 rounded-xl border border-rose-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package size={16} className="text-rose-600" />
              <span className="text-sm font-semibold text-gray-700">Consumed Pairs (Today)</span>
            </div>
            <span className="text-2xl font-black text-rose-700">{consumedPairs.toLocaleString()}</span>
          </div>
          <div className="mt-1 text-xs text-gray-600">
            AM7: {today?.consumedAM7 || 0} | AU8: {today?.consumedAU8 || 0}
          </div>
        </div>
      )}
    </div>
  );
}
