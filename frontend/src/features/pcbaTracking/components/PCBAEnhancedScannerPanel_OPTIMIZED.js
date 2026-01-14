import React, { useEffect, useState, useRef } from "react";
import { QrCode, CheckCircle, AlertCircle, History, Zap } from "lucide-react";
import { classStage } from "../PCBAConstants";
import { inferModel } from "../PCBAUtils";

export default function PCBAEnhancedScannerPanel({ scanInput, setScanInput, handleScan, stageToAssign, setStageToAssign, disabled }) {
  const [selected, setSelected] = useState(stageToAssign);
  const [isScanning, setIsScanning] = useState(false);
  const [modelPreview, setModelPreview] = useState(null);
  const [recentScans, setRecentScans] = useState([]);
  const [scanCount, setScanCount] = useState(0);
  const inputRef = useRef(null);
  const audioSuccessRef = useRef(null);
  const audioErrorRef = useRef(null);

  useEffect(() => setSelected(stageToAssign), [stageToAssign]);
  useEffect(() => setModelPreview(scanInput ? inferModel(scanInput) : null), [scanInput]);

  // 🎹 快捷鍵支持：1=Aging, 2=Coating, 3=Inventory
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (disabled) return;
      if (e.target.tagName === 'INPUT') return; // 不干擾輸入框

      if (e.key === '1') setSelected('aging');
      if (e.key === '2') setSelected('coating');
      if (e.key === '3') setSelected('completed');

      // F2 快速聚焦輸入框
      if (e.key === 'F2') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [disabled]);

  // 載入音效
  useEffect(() => {
    audioSuccessRef.current = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBiuEzvLTgjMGHm7A7+OZSA0PVq/n7axfGws+mN3ywmwhBi2Bzv=='); // 簡短提示音
    audioErrorRef.current = new Audio('data:audio/wav;base64,UklGRhIAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0Ya0AAAA='); // 錯誤音
  }, []);

  const palette = {
    aging:     { active: "bg-amber-600 border-amber-600",   hover: "hover:bg-amber-50 hover:border-amber-300", ring: "ring-amber-500", dot: "bg-amber-300" },
    coating:   { active: "bg-cyan-600 border-cyan-600",     hover: "hover:bg-cyan-50 hover:border-cyan-300",   ring: "ring-cyan-500",  dot: "bg-cyan-300" },
    completed: { active: "bg-emerald-600 border-emerald-600", hover: "hover:bg-emerald-50 hover:border-emerald-300", ring: "ring-emerald-500", dot: "bg-emerald-300" },
  };

  const submitColors = {
    aging:     "bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white shadow-lg shadow-amber-500/50",
    coating:   "bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-700 hover:to-teal-700 text-white shadow-lg shadow-cyan-500/50",
    completed: "bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white shadow-lg shadow-emerald-500/50",
  };

  const submit = async () => {
    if (disabled || !modelPreview) return;

    setIsScanning(true);
    setStageToAssign(selected); // 先更新狀態

    try {
      await handleScan(selected);

      // ✅ 成功反饋
      audioSuccessRef.current?.play().catch(() => {});
      if (navigator.vibrate) navigator.vibrate(100); // 震動反饋

      // 記錄掃描歷史
      setRecentScans(prev => [{
        sn: scanInput,
        model: modelPreview,
        stage: selected,
        time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
      }, ...prev.slice(0, 4)]); // 保留最近 5 筆

      setScanCount(prev => prev + 1);

    } catch (error) {
      // ❌ 失敗反饋
      audioErrorRef.current?.play().catch(() => {});
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]); // 震動兩次
    } finally {
      setTimeout(() => setIsScanning(false), 200);
    }
  };

  return (
    <div className="rounded-2xl p-4 md:p-6 bg-white border border-gray-200 shadow-sm">
      <div className="space-y-4">
        {/* 標題區 - 加入計數器 */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center justify-center p-2 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 text-white">
                <QrCode size={20} />
              </div>
              <h2 className="text-base md:text-lg font-bold text-slate-900">掃描生產板</h2>
            </div>
            <p className="text-[11px] md:text-xs text-slate-500 mt-1 ml-10">Aging → Coating → Inventory</p>
          </div>

          {/* 今日掃描計數 */}
          {scanCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-200">
              <Zap size={14} className="text-indigo-600" />
              <span className="text-xs font-semibold text-indigo-700">{scanCount} 次</span>
            </div>
          )}
        </div>

        {/* 階段選擇按鈕 - 優化佈局 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-700">選擇階段</label>
            <span className="text-[10px] text-gray-400">快捷鍵: 1/2/3</span>
          </div>

          {/* 桌面版：橫向 3 個 */}
          <div className="hidden sm:grid grid-cols-3 gap-2.5">
            {classStage.map((s, idx) => {
              const Icon = s.icon;
              const active = selected === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => !disabled && setSelected(s.key)}
                  className={`relative w-full min-h-[88px] p-3 rounded-xl border-2 transition-all duration-200
                              flex flex-col items-center justify-center gap-2 ${
                                active
                                  ? `${palette[s.key].active} text-white shadow-md scale-105 ring-2 ${palette[s.key].ring}`
                                  : `bg-white text-slate-700 border-gray-200 ${palette[s.key].hover}`
                              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <Icon className={`w-7 h-7 ${active ? "text-white" : "text-slate-600"}`} />
                  <span className="text-sm font-bold">{s.label}</span>

                  {/* 快捷鍵提示 */}
                  <span className={`absolute top-2 left-2 w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                    active ? "bg-white/30 text-white" : "bg-gray-100 text-gray-500"
                  }`}>{idx + 1}</span>

                  {active && (
                    <span className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full ${palette[s.key].dot} animate-pulse`} />
                  )}
                </button>
              );
            })}
          </div>

          {/* 手機版：垂直大按鈕 */}
          <div className="sm:hidden space-y-2">
            {classStage.map((s, idx) => {
              const Icon = s.icon;
              const active = selected === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => !disabled && setSelected(s.key)}
                  className={`relative w-full p-4 rounded-xl border-2 transition-all duration-200
                              flex items-center gap-3 ${
                                active
                                  ? `${palette[s.key].active} text-white shadow-md ring-2 ${palette[s.key].ring}`
                                  : `bg-white text-slate-700 border-gray-200 ${palette[s.key].hover}`
                              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <div className={`p-2 rounded-lg ${active ? "bg-white/20" : "bg-gray-100"}`}>
                    <Icon className={`w-6 h-6 ${active ? "text-white" : "text-slate-600"}`} />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-base font-bold">{s.label}</div>
                    <div className={`text-xs ${active ? "text-white/80" : "text-gray-500"}`}>按 {idx + 1} 快速選擇</div>
                  </div>
                  {active && (
                    <span className={`w-3 h-3 rounded-full ${palette[s.key].dot} animate-pulse`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 輸入框 - 加強視覺反饋 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-700">序號輸入</label>
            <span className="text-[10px] text-gray-400">F2 快速聚焦</span>
          </div>

          <div className="relative">
            <input
              ref={inputRef}
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && modelPreview && submit()}
              placeholder="掃描或輸入序號..."
              disabled={disabled}
              autoFocus
              className={`w-full px-4 py-4 rounded-xl border-2 transition-all duration-200
                         text-base md:text-lg font-mono text-black placeholder-gray-400
                         focus:outline-none disabled:opacity-60 disabled:bg-gray-50 ${
                           modelPreview
                             ? "border-emerald-300 bg-emerald-50/30 focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500"
                             : scanInput
                               ? "border-rose-300 bg-rose-50/30 focus:ring-4 focus:ring-rose-500/20 focus:border-rose-500"
                               : "border-gray-300 bg-white focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500"
                         }`}
            />

            {/* 掃描中動畫 */}
            {isScanning && (
              <div className="absolute inset-0 rounded-xl bg-white/80 backdrop-blur-sm flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="animate-spin rounded-full h-8 w-8 border-3 border-indigo-600 border-b-transparent"></div>
                  <span className="text-xs font-medium text-indigo-600">處理中...</span>
                </div>
              </div>
            )}
          </div>

          {/* 型號驗證提示 - 改為更明顯 */}
          {scanInput && (
            <div className="flex items-center justify-center">
              {modelPreview ? (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-100 border border-emerald-300">
                  <CheckCircle size={18} className="text-emerald-600" />
                  <span className="text-sm font-semibold text-emerald-800">✓ 識別為 {modelPreview} 型號</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-100 border border-rose-300">
                  <AlertCircle size={18} className="text-rose-600" />
                  <span className="text-sm font-semibold text-rose-800">✗ 無效序號 - 僅接受 AM7/AU8</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 提交按鈕 - 更明顯的階段指示 */}
        <button
          onClick={submit}
          disabled={disabled || !scanInput.trim() || !modelPreview}
          className={`w-full py-4 rounded-xl font-bold text-base transition-all duration-200
                      flex items-center justify-center gap-2 ${
            scanInput.trim() && modelPreview && !disabled
              ? `${submitColors[selected]} transform active:scale-95`
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          {disabled ? (
            "👁️ 檢視者無法操作"
          ) : modelPreview ? (
            <>
              <QrCode size={20} />
              <span>掃描 {modelPreview} 至 <strong className="underline">{classStage.find((s) => s.key === selected)?.label}</strong></span>
            </>
          ) : (
            "請輸入有效序號"
          )}
        </button>

        {/* 最近掃描歷史 */}
        {recentScans.length > 0 && (
          <div className="pt-3 border-t border-gray-200">
            <div className="flex items-center gap-1.5 mb-2">
              <History size={14} className="text-gray-500" />
              <span className="text-xs font-medium text-gray-600">最近掃描</span>
            </div>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {recentScans.map((scan, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
                  onClick={() => setScanInput(scan.sn)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      scan.stage === 'aging' ? 'bg-amber-500' :
                      scan.stage === 'coating' ? 'bg-cyan-500' : 'bg-emerald-500'
                    }`}></span>
                    <span className="text-xs font-mono text-gray-700 truncate">{scan.sn}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] font-medium text-gray-500">{scan.model}</span>
                    <span className="text-[10px] text-gray-400">{scan.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
