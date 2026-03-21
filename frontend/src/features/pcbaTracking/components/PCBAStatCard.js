import React from "react";

// Clean design - no gradients, inspired by QC Check
export default function PCBAStatCard({ title, value, icon: Icon, color = "gray", subtitle, breakdown, badgeLabel, onClick }) {
  const hasBreakdown = breakdown && (breakdown.AM7 > 0 || breakdown.AU8 > 0);

  // Color mappings - solid colors only, no gradients
  const colorClasses = {
    amber: {
      bg: "bg-signal-warn/10",
      border: "border-amber-500/30",
      icon: "bg-signal-warn/15 text-amber-400",
      text: "text-amber-400"
    },
    sky: {
      bg: "bg-signal-info/10",
      border: "border-sky-500/30",
      icon: "bg-signal-info/15 text-sky-400",
      text: "text-sky-400"
    },
    emerald: {
      bg: "bg-signal-ok/10",
      border: "border-emerald-500/30",
      icon: "bg-signal-ok/15 text-emerald-400",
      text: "text-emerald-400"
    },
    gray: {
      bg: "bg-surface-base",
      border: "border-stroke",
      icon: "bg-surface-raised text-ink-secondary",
      text: "text-ink-secondary"
    },
    rose: {
      bg: "bg-signal-error/10",
      border: "border-rose-500/30",
      icon: "bg-signal-error/15 text-rose-400",
      text: "text-rose-400"
    }
  };

  const colors = colorClasses[color] || colorClasses.gray;
  const isClickable = !!onClick;

  return (
    <div className="relative group">
      {/* Badge (if any) */}
      {badgeLabel && (
        <div className="absolute -top-2 -right-2 z-20">
          <span className="flex items-center justify-center px-3 py-1.5 rounded-full text-xs font-bold bg-signal-error text-white shadow-lg border-2 border-white">
            {badgeLabel}
          </span>
        </div>
      )}

      <div
        className={`relative bg-surface-panel rounded-xl p-5 md:p-6 shadow-sm border ${colors.border} transition-all duration-200
                    ${isClickable ? 'cursor-pointer hover:shadow-md hover:border-stroke' : ''}
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
          <p className="text-xs font-semibold text-ink-secondary mb-2 uppercase tracking-wide">
            {title}
          </p>

          {/* Main Value - Large Display */}
          <div className="flex items-baseline gap-2 mb-3">
            <p className="text-4xl md:text-5xl font-black text-ink-primary tabular-nums tracking-tight leading-none">
              {Number(value || 0).toLocaleString()}
            </p>
          </div>

          {/* Breakdown (AM7 / AU8) */}
          {hasBreakdown && (
            <div className="grid grid-cols-2 gap-2.5 mb-2">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-signal-info/10 border border-signal-info/20">
                <div className="flex flex-col">
                  <span className="text-[10px] text-sky-400 font-semibold uppercase tracking-wide">AM7</span>
                  <span className="text-xl md:text-2xl font-bold text-sky-300 tabular-nums">
                    {Number(breakdown.AM7 || 0).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-signal-ok/10 border border-signal-ok/20">
                <div className="flex flex-col">
                  <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wide">AU8</span>
                  <span className="text-xl md:text-2xl font-bold text-emerald-300 tabular-nums">
                    {Number(breakdown.AU8 || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Subtitle */}
          {subtitle && (
            <p className="text-xs text-ink-muted">
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
