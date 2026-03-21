import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Zap, ScanLine, Hash, Trash2 } from "lucide-react";

function cleanSn(value) {
  return String(value || "").trim().toUpperCase().replace(/[- ]/g, "");
}

export default function BatteryAdjModal({ kind: initialKind, currentAvailableByKind, onConfirm, onClose }) {
  const [kind, setKind] = useState(initialKind || "A");
  const [mode, setMode] = useState("count");
  const initialAvailable = currentAvailableByKind?.[initialKind || "A"] ?? 0;
  const [targetAvailable, setTargetAvailable] = useState(String(Math.max(0, initialAvailable)));
  const [scanInput, setScanInput] = useState("");
  const [scannedSns, setScannedSns] = useState([]);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (initialKind) setKind(initialKind);
  }, [initialKind]);

  const currentAvailable = currentAvailableByKind?.[kind] ?? 0;

  useEffect(() => {
    setTargetAvailable(String(Math.max(0, currentAvailable)));
  }, [currentAvailable]);

  const targetNum = parseInt(targetAvailable, 10);
  const manualPreview = Number.isNaN(targetNum) ? null : targetNum - currentAvailable;
  const canSubmitManual = !Number.isNaN(targetNum) && targetNum >= 0 && reason.trim().length > 0;
  const canSubmitScan = scannedSns.length > 0 && reason.trim().length > 0;

  const helperText = useMemo(() => {
    if (mode === "scan") {
      if (!scannedSns.length) return "Scan battery SN one by one, then submit once.";
      return `Scanned ${scannedSns.length} unique SN${scannedSns.length > 1 ? "s" : ""}.`;
    }
    if (manualPreview === null) return "Enter the actual battery quantity on the floor.";
    if (manualPreview === 0) return "System quantity already matches your physical count.";
    return `System will ${manualPreview > 0 ? "add" : "remove"} ${Math.abs(manualPreview)} automatically.`;
  }, [mode, scannedSns.length, manualPreview]);

  const addScannedSn = () => {
    const cleaned = cleanSn(scanInput);
    if (!cleaned) return;
    if (scannedSns.includes(cleaned)) {
      setLocalError(`${cleaned} already added`);
      setScanInput("");
      return;
    }
    setScannedSns((prev) => [cleaned, ...prev]);
    setScanInput("");
    setLocalError("");
  };

  const handleSubmit = () => {
    if (mode === "count") {
      if (!canSubmitManual) return;
      onConfirm({ kind, reason: reason.trim(), target_available: targetNum });
      return;
    }
    if (!canSubmitScan) return;
    onConfirm({ kind, reason: reason.trim(), scanned_sns: scannedSns });
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="bg-surface-panel border border-stroke rounded-xl p-6 w-full max-w-xl shadow-xl"
          initial={{ opacity: 0, scale: 0.94, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 16 }}
          transition={{ type: "spring", stiffness: 340, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Zap size={18} className="text-amber-500" />
              <div>
                <h3 className="text-ink-primary font-bold text-base">Adjust Battery Inventory</h3>
                <p className="text-xs text-ink-muted mt-0.5">Current system available: {Number(currentAvailable).toLocaleString()}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-ink-muted hover:text-ink-secondary transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center">
              <X size={18} />
            </button>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
              Battery Type
            </label>
            <div className="flex gap-2">
              {["A", "B"].map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`flex-1 py-2.5 rounded-lg font-bold text-sm border transition-colors duration-150 min-h-[44px]
                    ${kind === k
                      ? "bg-teal-600 border-teal-600 text-white"
                      : "bg-surface-panel border-stroke text-ink-secondary hover:border-teal-300"
                    }`}
                >
                  Battery {k}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
              Adjust Method
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setMode("count"); setLocalError(""); }}
                className={`rounded-lg border px-3 py-3 text-sm font-semibold transition-colors ${
                  mode === "count"
                    ? "bg-stone-900 border-stone-900 text-white"
                    : "bg-surface-panel border-stroke text-ink-secondary hover:border-stone-400"
                }`}
              >
                <span className="inline-flex items-center gap-2"><Hash size={14} /> Actual Qty</span>
              </button>
              <button
                onClick={() => { setMode("scan"); setLocalError(""); }}
                className={`rounded-lg border px-3 py-3 text-sm font-semibold transition-colors ${
                  mode === "scan"
                    ? "bg-stone-900 border-stone-900 text-white"
                    : "bg-surface-panel border-stroke text-ink-secondary hover:border-stone-400"
                }`}
              >
                <span className="inline-flex items-center gap-2"><ScanLine size={14} /> Scan SNs</span>
              </button>
            </div>
          </div>

          {mode === "count" ? (
            <div className="mb-4">
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                Actual Qty On Floor
              </label>
              <input
                type="number"
                min="0"
                value={targetAvailable}
                onChange={(e) => { setTargetAvailable(e.target.value); setLocalError(""); }}
                placeholder="e.g. 38"
                className="w-full border-2 border-stroke focus:border-teal-500 rounded-lg px-4 py-3 text-ink-primary font-mono text-base bg-surface-panel focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-colors"
                style={{ fontSize: "16px" }}
              />
            </div>
          ) : (
            <div className="mb-4">
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                Scan Battery SN One By One
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={scanInput}
                  onChange={(e) => { setScanInput(e.target.value); setLocalError(""); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addScannedSn();
                    }
                  }}
                  placeholder="Scan SN and press Enter"
                  className="flex-1 border-2 border-stroke focus:border-teal-500 rounded-lg px-4 py-3 text-ink-primary font-mono text-base bg-surface-panel focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-colors"
                  style={{ fontSize: "16px" }}
                />
                <button
                  type="button"
                  onClick={addScannedSn}
                  className="px-4 rounded-lg bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700 transition-colors min-h-[48px]"
                >
                  Add
                </button>
              </div>

              <div className="mt-3 rounded-lg border border-stroke bg-surface-base">
                <div className="flex items-center justify-between px-3 py-2 border-b border-stroke">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Scanned List</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-ink-muted">{scannedSns.length} pcs</span>
                    {!!scannedSns.length && (
                      <button
                        type="button"
                        onClick={() => setScannedSns([])}
                        className="text-xs text-red-500 hover:text-red-400 inline-flex items-center gap-1"
                      >
                        <Trash2 size={12} /> Clear
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto px-3 py-2 space-y-2">
                  {!scannedSns.length && <p className="text-xs text-stone-400">No SN scanned yet.</p>}
                  {scannedSns.map((sn) => (
                    <div key={sn} className="flex items-center gap-2 rounded-md bg-surface-panel border border-stroke px-3 py-2">
                      <span className="flex-1 font-mono text-xs text-ink-secondary break-all">{sn}</span>
                      <button
                        type="button"
                        onClick={() => setScannedSns((prev) => prev.filter((item) => item !== sn))}
                        className="text-stone-400 hover:text-red-500 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mb-5">
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
              Reason
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={mode === "scan" ? "e.g. Floor scan recount" : "e.g. Physical count correction"}
              className="w-full border-2 border-stroke focus:border-teal-500 rounded-lg px-4 py-3 text-ink-primary text-base bg-surface-panel focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-colors"
              style={{ fontSize: "16px" }}
            />
          </div>

          <div className="mb-5 p-3 bg-surface-base border border-stroke rounded-lg text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">System available</span>
              <span className="font-mono font-bold text-ink-primary">{Number(currentAvailable).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-3 mt-1.5">
              <span className="text-ink-muted">{mode === "scan" ? "Scanned target" : "Actual target"}</span>
              <span className="font-mono font-bold text-teal-400">
                {mode === "scan" ? scannedSns.length.toLocaleString() : (Number.isNaN(targetNum) ? "-" : targetNum.toLocaleString())}
              </span>
            </div>
            <div className="mt-2 text-xs text-ink-muted">{helperText}</div>
            {localError && <div className="mt-2 text-xs text-red-400">{localError}</div>}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSubmit}
              disabled={mode === "count" ? !canSubmitManual : !canSubmitScan}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
            >
              <Check size={16} /> Submit
            </button>
            <button
              onClick={onClose}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-surface-raised hover:bg-surface-overlay text-ink-secondary font-semibold text-sm border border-stroke transition-colors min-h-[44px]"
            >
              <X size={16} /> Cancel
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
