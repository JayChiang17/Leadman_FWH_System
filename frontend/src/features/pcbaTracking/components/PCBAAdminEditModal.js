import React, { useState } from "react";
import { labelOf } from "../PCBAConstants";

export default function PCBAAdminEditModal({ board, onClose, onSave }) {
  const [formData, setFormData] = useState({
    newSerialNumber: board.serialNumber,
    batchNumber: board.batchNumber,
    model: board.model,
    stage: board.stage,
    operator: board.operator || "User",
    note: "",
    slipNumber: board.slipNumber || "",
    targetPairs: undefined,
  });
  const handleSubmit = () => onSave(board.serialNumber, formData);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-panel rounded-xl shadow-lg max-w-md w-full">
        <div className="bg-gradient-to-r from-blue-600 to-teal-600 p-6 text-white rounded-t-2xl">
          <h3 className="text-xl font-bold">Edit Board</h3>
          <p className="text-blue-100 text-sm mt-1">Modify board details</p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1">Serial Number</label>
            <input value={formData.newSerialNumber} onChange={(e) => setFormData({ ...formData, newSerialNumber: e.target.value })}
              className="w-full px-3 py-2 border border-stroke rounded-lg focus:ring-2 focus:ring-signal-info focus:border-signal-info text-ink-primary placeholder-ink-muted" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Model</label>
              <select value={formData.model} onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                className="w-full px-3 py-2 border border-stroke rounded-lg focus:ring-2 focus:ring-signal-info text-ink-primary">
                <option value="AM7">AM7</option><option value="AU8">AU8</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Stage</label>
              <select value={formData.stage} onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                className="w-full px-3 py-2 border border-stroke rounded-lg focus:ring-2 focus:ring-signal-info text-ink-primary">
                {["aging","coating","completed"].map((k)=> <option key={k} value={k}>{labelOf(k)}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Slip Number</label>
              <input value={formData.slipNumber || ""} onChange={(e) => setFormData({ ...formData, slipNumber: e.target.value })}
                className="w-full px-3 py-2 border border-stroke rounded-lg focus:ring-2 focus:ring-signal-info focus:border-signal-info text-ink-primary placeholder-ink-muted" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Target Pairs</label>
              <input type="number" min={0} value={formData.targetPairs ?? ""} onChange={(e) => setFormData({ ...formData, targetPairs: e.target.value === "" ? undefined : Math.max(0, parseInt(e.target.value || 0, 10)) })}
                className="w-full px-3 py-2 border border-stroke rounded-lg focus:ring-2 focus:ring-signal-info focus:border-signal-info text-ink-primary placeholder-ink-muted" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1">Batch Number</label>
            <input value={formData.batchNumber} onChange={(e) => setFormData({ ...formData, batchNumber: e.target.value })}
              className="w-full px-3 py-2 border border-stroke rounded-lg focus:ring-2 focus:ring-signal-info focus:border-signal-info text-ink-primary placeholder-ink-muted" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1">Note</label>
            <textarea value={formData.note} onChange={(e) => setFormData({ ...formData, note: e.target.value })} rows={2}
              className="w-full px-3 py-2 border border-stroke rounded-lg focus:ring-2 focus:ring-signal-info focus:border-signal-info text-ink-primary placeholder-ink-muted" placeholder="Optional note..." />
          </div>
        </div>
        <div className="p-6 border-t border-stroke flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-ink-secondary hover:text-ink-primary transition">Cancel</button>
          <button onClick={handleSubmit} className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition">Save Changes</button>
        </div>
      </div>
    </div>
  );
}
