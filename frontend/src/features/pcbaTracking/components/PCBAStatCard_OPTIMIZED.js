import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

export default function PCBAStatCard({
  title,
  value,
  icon: Icon,
  gradient,
  subtitle,
  breakdown,
  badgeLabel,
  trend, // 可選：顯示趨勢 { value: 12, direction: 'up' }
  onClick // 可選：點擊事件
}) {
  const hasBreakdown = breakdown && (breakdown.AM7 > 0 || breakdown.AU8 > 0);
  const hasTrend = trend && trend.value != null;

  return (
    <div
      className={`relative group ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      {/* 右上角徽章（NG 計數等） */}
      {badgeLabel && (
        <div className="absolute -top-2 -right-2 z-20">
          <div className="relative">
            <span className="flex items-center justify-center px-3 py-1.5 rounded-full text-xs font-bold
                             bg-rose-600 text-white shadow-lg border-2 border-white
                             animate-pulse">
              {badgeLabel}
            </span>
          </div>
        </div>
      )}

      <div className={`relative bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-gray-100 overflow-hidden
                       transition-all duration-300 ${
                         onClick ? 'hover:shadow-xl hover:scale-[1.02] hover:-translate-y-1' : 'hover:shadow-md'
                       }`}>

        {/* 背景漸層裝飾 */}
        <div className={`absolute top-0 right-0 w-32 h-32 -mr-16 -mt-16 rounded-full opacity-5 bg-gradient-to-br ${gradient || "from-blue-500 to-blue-600"}`} />

        {/* 背景圖示 */}
        <div className="absolute top-2 right-2 opacity-[0.04]">
          <Icon size={140} />
        </div>

        <div className="relative z-10">
          {/* 圖示 + 趨勢指標 */}
          <div className="flex items-start justify-between mb-4">
            <div className={`p-3.5 rounded-xl bg-gradient-to-br ${gradient || "from-blue-500 to-blue-600"} shadow-md
                            group-hover:scale-110 transition-transform duration-300`}>
              <Icon className="text-white" size={24} />
            </div>

            {/* 趨勢指示器 */}
            {hasTrend && (
              <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                trend.direction === 'up'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-700'
              }`}>
                {trend.direction === 'up' ? (
                  <TrendingUp size={14} />
                ) : (
                  <TrendingDown size={14} />
                )}
                <span>{Math.abs(trend.value)}%</span>
              </div>
            )}
          </div>

          {/* 標題 */}
          <p className="text-xs md:text-sm text-gray-600 font-medium mb-2 uppercase tracking-wide">
            {title}
          </p>

          {/* 主數值 - 超大號顯示 */}
          <div className="flex items-baseline gap-2 mb-3">
            <p className="text-4xl md:text-5xl lg:text-6xl font-black text-gray-900 tabular-nums tracking-tight leading-none">
              {Number(value || 0).toLocaleString()}
            </p>

            {/* 單位或後綴 */}
            {subtitle && !hasBreakdown && (
              <span className="text-sm text-gray-400 font-medium">units</span>
            )}
          </div>

          {/* 型號分解（AM7 / AU8） */}
          {hasBreakdown && (
            <div className="grid grid-cols-2 gap-2.5 mb-2">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gradient-to-br from-cyan-50 to-cyan-100 border border-cyan-200">
                <div className="flex flex-col">
                  <span className="text-[10px] text-cyan-600 font-semibold uppercase tracking-wide">AM7</span>
                  <span className="text-xl md:text-2xl font-black text-cyan-900 tabular-nums">
                    {Number(breakdown.AM7 || 0).toLocaleString()}
                  </span>
                </div>
                {breakdown.AM7 > 0 && (
                  <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                )}
              </div>

              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200">
                <div className="flex flex-col">
                  <span className="text-[10px] text-indigo-600 font-semibold uppercase tracking-wide">AU8</span>
                  <span className="text-xl md:text-2xl font-black text-indigo-900 tabular-nums">
                    {Number(breakdown.AU8 || 0).toLocaleString()}
                  </span>
                </div>
                {breakdown.AU8 > 0 && (
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                )}
              </div>
            </div>
          )}

          {/* 副標題 */}
          {subtitle && (
            <p className="text-[11px] md:text-xs text-gray-500 leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>

        {/* Hover 提示（如果可點擊） */}
        {onClick && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent
                          opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        )}
      </div>
    </div>
  );
}
