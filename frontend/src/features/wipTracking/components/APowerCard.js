import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ArrowRight, Check, X, GripVertical } from "lucide-react";
import PCBAChip from "./PCBAChip";

const STAGE_ORDER = ["assembling", "aging", "fqc_passed"];
const STAGE_LABEL = {
  assembling: "Assembling",
  aging: "Aging",
  fqc_passed: "FQC Passed",
  shipped: "Shipped",
};
const NEXT = {
  assembling: "Aging",
  aging: "FQC Passed",
  fqc_passed: null,
  shipped: null,
};

const LEFT_BORDER = {
  assembling: "border-l-cyan-400",
  aging: "border-l-amber-400",
  fqc_passed: "border-l-emerald-400",
  shipped: "border-l-sky-400",
};

function timeAgo(iso) {
  if (!iso) return null;
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ago`;
    if (h > 0) return `${h}h ago`;
    const m = Math.floor(diff / 60000);
    return m > 0 ? `${m}m ago` : "just now";
  } catch {
    return null;
  }
}

function formatTime(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function InfoRow({ label, value, mono = false, tone = "text-ink-secondary" }) {
  if (!value || value === "-") return null;
  return (
    <div className="rounded-md bg-surface-base px-3 py-2 border border-stroke-subtle">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-1">{label}</div>
      <div className={`text-xs break-all ${mono ? "font-mono" : ""} ${tone}`}>{value}</div>
    </div>
  );
}

export default function APowerCard({ card, index, stageId, onAdvance, onMove, onDragStageChange }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const nextLabel = NEXT[stageId];
  const borderClass = LEFT_BORDER[stageId] || "border-l-gray-300";
  const ago = timeAgo(card.scanned_at || card.shipped_at || card.fqc_ready_at);
  const assyStatus = (card.assy_status || "").toUpperCase() || "OK";
  const movable = stageId !== "shipped";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2, ease: "easeOut", delay: Math.min(index * 0.03, 0.3) }}
      className={`bg-surface-panel border border-stroke border-l-4 ${borderClass} rounded-lg shadow-sm`}
      draggable={movable}
      onDragStart={(e) => {
        if (!movable) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.us_sn);
        onDragStageChange(stageId);
      }}
      onDragEnd={() => onDragStageChange(null)}
    >
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={`text-stone-300 ${movable ? "cursor-grab active:cursor-grabbing" : "opacity-40"}`}>
          <GripVertical size={14} />
        </span>

        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="shrink-0 text-stone-300"
        >
          <ChevronRight size={13} />
        </motion.div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono font-semibold text-ink-primary text-sm truncate">
              {card.us_sn}
            </span>
            {card.risk_score > 0.4 && (
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-signal-error/15 text-red-400 border border-red-500/30">
                High Risk
              </span>
            )}
            {card.risk_score > 0.15 && card.risk_score <= 0.4 && (
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-signal-warn/15 text-amber-400 border border-amber-500/30">
                Med Risk
              </span>
            )}
          </div>
          {card.product_line && (
            <span className="text-xs text-stone-400 uppercase tracking-wide">
              {card.product_line}
            </span>
          )}
        </div>

        {ago && <span className="shrink-0 text-xs text-stone-400">{ago}</span>}

        {!confirming && nextLabel && movable && (
          <button
            onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md bg-surface-raised hover:bg-teal-500/10 border border-stroke hover:border-teal-300 text-xs text-ink-muted hover:text-teal-400 transition-colors min-h-[28px]"
          >
            <ArrowRight size={11} />
          </button>
        )}

        {confirming && movable && (
          <div className="shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <motion.button
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.12 }}
              onClick={(e) => { e.stopPropagation(); setConfirming(false); onAdvance(card.us_sn); }}
              className="flex items-center gap-0.5 px-2 py-1 rounded-md bg-teal-600 text-white text-xs font-semibold min-h-[28px]"
            >
              <Check size={11} /> OK
            </motion.button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirming(false); }}
              className="px-1.5 py-1 rounded-md text-stone-400 hover:text-ink-secondary min-h-[28px]"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {stageId === "shipped" && (
          <span className="shrink-0 text-xs text-sky-400 font-semibold">Shipped</span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            <div className="border-t border-stroke-subtle px-3 py-3 space-y-3">
              {movable && (
                <div className="rounded-lg border border-stroke bg-surface-base px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-2">Move To Stage</div>
                  <div className="grid grid-cols-2 gap-2">
                    {STAGE_ORDER.map((targetStage) => {
                      const active = targetStage === stageId;
                      return (
                        <button
                          key={targetStage}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!active && onMove) onMove(card.us_sn, targetStage);
                          }}
                          disabled={active}
                          className={`rounded-md border px-2.5 py-2 text-xs font-semibold transition-colors ${
                            active
                              ? "bg-teal-600 border-teal-600 text-white cursor-default"
                              : "bg-surface-panel border-stroke text-ink-secondary hover:border-teal-300 hover:text-teal-400"
                          }`}
                        >
                          {STAGE_LABEL[targetStage]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <InfoRow label="Current Stage" value={STAGE_LABEL[stageId]} />
                <InfoRow label="US SN" value={card.us_sn} mono />
                <InfoRow label="China SN" value={card.cn_sn} mono />
                <InfoRow label="Module A" value={card.mod_a} mono />
                <InfoRow label="Module B" value={card.mod_b} mono />
                <InfoRow label="Product Line" value={card.product_line} />
                <InfoRow label="Assembly Status" value={assyStatus} tone={assyStatus === "NG" ? "text-red-400" : "text-ink-secondary"} />
                <InfoRow label="NG Reason" value={card.ng_reason} tone="text-red-400" />
                <InfoRow label="Scanned At" value={formatTime(card.scanned_at)} />
                <InfoRow label="FQC Ready At" value={formatTime(card.fqc_ready_at)} />
                <InfoRow label="Shipped At" value={formatTime(card.shipped_at)} />
                <InfoRow label="Stage Updated" value={formatTime(card.stage_updated_at)} />
                <InfoRow label="Moved By" value={card.stage_updated_by} />
              </div>

              <div className="grid grid-cols-1 gap-2">
                {[
                  { role: "AM7", serial: card.am7, stage: card.am7_pcba_stage, ng: card.am7_ng },
                  { role: "AU8", serial: card.au8, stage: card.au8_pcba_stage, ng: card.au8_ng },
                ].map(({ role, serial, stage, ng }, i) => (
                  <motion.div
                    key={role}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.16 }}
                  >
                    <PCBAChip role={role} serial={serial} pcbaStage={stage} ngFlag={ng} />
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
