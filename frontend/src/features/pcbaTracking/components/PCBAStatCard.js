import React from "react";

// Clean design - no gradients, inspired by QC Check
export default function PCBAStatCard({ title, value, icon: Icon, color = "gray", subtitle, breakdown, badgeLabel, onClick }) {
  const hasBreakdown = breakdown && (breakdown.AM7 > 0 || breakdown.AU8 > 0);

  // Color mappings - solid colors only, no gradients
  const colorClasses = {
    amber: {
      bg: "bg-amber-50",
      border: "border-amber-200",
      icon: "bg-amber-100 text-amber-700",
      text: "text-amber-700"
    },
    sky: {
      bg: "bg-sky-50",
      border: "border-sky-200",
      icon: "bg-sky-100 text-sky-700",
      text: "text-sky-700"
    },
    emerald: {
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      icon: "bg-emerald-100 text-emerald-700",
      text: "text-emerald-700"
    },
    gray: {
      bg: "bg-gray-50",
      border: "border-gray-200",
      icon: "bg-gray-100 text-gray-700",
      text: "text-gray-700"
    },
    rose: {
      bg: "bg-rose-50",
      border: "border-rose-200",
      icon: "bg-rose-100 text-rose-700",
      text: "text-rose-700"
    }
  };

  const colors = colorClasses[color] || colorClasses.gray;
  const isClickable = !!onClick;

  return (
    <div className="relative group">
      {/* Badge (if any) */}
      {badgeLabel && (
        <div className="absolute -top-2 -right-2 z-20">
          <span className="flex items-center justify-center px-3 py-1.5 rounded-full text-xs font-bold bg-red-500 text-white shadow-lg border-2 border-white">
            {badgeLabel}
          </span>
        </div>
      )}

      <div
        className={`relative bg-white rounded-2xl p-5 md:p-6 shadow-sm border ${colors.border} transition-all duration-200
                    ${isClickable ? 'cursor-pointer hover:shadow-md hover:border-gray-300' : ''}
                    ${isClickable ? 'hover:scale-[1.01]' : ''}`}
        onClick={onClick}
        role={isClickable ? "button" : undefined}
        tabIndex={isClickable ? 0 : undefined}
      >
        <div className="relative z-10">
          {/* Icon & Title */}
          <div className="flex items-center justify-between mb-3">
            <div className={`p-3 rounded-xl ${colors.icon}`}>
              <Icon size={20} />
            </div>
          </div>

          {/* Title */}
          <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
            {title}
          </p>

          {/* Main Value - Large Display */}
          <div className="flex items-baseline gap-2 mb-3">
            <p className="text-4xl md:text-5xl font-black text-gray-900 tabular-nums tracking-tight leading-none">
              {Number(value || 0).toLocaleString()}
            </p>
          </div>

          {/* Breakdown (AM7 / AU8) */}
          {hasBreakdown && (
            <div className="grid grid-cols-2 gap-2.5 mb-2">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-sky-50 border border-sky-100">
                <div className="flex flex-col">
                  <span className="text-[10px] text-sky-700 font-semibold uppercase tracking-wide">AM7</span>
                  <span className="text-xl md:text-2xl font-bold text-sky-900 tabular-nums">
                    {Number(breakdown.AM7 || 0).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100">
                <div className="flex flex-col">
                  <span className="text-[10px] text-emerald-700 font-semibold uppercase tracking-wide">AU8</span>
                  <span className="text-xl md:text-2xl font-bold text-emerald-900 tabular-nums">
                    {Number(breakdown.AU8 || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Subtitle */}
          {subtitle && (
            <p className="text-xs text-gray-500">
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
