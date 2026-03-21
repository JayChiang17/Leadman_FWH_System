import React, { useState } from "react";
import PCBAEnhancedScannerPanelOptimized from "./components/PCBAEnhancedScannerPanel_OPTIMIZED";
import PCBAStatCardOptimized from "./components/PCBAStatCard_OPTIMIZED";
import PCBASmartFilters from "./components/PCBASmartFilters";
import { Clock, Activity, CheckCircle, Package } from "lucide-react";

/**
 * 📺 PCBA 優化版 UI/UX 預覽頁面
 *
 * 這個頁面展示所有優化後的組件，不影響現有系統
 * 可以在這裡測試所有新功能
 */
export default function PCBAOptimizedDemo() {
  // Scanner 狀態
  const [scanInput, setScanInput] = useState("");
  const [stageToAssign, setStageToAssign] = useState("aging");

  // Filter 狀態
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterSlip, setFilterSlip] = useState("");
  const [modelFilter, setModelFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [ngFilter, setNgFilter] = useState("all");
  const [useSlipFilter, setUseSlipFilter] = useState(false);
  const [slipFilterApplied, setSlipFilterApplied] = useState("");

  // Mock 掃描處理
  const handleScan = async (stage) => {

    // 模擬 API 呼叫
    await new Promise(resolve => setTimeout(resolve, 500));

    // 清空輸入
    setScanInput("");

    return Promise.resolve();
  };

  return (
    <div className="min-h-screen bg-surface-base p-4 md:p-8">
      {/* 頁面標題 */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="bg-surface-panel rounded-xl p-6 border border-signal-info/30 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-gradient-to-br from-teal-500/100 to-teal-600">
              <Package className="text-white" size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-ink-primary">PCBA Tracking - 優化版預覽</h1>
              <p className="text-sm text-ink-secondary mt-1">展示所有 UI/UX 改進，不影響現有系統</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto space-y-8">
        {/* 統計卡片展示 */}
        <section>
          <h2 className="text-lg font-bold text-ink-primary mb-4 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-signal-info/15 text-signal-info flex items-center justify-center text-sm font-bold">1</span>
            統計卡片優化（超大數字 + 趨勢）
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            <PCBAStatCardOptimized
              title="Aging In Progress"
              value={45}
              icon={Clock}
              gradient="from-signal-warn/100 to-orange-600"
              breakdown={{ AM7: 22, AU8: 23 }}
              subtitle="即時統計"
              trend={{ value: 12, direction: 'up' }}
            />

            <PCBAStatCardOptimized
              title="Coating In Progress"
              value={38}
              icon={Activity}
              gradient="from-cyan-600 to-teal-600"
              breakdown={{ AM7: 18, AU8: 20 }}
              subtitle="即時統計"
              trend={{ value: 5, direction: 'down' }}
            />

            <PCBAStatCardOptimized
              title="Inventory (Available)"
              value={127}
              icon={CheckCircle}
              gradient="from-signal-ok/100 to-emerald-600"
              breakdown={{ AM7: 64, AU8: 63 }}
              subtitle="可用庫存"
              badgeLabel="NG 8"
              trend={{ value: 18, direction: 'up' }}
            />

            <PCBAStatCardOptimized
              title="Pairs Done"
              value={63}
              icon={Package}
              gradient="from-teal-500/100 to-teal-700"
              subtitle="min(AM7, AU8)"
            />
          </div>
        </section>

        {/* 掃描器面板展示 */}
        <section>
          <h2 className="text-lg font-bold text-ink-primary mb-4 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-signal-info/15 text-signal-info flex items-center justify-center text-sm font-bold">2</span>
            掃描器面板優化（快捷鍵 + 歷史 + 音效）
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PCBAEnhancedScannerPanelOptimized
              scanInput={scanInput}
              setScanInput={setScanInput}
              handleScan={handleScan}
              stageToAssign={stageToAssign}
              setStageToAssign={setStageToAssign}
              disabled={false}
            />

            <div className="bg-surface-panel rounded-xl p-6 border border-stroke">
              <h3 className="font-bold text-ink-primary mb-3">✨ 新增功能清單</h3>
              <ul className="space-y-2 text-sm text-ink-secondary">
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span><strong>快捷鍵</strong>: 按 1/2/3 選擇階段，F2 聚焦輸入框</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span><strong>掃描歷史</strong>: 顯示最近 5 筆，點擊重新填入</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span><strong>音效反饋</strong>: 成功/失敗有不同提示音</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span><strong>震動反饋</strong>: 支援手機震動提示</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span><strong>掃描計數</strong>: 右上角顯示今日掃描次數</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span><strong>手機優化</strong>: 垂直大按鈕，易於點擊</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span><strong>視覺增強</strong>: 輸入框顏色隨驗證狀態變化</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* 智慧篩選器展示 */}
        <section>
          <h2 className="text-lg font-bold text-ink-primary mb-4 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-signal-info/15 text-signal-info flex items-center justify-center text-sm font-bold">3</span>
            智慧篩選器（標籤 + 一鍵清除 + 手機摺疊）
          </h2>

          <div className="bg-surface-panel rounded-xl p-6 border border-stroke">
            <PCBASmartFilters
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              filterDate={filterDate}
              setFilterDate={setFilterDate}
              filterSlip={filterSlip}
              setFilterSlip={setFilterSlip}
              modelFilter={modelFilter}
              setModelFilter={setModelFilter}
              stageFilter={stageFilter}
              setStageFilter={setStageFilter}
              ngFilter={ngFilter}
              setNgFilter={setNgFilter}
              useSlipFilter={useSlipFilter}
              setUseSlipFilter={setUseSlipFilter}
              slipFilterApplied={slipFilterApplied}
              onApplySlipFilter={setSlipFilterApplied}
              totalCount={1250}
              filteredCount={847}
            />

            <div className="mt-6 pt-6 border-t border-stroke">
              <h3 className="font-bold text-ink-primary mb-3">✨ 改進重點</h3>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-ink-secondary">
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span>啟用篩選顯示為彩色標籤</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span>可單獨移除或一鍵清除全部</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span>即時顯示篩選結果數量</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span>手機版可摺疊（節省空間）</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span>Slip 篩選整合為單一控制</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-bold">✓</span>
                  <span>視覺分組（搜尋/日期/Slip）</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* 使用說明 */}
        <section className="bg-gradient-to-r from-signal-info/10 to-teal-500/100/10 rounded-xl p-6 border border-signal-info/30">
          <h2 className="text-lg font-bold text-ink-primary mb-4">📖 測試指南</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-ink-primary mb-2">掃描器測試</h3>
              <ol className="space-y-1 text-sm text-ink-secondary list-decimal list-inside">
                <li>按鍵盤 <kbd className="px-2 py-1 bg-surface-panel rounded border">1</kbd> 選擇 Aging</li>
                <li>按 <kbd className="px-2 py-1 bg-surface-panel rounded border">F2</kbd> 聚焦輸入框</li>
                <li>輸入測試序號: <code className="bg-surface-panel px-2 py-1 rounded">10030035A00M25510031</code></li>
                <li>按 <kbd className="px-2 py-1 bg-surface-panel rounded border">Enter</kbd> 提交</li>
                <li>查看掃描歷史記錄</li>
              </ol>
            </div>

            <div>
              <h3 className="font-semibold text-ink-primary mb-2">篩選器測試</h3>
              <ol className="space-y-1 text-sm text-ink-secondary list-decimal list-inside">
                <li>在搜尋框輸入任意文字</li>
                <li>選擇日期</li>
                <li>選擇型號 AU8</li>
                <li>觀察上方的彩色標籤</li>
                <li>點擊「清除全部」按鈕</li>
              </ol>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
