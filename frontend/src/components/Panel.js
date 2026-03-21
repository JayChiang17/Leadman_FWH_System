// src/components/Panel.js — Splunk-inspired shared panel components

import React from "react";

/* ── Panel ─────────────────────────────────────────────────────────── */
/**
 * Dark panel card with optional colored left-border accent.
 * accent: 'ok' | 'warn' | 'error' | 'info'
 */
export function Panel({ children, className = "", accent }) {
  const accentClass = accent
    ? `border-l-2 border-l-signal-${accent}`
    : "";
  return (
    <div
      className={`bg-surface-panel border border-stroke rounded-lg
                  ${accentClass} ${className}`}
    >
      {children}
    </div>
  );
}

/* ── PanelHeader ───────────────────────────────────────────────────── */
/**
 * Uppercase section label with optional icon and right-side actions.
 */
export function PanelHeader({ title, actions, icon: Icon }) {
  return (
    <div className="flex items-center justify-between px-4 py-3
                    border-b border-stroke">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={14} className="text-ink-muted" />}
        <span className="text-xs font-semibold uppercase tracking-wider
                         text-ink-secondary">
          {title}
        </span>
      </div>
      {actions && (
        <div className="flex items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/* ── KPITile ───────────────────────────────────────────────────────── */
/**
 * Monospace metric tile with label and optional trend indicator.
 * accent: 'ok' | 'warn' | 'error' | 'info'
 */
export function KPITile({ label, value, unit, trend, accent }) {
  const valueColor = accent ? `text-signal-${accent}` : "text-ink-primary";
  const trendColor =
    trend > 0 ? "text-signal-ok" : trend < 0 ? "text-signal-error" : "text-ink-muted";

  return (
    <div className="bg-surface-panel border border-stroke rounded-lg p-4
                    flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className={`metric-value font-mono tabular-nums text-3xl font-bold ${valueColor}`}>
          {value}
        </span>
        {unit && (
          <span className="text-xs text-ink-secondary font-medium">{unit}</span>
        )}
      </div>
      {trend !== undefined && (
        <span className={`text-xs font-mono ${trendColor}`}>
          {trend > 0 ? "▲" : trend < 0 ? "▼" : "─"} {Math.abs(trend)}%
        </span>
      )}
    </div>
  );
}

/* ── SplunkTab ─────────────────────────────────────────────────────── */
/**
 * Underline-style tab bar matching Splunk's flat tab design.
 */
export function SplunkTab({ tabs, active, onChange }) {
  return (
    <div className="flex items-center gap-0 border-b border-stroke">
      {tabs.map((tab) => {
        const isActive = tab.value === active;
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className={`
              px-4 py-2.5 text-sm font-medium transition-colors duration-150
              border-b-2 -mb-px
              ${isActive
                ? "border-signal-info text-ink-primary"
                : "border-transparent text-ink-secondary hover:text-ink-primary"
              }
            `}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── SplunkBadge ───────────────────────────────────────────────────── */
/**
 * Semantic status badge.
 * status: 'ok' | 'warn' | 'error' | 'info'
 */
const BADGE_STYLES = {
  ok:    "bg-signal-ok/15 text-signal-ok border border-signal-ok/30",
  warn:  "bg-signal-warn/15 text-signal-warn border border-signal-warn/30",
  error: "bg-signal-error/15 text-signal-error border border-signal-error/30",
  info:  "bg-signal-info/15 text-signal-info border border-signal-info/30",
};

export function SplunkBadge({ status, label, className = "" }) {
  const style = BADGE_STYLES[status] || BADGE_STYLES.info;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs
                  font-semibold uppercase tracking-wide ${style} ${className}`}
    >
      {label || status}
    </span>
  );
}
