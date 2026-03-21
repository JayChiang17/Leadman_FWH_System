import React, { useState } from "react";
import { Search, Calendar, Filter, X, Tag, AlertCircle, ChevronDown } from "lucide-react";

export default function PCBASmartFilters({
  searchQuery,
  setSearchQuery,
  filterDate,
  setFilterDate,
  filterSlip,
  setFilterSlip,
  modelFilter,
  setModelFilter,
  stageFilter,
  setStageFilter,
  ngFilter,
  setNgFilter,
  useSlipFilter,
  setUseSlipFilter,
  slipFilterApplied,
  onApplySlipFilter,
  totalCount,
  filteredCount
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  // 計算啟用的篩選器數量
  const activeFiltersCount = [
    searchQuery,
    filterDate,
    filterSlip || slipFilterApplied,
    modelFilter !== 'all',
    stageFilter !== 'all',
    ngFilter !== 'all'
  ].filter(Boolean).length;

  // 清除所有篩選
  const clearAllFilters = () => {
    setSearchQuery('');
    setFilterDate('');
    setFilterSlip('');
    setModelFilter('all');
    setStageFilter('all');
    setNgFilter('all');
    setUseSlipFilter(false);
    onApplySlipFilter('');
  };

  return (
    <div className="space-y-3">
      {/* 摘要列 - 顯示篩選狀態 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-signal-info" />
          <h3 className="text-base md:text-lg font-bold text-ink-primary">篩選器</h3>

          {activeFiltersCount > 0 && (
            <span className="px-2.5 py-0.5 rounded-full bg-signal-info/15 text-signal-info text-xs font-bold">
              {activeFiltersCount} 個啟用
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 結果計數 */}
          <div className="text-sm text-ink-secondary">
            顯示 <span className="font-bold text-signal-info">{filteredCount}</span> / {totalCount}
          </div>

          {/* 清除按鈕 */}
          {activeFiltersCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="px-3 py-1.5 rounded-lg bg-surface-raised hover:bg-surface-overlay text-ink-secondary text-xs font-medium transition-colors flex items-center gap-1"
            >
              <X size={14} />
              <span className="hidden sm:inline">清除全部</span>
            </button>
          )}

          {/* 手機版展開/收起按鈕 */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="md:hidden px-3 py-1.5 rounded-lg bg-signal-info/10 hover:bg-signal-info/15 text-signal-info text-xs font-medium transition-colors flex items-center gap-1"
          >
            <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            {isExpanded ? '收起' : '展開'}
          </button>
        </div>
      </div>

      {/* 快速篩選標籤（當前啟用的篩選） */}
      {activeFiltersCount > 0 && (
        <div className="flex flex-wrap gap-2">
          {searchQuery && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-signal-info/10 border border-blue-500/30 text-xs">
              <Search size={12} className="text-blue-400" />
              <span className="text-blue-400 font-medium">搜尋: {searchQuery}</span>
              <button onClick={() => setSearchQuery('')} className="text-blue-400 hover:text-blue-300">
                <X size={12} />
              </button>
            </div>
          )}

          {filterDate && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-signal-info/15 border border-signal-info/30 text-xs">
              <Calendar size={12} className="text-signal-info" />
              <span className="text-signal-info font-medium">{filterDate}</span>
              <button onClick={() => setFilterDate('')} className="text-signal-info hover:text-cyan-300">
                <X size={12} />
              </button>
            </div>
          )}

          {(filterSlip || slipFilterApplied) && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-signal-warn/10 border border-amber-500/30 text-xs">
              <Tag size={12} className="text-amber-400" />
              <span className="text-amber-400 font-medium">Slip: {filterSlip || slipFilterApplied}</span>
              <button onClick={() => { setFilterSlip(''); onApplySlipFilter(''); }} className="text-amber-400 hover:text-amber-300">
                <X size={12} />
              </button>
            </div>
          )}

          {modelFilter !== 'all' && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-signal-info/10 border border-cyan-500/30 text-xs">
              <span className="text-cyan-400 font-medium">{modelFilter}</span>
              <button onClick={() => setModelFilter('all')} className="text-cyan-400 hover:text-cyan-300">
                <X size={12} />
              </button>
            </div>
          )}

          {stageFilter !== 'all' && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-signal-ok/10 border border-green-500/30 text-xs">
              <span className="text-green-400 font-medium">{
                stageFilter === 'aging' ? 'Aging' :
                stageFilter === 'coating' ? 'Coating' : 'Inventory'
              }</span>
              <button onClick={() => setStageFilter('all')} className="text-green-400 hover:text-green-300">
                <X size={12} />
              </button>
            </div>
          )}

          {ngFilter !== 'all' && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-signal-error/10 border border-rose-500/30 text-xs">
              <AlertCircle size={12} className="text-rose-400" />
              <span className="text-rose-400 font-medium">{ngFilter === 'ng' ? '僅 NG' : '僅正常'}</span>
              <button onClick={() => setNgFilter('all')} className="text-rose-400 hover:text-rose-300">
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* 篩選器主體 - 桌面版永遠顯示，手機版可摺疊 */}
      <div className={`
        space-y-3 md:space-y-0
        ${isExpanded ? 'block' : 'hidden md:block'}
      `}>
        {/* 第一行：搜尋 + 日期 + Slip */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* 搜尋序號/批號 */}
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              搜尋序號 / 批號
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" size={16} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="輸入序號或批號..."
                className="w-full pl-9 pr-4 py-2.5 bg-surface-raised border border-stroke rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-signal-info focus:border-signal-info
                           text-ink-primary placeholder-ink-muted"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-secondary"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* 日期篩選 */}
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              更新日期
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" size={16} />
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 bg-surface-raised border border-stroke rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-signal-info focus:border-signal-info
                           text-ink-primary"
              />
              {filterDate && (
                <button
                  onClick={() => setFilterDate('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-secondary"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Packing Slip 智慧篩選 */}
          <div className="md:col-span-5">
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              Packing Slip 編號
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" size={16} />
                <input
                  value={filterSlip}
                  onChange={(e) => setFilterSlip(e.target.value)}
                  placeholder="輸入 Slip 編號..."
                  className="w-full pl-9 pr-4 py-2.5 bg-surface-raised border border-stroke rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-signal-info focus:border-signal-info
                             text-ink-primary placeholder-ink-muted"
                />
              </div>

              {/* 套用/清除按鈕 */}
              {filterSlip && (
                <button
                  onClick={() => onApplySlipFilter(filterSlip)}
                  className="px-4 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors whitespace-nowrap"
                >
                  套用
                </button>
              )}

              {slipFilterApplied && (
                <button
                  onClick={() => { setFilterSlip(''); onApplySlipFilter(''); }}
                  className="px-4 py-2.5 rounded-lg bg-surface-raised hover:bg-surface-overlay text-ink-secondary text-sm font-medium transition-colors whitespace-nowrap"
                >
                  清除
                </button>
              )}
            </div>

            {/* Slip 篩選狀態指示 */}
            {slipFilterApplied && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-signal-info">
                <div className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-pulse"></div>
                <span>已套用 Slip 篩選: <strong>{slipFilterApplied}</strong></span>
              </div>
            )}
          </div>
        </div>

        {/* 第二行：型號 + 階段 + NG 狀態 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* 型號篩選 */}
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              型號
            </label>
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="w-full px-4 py-2.5 bg-surface-raised border border-stroke rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-signal-info focus:border-signal-info
                         text-ink-primary appearance-none cursor-pointer
                         bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iOCIgdmlld0JveD0iMCAwIDEyIDgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTEgMS41TDYgNi41TDExIDEuNSIgc3Ryb2tlPSIjOTg5OGE4IiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+')] bg-[length:12px] bg-[center_right_12px] bg-no-repeat pr-9"
            >
              <option value="all">全部型號</option>
              <option value="AM7">AM7</option>
              <option value="AU8">AU8</option>
            </select>
          </div>

          {/* 階段篩選 */}
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              生產階段
            </label>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" size={16} />
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="w-full pl-9 pr-9 py-2.5 bg-surface-raised border border-stroke rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-signal-info focus:border-signal-info
                           text-ink-primary appearance-none cursor-pointer
                           bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iOCIgdmlld0JveD0iMCAwIDEyIDgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTEgMS41TDYgNi41TDExIDEuNSIgc3Ryb2tlPSIjOTg5OGE4IiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+')] bg-[length:12px] bg-[center_right_12px] bg-no-repeat"
              >
                <option value="all">全部階段</option>
                <option value="aging">⏰ Aging</option>
                <option value="coating">🎨 Coating</option>
                <option value="completed">✅ Inventory</option>
              </select>
            </div>
          </div>

          {/* NG 狀態篩選 */}
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              品質狀態
            </label>
            <div className="relative">
              <AlertCircle className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-400" size={16} />
              <select
                value={ngFilter}
                onChange={(e) => setNgFilter(e.target.value)}
                className="w-full pl-9 pr-9 py-2.5 bg-surface-raised border border-rose-500/30 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400
                           text-ink-primary appearance-none cursor-pointer
                           bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iOCIgdmlld0JveD0iMCAwIDEyIDgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTEgMS41TDYgNi41TDExIDEuNSIgc3Ryb2tlPSIjOTg5OGE4IiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+')] bg-[length:12px] bg-[center_right_12px] bg-no-repeat"
              >
                <option value="all">全部狀態</option>
                <option value="ng">⚠️ 僅 NG</option>
                <option value="ok">✓ 僅正常</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
