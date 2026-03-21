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
      active: "bg-amber-600 border-amber-600 shadow-md",
      hover: "hover:bg-signal-warn/10 hover:border-amber-400",
      ring: "ring-amber-500",
      dot: "bg-amber-300"
    },
    coating:   {
      active: "bg-teal-600 border-teal-600 shadow-md",
      hover: "hover:bg-teal-500/10 hover:border-teal-400",
      ring: "ring-teal-500",
      dot: "bg-teal-300"
    },
    completed: {
      active: "bg-emerald-600 border-emerald-600 shadow-md",
      hover: "hover:bg-signal-ok/10 hover:border-emerald-400",
      ring: "ring-emerald-500",
      dot: "bg-emerald-300"
    },
  };
  const submitColors = {
    aging: "bg-amber-600 hover:bg-amber-700 text-white shadow-lg active:scale-95",
    coating: "bg-teal-600 hover:bg-teal-700 text-white shadow-lg active:scale-95",
    completed: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg active:scale-95",
  };

  const submit = async () => {
    if (disabled || !modelPreview) return;
    setIsScanning(true);
    setStageToAssign(selected);
    await handleScan(selected);
    setTimeout(() => setIsScanning(false), 200);
  };

  return (
    <div className="rounded-xl p-4 md:p-5 bg-surface-panel border border-stroke">
      <div className="space-y-4">
        {/* 標題區 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-teal-600">
              <QrCode size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-bold text-ink-primary">Scan Production Board</h2>
              <p className="text-[11px] md:text-xs text-ink-muted">Aging → Coating → Inventory</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-500/10 border border-teal-500/30">
            <Zap size={12} className="text-teal-400" />
            <span className="text-[10px] font-semibold text-teal-400">1/2/3 Shortcuts</span>
          </div>
        </div>

        {/* 階段選擇 */}
        <div>
          <label className="block text-xs font-semibold text-ink-secondary mb-2 uppercase tracking-wide">Select Stage</label>
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
                                  ? `${palette[s.key].active} text-white ring-2 ${palette[s.key].ring}`
                                  : `bg-surface-panel text-ink-secondary border-stroke ${palette[s.key].hover}`
                              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <Icon className={`w-7 h-7 ${active ? "text-white" : "text-ink-secondary"}`} />
                  <span className="text-sm font-bold">{s.label}</span>

                  {/* 快捷鍵提示 */}
                  <span className={`absolute top-2 left-2 w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                    active ? "bg-white/30 text-white" : "bg-surface-raised text-ink-muted"
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
          <label className="block text-xs font-semibold text-ink-secondary uppercase tracking-wide">Serial Number</label>
          <div className="relative">
            <input
              ref={inputRef}
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && modelPreview && submit()}
              placeholder="Scan or type serial number..."
              disabled={disabled}
              autoFocus
              className={`w-full px-4 py-4 rounded-xl border-2 transition-colors duration-200
                         text-base md:text-lg font-mono text-ink-primary placeholder-ink-muted
                         focus:outline-none disabled:opacity-60 disabled:bg-surface-base ${
                           modelPreview
                             ? "border-emerald-400 bg-signal-ok/10 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                             : scanInput
                               ? "border-red-400 bg-signal-error/10 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                               : "border-stroke bg-surface-raised focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                         }`}
            />
            {isScanning && (
              <div className="absolute inset-0 rounded-xl bg-surface-overlay/90 backdrop-blur-sm flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="animate-spin rounded-lg h-8 w-8 border-3 border-teal-600 border-b-transparent"></div>
                  <span className="text-xs font-medium text-teal-400">Processing...</span>
                </div>
              </div>
            )}
          </div>

          {scanInput && (
            <div className="flex items-center justify-center">
              {modelPreview ? (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-signal-ok/15 border border-emerald-300">
                  <CheckCircle size={18} className="text-emerald-400" />
                  <span className="text-sm font-semibold text-emerald-300">Detected: {modelPreview} Model</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-signal-error/15 border border-red-300">
                  <AlertCircle size={18} className="text-red-400" />
                  <span className="text-sm font-semibold text-red-300">Invalid - Only AM7/AU8 Accepted</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 提交按鈕 */}
        <button
          onClick={submit}
          disabled={disabled || !scanInput.trim() || !modelPreview}
          className={`w-full py-4 rounded-lg font-bold text-base transition-colors duration-150
                      flex items-center justify-center gap-2 ${
            scanInput.trim() && modelPreview && !disabled
              ? submitColors[selected]
              : "bg-surface-raised text-ink-muted cursor-not-allowed"
          }`}
        >
          {disabled ? (
            "Viewer cannot operate"
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
