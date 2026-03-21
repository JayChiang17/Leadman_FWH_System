import React from "react";
import { RefreshCw, AlertTriangle, BarChart2, Cpu } from "lucide-react";

function ParetoBar({ pct, color = "bg-signal-error" }) {
  return (
    <div className="w-full bg-surface-raised rounded-sm h-2 overflow-hidden">
      <div
        className={`h-2 rounded-sm transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

function ClusterRow({ cluster, rank }) {
  const [expanded, setExpanded] = React.useState(false);

  const barColor =
    rank === 0 ? "bg-signal-error"
    : rank === 1 ? "bg-signal-warn"
    : rank <= 3 ? "bg-amber-400"
    : "bg-stone-400";

  return (
    <div className="border border-stroke rounded-lg overflow-hidden">
      <button
        className="w-full text-left px-3 py-3 hover:bg-surface-base transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className="shrink-0 w-5 h-5 rounded bg-surface-raised text-[10px] font-bold text-ink-muted flex items-center justify-center">
            {rank + 1}
          </span>
          <span className="flex-1 text-sm text-ink-primary font-medium truncate">
            {cluster.representative}
          </span>
          <span className="shrink-0 text-xs font-mono font-semibold text-ink-secondary">
            {cluster.count}
          </span>
          <span className="shrink-0 text-xs text-stone-400 w-10 text-right">
            {cluster.pct}%
          </span>
        </div>
        <ParetoBar pct={cluster.pct} color={barColor} />
      </button>

      {expanded && cluster.samples?.length > 0 && (
        <div className="border-t border-stroke-subtle px-3 py-2 bg-surface-base space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-stone-400 font-semibold mb-1">
            Sample reasons
          </div>
          {cluster.samples.map((s, i) => (
            <div key={i} className="text-xs text-ink-secondary italic truncate">
              "{s}"
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NGClustersPanel({ clusters, totalNG, loading, error, onRefresh, onRetrain, retraining, retrainMsg }) {
  const header = (
    <div className="flex items-center justify-between mb-2">
      <div className="text-[11px] uppercase tracking-wide text-stone-400 font-semibold">
        {clusters?.length > 0
          ? `${clusters.length} cluster${clusters.length !== 1 ? "s" : ""} · ${totalNG} total NG`
          : "NG Reason Clusters"}
      </div>
      <div className="flex items-center gap-1.5">
        {onRetrain && (
          <button
            onClick={onRetrain}
            disabled={retraining}
            className="flex items-center gap-1 px-2 py-1 rounded border border-red-500/30 bg-signal-error/10 text-red-400 text-xs font-medium hover:bg-signal-error/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Run ML clustering on all existing NG reasons"
          >
            <Cpu size={11} className={retraining ? "animate-pulse" : ""} />
            {retraining ? "Running..." : "Run Clustering"}
          </button>
        )}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-1 rounded text-stone-400 hover:text-ink-secondary hover:bg-surface-raised transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
    </div>
  );

  if (retrainMsg) {
    // Show message below header (non-blocking)
  }

  if (loading && !clusters?.length) {
    return (
      <div>
        {header}
        <div className="flex items-center gap-2 text-sm text-stone-400 py-4 px-1">
          <RefreshCw size={14} className="animate-spin" />
          Loading clusters...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {header}
        <div className="flex items-center gap-2 text-sm text-red-400 bg-signal-error/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      </div>
    );
  }

  if (!clusters || clusters.length === 0) {
    return (
      <div>
        {header}
        {retrainMsg && (
          <div className="text-xs text-teal-400 bg-teal-500/10 border border-teal-500/30 rounded px-3 py-2 mb-2">
            {retrainMsg} — clustering runs in background, results appear in ~10s
          </div>
        )}
        <div className="flex flex-col items-center gap-1 text-stone-400 py-5">
          <BarChart2 size={24} className="text-stone-300" />
          <p className="text-sm">No clusters yet.</p>
          <p className="text-xs text-stone-400">Press "Run Clustering" to analyse existing NG reasons.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {header}
      {retrainMsg && (
        <div className="text-xs text-teal-400 bg-teal-500/10 border border-teal-500/30 rounded px-3 py-2">
          {retrainMsg}
        </div>
      )}
      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {clusters.map((c, i) => (
          <ClusterRow key={c.cluster_id} cluster={c} rank={i} />
        ))}
      </div>
    </div>
  );
}
