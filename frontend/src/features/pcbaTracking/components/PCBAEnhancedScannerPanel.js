import React, { useEffect, useState, useRef } from "react";
import { QrCode, CheckCircle, AlertCircle, Zap } from "lucide-react";
import { classStage } from "../PCBAConstants";
import { inferModel } from "../PCBAUtils";

export default function PCBAEnhancedScannerPanel({ scanInput, setScanInput, handleScan, stageToAssign, setStageToAssign, disabled }) {
  const [selected, setSelected] = useState(stageToAssign);
  const [isScanning, setIsScanning] = useState(false);
  const [modelPreview, setModelPreview] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => setSelected(stageToAssign), [stageToAssign]);
  useEffect(() => setModelPreview(scanInput ? inferModel(scanInput) : null), [scanInput]);

  // 快捷鍵支持
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (disabled || e.target.tagName === 'INPUT') return;
      if (e.key === '1') setSelected('aging');
      if (e.key === '2') setSelected('coating');
      if (e.key === '3') setSelected('completed');
      if (e.key === 'F2') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [disabled]);

  const palette = {
    aging:     {
      active: "bg-gradient-to-br from-amber-600 to-orange-600 border-amber-600 shadow-lg shadow-amber-500/30",
      hover: "hover:bg-amber-50 hover:border-amber-400 hover:shadow-md",
      ring: "ring-amber-500",
      dot: "bg-amber-300"
    },
    coating:   {
      active: "bg-gradient-to-br from-cyan-600 to-teal-600 border-cyan-600 shadow-lg shadow-cyan-500/30",
      hover: "hover:bg-cyan-50 hover:border-cyan-400 hover:shadow-md",
      ring: "ring-cyan-500",
      dot: "bg-cyan-300"
    },
    completed: {
      active: "bg-gradient-to-br from-emerald-600 to-green-600 border-emerald-600 shadow-lg shadow-emerald-500/30",
      hover: "hover:bg-emerald-50 hover:border-emerald-400 hover:shadow-md",
      ring: "ring-emerald-500",
      dot: "bg-emerald-300"
    },
  };
  const submitColors = {
    aging: "bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-95",
    coating: "bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-700 hover:to-teal-700 text-white shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-95",
    completed: "bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-95",
  };

  const submit = async () => {
    if (disabled || !modelPreview) return;
    setIsScanning(true);
    setStageToAssign(selected);
    await handleScan(selected);
    setTimeout(() => setIsScanning(false), 200);
  };

  return (
    <div className="rounded-2xl p-4 md:p-6 bg-gradient-to-br from-white to-gray-50/50 border border-gray-200 shadow-md hover:shadow-lg transition-shadow duration-300">
      <div className="space-y-4">
        {/* 標題區 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 shadow-lg shadow-indigo-500/30">
              <QrCode size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-bold text-slate-900">Scan Production Board</h2>
              <p className="text-[11px] md:text-xs text-slate-500">Aging → Coating → Inventory</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200">
            <Zap size={12} className="text-indigo-600" />
            <span className="text-[10px] font-semibold text-indigo-700">1/2/3 Shortcuts</span>
          </div>
        </div>

        {/* 階段選擇 */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Select Stage</label>
          <div className="grid grid-cols-3 gap-2.5">
            {classStage.map((s, idx) => {
              const Icon = s.icon;
              const active = selected === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => !disabled && setSelected(s.key)}
                  className={`relative w-full min-h-[90px] p-3 rounded-xl border-2 transition-all duration-200
                              flex flex-col items-center justify-center gap-2 ${
                                active
                                  ? `${palette[s.key].active} text-white ring-2 ${palette[s.key].ring} transform scale-105`
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
        </div>

        {/* 序號輸入 */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Serial Number</label>
          <div className="relative">
            <input
              ref={inputRef}
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && modelPreview && submit()}
              placeholder="Scan or type serial number..."
              disabled={disabled}
              autoFocus
              className={`w-full px-4 py-4 rounded-xl border-2 transition-all duration-200
                         text-base md:text-lg font-mono text-black placeholder-gray-400
                         focus:outline-none disabled:opacity-60 disabled:bg-gray-50 ${
                           modelPreview
                             ? "border-emerald-400 bg-emerald-50/30 focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-md"
                             : scanInput
                               ? "border-rose-400 bg-rose-50/30 focus:ring-4 focus:ring-rose-500/20 focus:border-rose-500 shadow-md"
                               : "border-gray-300 bg-white focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500"
                         }`}
            />
            {isScanning && (
              <div className="absolute inset-0 rounded-xl bg-white/80 backdrop-blur-sm flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="animate-spin rounded-full h-8 w-8 border-3 border-indigo-600 border-b-transparent"></div>
                  <span className="text-xs font-medium text-indigo-600">Processing...</span>
                </div>
              </div>
            )}
          </div>

          {scanInput && (
            <div className="flex items-center justify-center">
              {modelPreview ? (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-100 border border-emerald-300 shadow-sm">
                  <CheckCircle size={18} className="text-emerald-600" />
                  <span className="text-sm font-semibold text-emerald-800">✓ Detected: {modelPreview} Model</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-100 border border-rose-300 shadow-sm">
                  <AlertCircle size={18} className="text-rose-600" />
                  <span className="text-sm font-semibold text-rose-800">✗ Invalid - Only AM7/AU8 Accepted</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 提交按鈕 */}
        <button
          onClick={submit}
          disabled={disabled || !scanInput.trim() || !modelPreview}
          className={`w-full py-4 rounded-xl font-bold text-base transition-all duration-200
                      flex items-center justify-center gap-2 ${
            scanInput.trim() && modelPreview && !disabled
              ? submitColors[selected]
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          {disabled ? (
            "👁️ Viewer cannot operate"
          ) : modelPreview ? (
            <>
              <QrCode size={20} />
              <span>Scan {modelPreview} to <strong className="underline">{classStage.find((s) => s.key === selected)?.label}</strong></span>
            </>
          ) : (
            "Enter Valid Serial Number"
          )}
        </button>
      </div>
    </div>
  );
}
