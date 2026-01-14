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
    ? "bg-gradient-to-br from-rose-50 to-rose-100/50 border-rose-300 hover:border-rose-400 shadow-md shadow-rose-500/10"
    : "bg-white border-gray-200 hover:border-indigo-400 hover:shadow-xl";

  return (
    <div className="relative group">
      <div
        onClick={onViewDetails}
        className={`${ngClasses} rounded-xl p-5 border-2 transition-all duration-300 cursor-pointer hover:scale-[1.01] ${
          isBlink ? "animate-pulse ring-4 ring-indigo-400 ring-opacity-50 scale-105" : ""
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
                    ng ? "text-rose-800" : "text-gray-900"
                  }`}
                >
                  {board.serialNumber}
                </h4>

                {/* badges */}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      board.model === "AU8"
                        ? "bg-indigo-100 text-indigo-700"
                        : "bg-cyan-100 text-cyan-700"
                    }`}
                  >
                    {board.model}
                  </span>

                  {/* Version Badge - V2 显示为新版本高亮 */}
                  {board.version === "V2" ? (
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/30 animate-pulse">
                      ✨ V2 NEW
                    </span>
                  ) : board.version === "V1" ? (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-gray-200 text-gray-700">
                      V1
                    </span>
                  ) : null}

                  {board.slipNumber ? (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gradient-to-r from-amber-100 to-amber-50 text-amber-800 border border-amber-300 break-all">
                      📋 {board.slipNumber}
                    </span>
                  ) : null}

                  {ng ? (
                    <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-lg animate-pulse">
                      ⚠️ NG
                    </span>
                  ) : null}

                  {board.ngReason ? (
                    <span className="px-2 py-0.5 rounded-md text-xs bg-rose-100 text-rose-700 truncate max-w-[160px]">
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
                  ng ? "text-rose-700" : "text-gray-500"
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
                  ng ? "text-rose-400" : "text-gray-400"
                } group-hover:text-indigo-600 transition-colors`}
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
              : "bg-rose-100 hover:bg-rose-200 text-rose-700"
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
              className="p-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 transition"
              title="Edit"
            >
              <Edit size={12} />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(board);
              }}
              className="p-1.5 rounded bg-red-500 text-white hover:bg-red-600 transition"
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
