// src/features/pcbaTracking/components/PCBAModernBoardCard.js
import React from "react";
import { Package, Clock, ChevronRight, Edit, Trash2 } from "lucide-react";
import { classStage, labelOf } from "../PCBAConstants";
import { fmtElapsed } from "../PCBAUtils";

const PCBAModernBoardCard = React.memo(function PCBAModernBoardCard({
  board,
  onViewDetails,
  isBlink,
  isEditor,
  onEdit,
  onDelete,
  onToggleNG,
}) {
  const stage = classStage.find((s) => s.key === board.stage);
  const Icon = stage?.icon || Package;
  const ng = !!board.ngFlag;

  // NG 狀態：紅底紅框；非 NG：白底灰框（滑過藍框）
  const ngClasses = ng
    ? "bg-gradient-to-br from-signal-error/10 to-signal-error/15/50 border-rose-300 hover:border-rose-400 shadow-md shadow-rose-500/10"
    : "bg-surface-panel border-stroke hover:border-signal-info hover:shadow-xl";

  return (
    <div className="relative group">
      <div
        onClick={onViewDetails}
        className={`${ngClasses} rounded-xl p-5 border-2 transition-all duration-300 cursor-pointer hover:scale-[1.01] ${
          isBlink ? "animate-pulse ring-4 ring-signal-info ring-opacity-50 scale-105" : ""
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-start gap-3">
              <div
                className={`p-2.5 rounded-lg bg-gradient-to-br ${
                  stage?.bgGradient || "from-gray-400 to-gray-500"
                } ${ng ? "grayscale" : ""}`}
              >
                <Icon className="text-white" size={18} />
              </div>
              <div className="min-w-0">
                <h4
                  className={`font-semibold text-sm md:text-base truncate ${
                    ng ? "text-rose-300" : "text-ink-primary"
                  }`}
                >
                  {board.serialNumber}
                </h4>

                {/* badges */}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      board.model === "AU8"
                        ? "bg-signal-info/15 text-signal-info"
                        : "bg-signal-info/15 text-cyan-400"
                    }`}
                  >
                    {board.model}
                  </span>

                  {/* Version Badge - V2 显示为新版本高亮 */}
                  {board.version === "V2" ? (
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-gradient-to-r from-signal-ok/100 to-teal-500/100 text-white shadow-md shadow-emerald-500/30 animate-pulse">
                      ✨ V2 NEW
                    </span>
                  ) : board.version === "V1" ? (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-surface-raised text-ink-secondary">
                      V1
                    </span>
                  ) : null}

                  {board.slipNumber ? (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gradient-to-r from-signal-warn/15 to-signal-warn/10 text-amber-300 border border-amber-300 break-all">
                      📋 {board.slipNumber}
                    </span>
                  ) : null}

                  {ng ? (
                    <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-lg animate-pulse">
                      ⚠️ NG
                    </span>
                  ) : null}

                  {board.ngReason ? (
                    <span className="px-2 py-0.5 rounded-md text-xs bg-signal-error/15 text-rose-400 truncate max-w-[160px]">
                      {board.ngReason}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* footer line */}
            <div className="flex items-center justify-between mt-3">
              <div
                className={`flex items-center gap-4 text-xs ${
                  ng ? "text-rose-400" : "text-ink-muted"
                }`}
              >
                <span className="flex items-center gap-1">
                  <Clock size={13} />
                  {fmtElapsed(
                    board.startTime,
                    board.lastUpdate,
                    board.stage
                  )}
                </span>
                <span>{labelOf(board.stage)}</span>
              </div>
              <ChevronRight
                className={`${
                  ng ? "text-rose-400" : "text-ink-muted"
                } group-hover:text-signal-info transition-colors`}
                size={18}
              />
            </div>
          </div>
        </div>
      </div>

      {/* hover actions */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleNG && onToggleNG(board, !board.ngFlag);
          }}
          className={`p-1.5 rounded ${
            board.ngFlag
              ? "bg-rose-600 hover:bg-rose-700 text-white"
              : "bg-signal-error/15 hover:bg-rose-200 text-rose-400"
          }`}
          title={board.ngFlag ? "Clear NG" : "Mark NG"}
        >
          NG
        </button>

        {isEditor && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(board);
              }}
              className="p-1.5 rounded bg-signal-info text-white hover:bg-blue-600 transition"
              title="Edit"
            >
              <Edit size={12} />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(board);
              }}
              className="p-1.5 rounded bg-signal-error text-white hover:bg-red-600 transition"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
});

export default PCBAModernBoardCard;
