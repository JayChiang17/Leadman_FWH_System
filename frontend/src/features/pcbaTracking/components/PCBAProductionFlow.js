import React from "react";
import { Clock, Activity, CheckCircle, BarChart3, ChevronRight } from "lucide-react";

export default function PCBAProductionFlow({ stats = {} }) {
  const stages = [
    { name: "Aging",     value: stats.aging ?? 0,     color: "bg-amber-500",  icon: Clock },
  { name: "Coating",   value: stats.coating ?? 0,   color: "bg-cyan-600", icon: Activity },
    { name: "Inventory", value: stats.completed ?? 0, color: "bg-green-500",  icon: CheckCircle },
  ];
  const total = stages.reduce((s, v) => s + (v.value || 0), 0);

  return (
    <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-gray-100">
      <h3 className="text-base md:text-lg font-bold text-gray-900 mb-5 flex items-center gap-2">
        <BarChart3 size={20} className="text-indigo-600" /> Production Pipeline (Live)
      </h3>
      <div className="space-y-4">
        {stages.map((stage, idx) => {
          const pct = total > 0 ? (stage.value / total) * 100 : 0;
          const Icon = stage.icon;
          return (
            <div key={stage.name} className="relative">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-3">
                  <Icon size={16} className="text-gray-600" />
                  <span className="text-sm md:text-base font-medium text-gray-700">{stage.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm md:text-base font-bold text-gray-900">{stage.value || 0}</span>
                  <span className="text-xs md:text-sm text-gray-500">({pct.toFixed(1)}%)</span>
                </div>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full ${stage.color} transition-all duration-700 ease-out rounded-full`} style={{ width: `${pct}%` }} />
              </div>
              {idx < stages.length - 1 && <ChevronRight className="absolute -right-3 top-1/2 -translate-y-1/2 text-gray-300" size={14} />}
            </div>
          );
        })}
      </div>
      <div className="mt-5 pt-3 border-t border-gray-100">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">Total In System</span>
          <span className="text-xl md:text-2xl font-bold text-gray-900">{total}</span>
        </div>
      </div>
    </div>
  );
}
