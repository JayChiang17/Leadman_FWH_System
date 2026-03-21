import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, X, Check } from "lucide-react";

export default function StageAdvanceBtn({ usSn, currentStage, onAdvance, disabled }) {
  const [open, setOpen] = useState(false);

  const NEXT = {
    assembling:       { label: "Aging", id: "aging" },
    aging:            { label: "FQC Passed", id: "fqc_passed" },
    fqc_passed:       { label: "Pending Shipment", id: "pending_shipment" },
    pending_shipment: null,
  };

  const next = NEXT[currentStage];
  if (!next) return null;

  function handleConfirm() {
    setOpen(false);
    onAdvance(usSn, next.id);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="flex items-center gap-1 px-3 py-2 rounded-lg
                   bg-teal-700 hover:bg-teal-600 active:bg-teal-800
                   text-white text-xs font-bold transition-colors duration-150
                   disabled:opacity-40 disabled:cursor-not-allowed
                   min-h-[44px] touch-manipulation"
      >
        <ArrowRight size={14} />
        → {next.label}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-80 shadow-lg"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 340, damping: 28 }}
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-white font-bold text-base mb-1">Confirm Stage Advance</h3>
              <p className="text-ink-muted text-sm mb-4">
                <span className="font-mono text-ink-muted">{usSn}</span>
                <br />
                From <span className="text-amber-400">{currentStage}</span>
                {" → "}
                <span className="text-teal-400">{next.label}</span>
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleConfirm}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg
                             bg-teal-600 hover:bg-teal-500 text-white font-bold text-sm
                             transition-colors duration-150 min-h-[44px]"
                >
                  <Check size={16} />
                  Confirm
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg
                             bg-gray-800 hover:bg-gray-700 text-ink-muted font-semibold text-sm
                             border border-gray-600 transition-colors duration-150 min-h-[44px]"
                >
                  <X size={16} />
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
