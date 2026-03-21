// src/features/userPerm/UserPerm.js — 2026 redesign (no gradients)
// Bento metrics · Role-aware Edit Modal · Add panel always visible · Flat solid colors
import { useEffect, useState, useCallback, useContext, useRef } from "react";
import {
  Users,
  UserPlus,
  Edit3,
  Trash2,
  Shield,
  Eye,
  EyeOff,
  UserCheck,
  AlertCircle,
  Save,
  Lock,
  X,
  CheckCircle,
  ChevronDown,
} from "lucide-react";
import api from "../../services/api";
import useMessageTimer from "../../utils/useMessageTimer";
import { AuthCtx } from "../../auth/AuthContext";

// ── Page access config ────────────────────────────────────────────────────────
const ALL_PAGES = [
  // Production section
  { key: "dashboard",           label: "Dashboard",           section: "Production" },
  { key: "production-charts",   label: "Production Charts",   section: "Production" },
  { key: "ng-dashboard",        label: "NG Dashboard",        section: "Production" },
  { key: "pcba-tracking",       label: "PCBA Tracking",       section: "Production" },
  { key: "module_production",   label: "Module Production",   section: "Production" },
  { key: "assembly_production", label: "Assembly Production", section: "Production" },
  { key: "downtime",            label: "Downtime",            section: "Production" },
  { key: "wip-tracking",        label: "WIP Tracking",        section: "Production" },
  { key: "ng-analysis",         label: "ATE NG Analysis",     section: "Production" },
  // Tools section
  { key: "search",              label: "Data Search",         section: "Tools" },
  { key: "qc-check",            label: "Quality Control",     section: "Tools" },
  { key: "ate-testing",         label: "ATE Testing",         section: "Tools" },
  { key: "ai-query",            label: "AI Query",            section: "Tools" },
];
const PAGE_SECTIONS = ["Production", "Tools"];

// ── Role config (flat solid colors only) ─────────────────────────────────────
const ROLE_MAP = {
  admin: {
    bg: "bg-teal-500/10",    text: "text-teal-400",    border: "border-teal-500/30",
    solidBg: "bg-teal-600",   solidText: "text-white",
    headerBg: "bg-teal-700",
    Icon: Shield,
    detail: "All features + user management",
  },
  operator: {
    bg: "bg-signal-info/10",    text: "text-cyan-400",    border: "border-cyan-500/30",
    solidBg: "bg-cyan-600",   solidText: "text-white",
    headerBg: "bg-cyan-700",
    Icon: UserCheck,
    detail: "Scan, edit production records",
  },
  qc: {
    bg: "bg-signal-ok/10", text: "text-emerald-400", border: "border-emerald-500/30",
    solidBg: "bg-emerald-600", solidText: "text-white",
    headerBg: "bg-emerald-700",
    Icon: Eye,
    detail: "QC checks, issue reporting",
  },
  viewer: {
    bg: "bg-surface-raised",  text: "text-ink-secondary",   border: "border-stroke",
    solidBg: "bg-surface-base0",  solidText: "text-white",
    headerBg: "bg-stone-600",
    Icon: Users,
    detail: "View dashboards and reports",
  },
};

// ── Metric card config (flat solid accent bars) ───────────────────────────────
const METRIC_CFG = [
  { key: "total",    label: "Total Users",  Icon: Users,
    accentBg: "bg-teal-500",   iconBg: "bg-teal-500/10",   iconColor: "text-teal-400",  numColor: "text-teal-400"  },
  { key: "admin",    label: "Admin",        Icon: Shield,
    accentBg: "bg-signal-info",   iconBg: "bg-signal-info/10",   iconColor: "text-cyan-400",  numColor: "text-cyan-400"  },
  { key: "operator", label: "Operator",     Icon: UserCheck,
    accentBg: "bg-signal-warn",  iconBg: "bg-signal-warn/10",  iconColor: "text-amber-400", numColor: "text-amber-400" },
  { key: "other",    label: "QC + Viewer",  Icon: Eye,
    accentBg: "bg-stone-400",  iconBg: "bg-surface-raised", iconColor: "text-ink-muted", numColor: "text-ink-secondary" },
];


// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditUserModal({ user, isSelf, onClose, onSave, onDelete }) {
  const [username, setUsername] = useState(user.username);
  const [password, setPassword] = useState("");
  const [role,     setRole]     = useState(user.role);
  const [showPw,   setShowPw]   = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const firstRef = useRef(null);

  // Page access: null = unrestricted, [] = restrict all, [...] = specific pages
  const origPages = user.allowed_pages ?? null;
  const [pageMode, setPageMode] = useState(origPages !== null ? "restricted" : "all");
  const [selectedPages, setSelectedPages] = useState(origPages || []);

  const togglePageMode = (mode) => {
    setPageMode(mode);
    if (mode === "all") setSelectedPages([]);
  };

  const togglePage = (key) => {
    setSelectedPages(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const selectSection = (section, checked) => {
    const keys = ALL_PAGES.filter(p => p.section === section).map(p => p.key);
    setSelectedPages(prev =>
      checked
        ? [...new Set([...prev, ...keys])]
        : prev.filter(k => !keys.includes(k))
    )
  };

  useEffect(() => { setTimeout(() => firstRef.current?.focus(), 80); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const origRc = ROLE_MAP[user.role] || ROLE_MAP.viewer;
  const rc     = ROLE_MAP[role]      || ROLE_MAP.viewer;
  const RIcon  = rc.Icon;

  const handleSave = async () => {
    const uname = username.trim();
    if (!uname) { setError("Username is required"); return; }
    setBusy(true); setError("");
    // Build allowed_pages value: null = unrestricted, array = restricted set
    const allowedPagesPayload = pageMode === "all" ? null : selectedPages;
    try {
      await onSave(user.id, {
        username: uname,
        role,
        ...(password.trim() ? { password: password.trim() } : {}),
        allowed_pages: allowedPagesPayload,
      });
    } catch (err) {
      setError(err.message || "Failed to save");
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try { await onDelete(user); }
    catch { setBusy(false); }
  };

  const origPageMode = origPages !== null ? "restricted" : "all";
  const origPagesStr = JSON.stringify([...(origPages || [])].sort());
  const currPagesStr = JSON.stringify([...selectedPages].sort());
  const pagesChanged = pageMode !== origPageMode || (pageMode === "restricted" && origPagesStr !== currPagesStr);

  const hasChanges =
    username.trim() !== user.username ||
    role !== user.role ||
    password.trim().length > 0 ||
    pagesChanged;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* modal card */}
      <div className="relative w-full max-w-lg bg-surface-panel rounded-xl shadow-lg overflow-hidden max-h-[90vh] flex flex-col">

        {/* ── Role-aware solid header ── */}
        <div className={`${origRc.headerBg} px-6 pt-6 pb-8 flex-shrink-0`}>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg bg-surface-panel/20 hover:bg-surface-panel/30 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-4">
            {/* avatar */}
            <div className="w-14 h-14 rounded-xl bg-surface-panel/20 border-2 border-white/40 flex items-center justify-center text-white font-bold text-2xl flex-shrink-0">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-0.5">
                Editing user
              </p>
              <h2 className="text-white text-xl font-bold tracking-tight">
                {user.username}
              </h2>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-panel/20 text-white/90 text-xs font-semibold">
                  <origRc.Icon className="w-3 h-3" />
                  {user.role}
                </span>
                <span className="text-white/50 text-xs">ID #{user.id}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Form body ── */}
        <div className="-mt-4 mx-4 bg-surface-panel rounded-xl border border-stroke shadow-sm p-5 space-y-4 mb-1 overflow-y-auto flex-1">
          {error && (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-signal-error/10 border border-red-500/30 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-xs text-red-400">{error}</span>
            </div>
          )}

          {/* Username */}
          <div>
            <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
              Username
            </label>
            <input
              ref={firstRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-surface-panel text-ink-primary border-2 border-stroke rounded-lg focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-150 text-sm"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
              New Password
              <span className="text-stone-300 font-normal ml-1 normal-case tracking-normal">
                · leave blank to keep
              </span>
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <Lock className="w-4 h-4 text-stone-300" />
              </div>
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password (optional)"
                className="w-full pl-10 pr-10 py-2.5 bg-surface-panel text-ink-primary border-2 border-stroke rounded-lg focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-150 text-sm placeholder:text-stone-300"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-ink-secondary transition-colors"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
              Role
            </label>
            <div className="relative">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full appearance-none px-3.5 py-2.5 bg-surface-panel text-ink-primary border-2 border-stroke rounded-lg focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-150 text-sm pr-9"
              >
                <option value="viewer">Viewer — Read only</option>
                <option value="qc">QC — Quality control</option>
                <option value="operator">Operator — Production</option>
                <option value="admin">Admin — Full access</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
            </div>

            {/* Live role preview */}
            <div className={`mt-2 flex items-center gap-2.5 px-3 py-2 rounded-lg border ${rc.border} ${rc.bg}`}>
              <div className={`w-6 h-6 rounded-md ${rc.solidBg} flex items-center justify-center flex-shrink-0`}>
                <RIcon className="w-3 h-3 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <span className={`text-xs font-bold ${rc.text} capitalize`}>{role}</span>
                <span className="text-[10px] text-stone-400 ml-2">{rc.detail}</span>
              </div>
              {role !== user.role && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-signal-warn/15 text-amber-400 flex-shrink-0">
                  changed
                </span>
              )}
            </div>
          </div>

          {/* ── Page Access (hidden for admin role) ── */}
          {role !== "admin" && (
            <div>
              <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-2">
                Page Access
              </label>

              {/* Mode toggle */}
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => togglePageMode("all")}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors duration-150 ${
                    pageMode === "all"
                      ? "bg-teal-600 text-white border-teal-600"
                      : "bg-surface-panel text-ink-muted border-stroke hover:border-teal-400"
                  }`}
                >
                  All Pages
                </button>
                <button
                  type="button"
                  onClick={() => togglePageMode("restricted")}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors duration-150 ${
                    pageMode === "restricted"
                      ? "bg-signal-warn text-white border-amber-500"
                      : "bg-surface-panel text-ink-muted border-stroke hover:border-amber-400"
                  }`}
                >
                  Restricted
                </button>
              </div>

              {pageMode === "all" ? (
                <p className="text-[11px] text-stone-400 px-1">
                  User can access all pages (no restriction).
                </p>
              ) : (
                <div className="border border-stroke rounded-lg overflow-hidden">
                  {PAGE_SECTIONS.map((section) => {
                    const sectionPages = ALL_PAGES.filter(p => p.section === section);
                    const allChecked = sectionPages.every(p => selectedPages.includes(p.key));
                    const someChecked = sectionPages.some(p => selectedPages.includes(p.key));
                    return (
                      <div key={section}>
                        {/* Section header with select-all */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-surface-base border-b border-stroke-subtle">
                          <input
                            type="checkbox"
                            checked={allChecked}
                            ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                            onChange={e => selectSection(section, e.target.checked)}
                            className="w-3.5 h-3.5 rounded accent-teal-600 cursor-pointer"
                          />
                          <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">
                            {section}
                          </span>
                          <span className="ml-auto text-[10px] text-stone-400">
                            {sectionPages.filter(p => selectedPages.includes(p.key)).length}/{sectionPages.length}
                          </span>
                        </div>
                        {/* Page checkboxes */}
                        <div className="grid grid-cols-2 gap-0 divide-y divide-stone-50">
                          {sectionPages.map((page) => {
                            const checked = selectedPages.includes(page.key);
                            return (
                              <label
                                key={page.key}
                                className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors duration-100 ${
                                  checked ? "bg-teal-500/10" : "hover:bg-surface-base"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => togglePage(page.key)}
                                  className="w-3.5 h-3.5 rounded accent-teal-600 cursor-pointer flex-shrink-0"
                                />
                                <span className={`text-xs font-medium truncate ${checked ? "text-teal-400" : "text-ink-muted"}`}>
                                  {page.label}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {selectedPages.length === 0 && (
                    <p className="px-3 py-2 text-[11px] text-amber-400 bg-signal-warn/10 border-t border-signal-warn/20">
                      No pages selected — user will see nothing after login.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-4 py-4 flex items-center gap-2 border-t border-stroke-subtle flex-shrink-0">
          {/* Delete */}
          {!isSelf && (
            confirmDelete ? (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-red-400 font-semibold">Sure?</span>
                <button
                  onClick={handleDelete}
                  disabled={busy}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  Yes, delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 bg-surface-raised hover:bg-surface-overlay text-ink-secondary text-xs font-semibold rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-2 text-stone-400 hover:text-red-400 hover:bg-signal-error/10 rounded-lg transition-colors"
                title="Delete user"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 text-ink-secondary font-semibold text-sm bg-surface-raised hover:bg-surface-overlay rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={busy || !hasChanges}
              className="px-5 py-2 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-bold text-sm rounded-lg shadow-sm active:scale-95 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {busy ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Main Component ────────────────────────────────────────────────────────────
export default function UserPerm() {
  const empty = { id: null, username: "", password: "", role: "viewer" };
  const { name: currentUserName } = useContext(AuthCtx);

  const [users,      setUsers]      = useState([]);
  const [addForm,    setAddForm]    = useState(empty);
  const [editTarget, setEditTarget] = useState(null);
  const [error,      setError]      = useState("");
  const [successMsg, showSuccess]   = useMessageTimer(3000);
  const [busy,       setBusy]       = useState(false);
  const [showPw,     setShowPw]     = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("users/");
      setUsers(data);
    } catch {
      setError("Failed to load users");
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const add = async () => {
    setError("");
    const uname = addForm.username.trim();
    const pw    = addForm.password.trim();
    if (!uname) { setError("Username is required"); return; }
    if (!pw)    { setError("Password is required");  return; }
    try {
      setBusy(true);
      await api.post("users/", { username: uname, role: addForm.role, password: pw });
      showSuccess(`User "${uname}" created!`, "success");
      setAddForm(empty);
      refresh();
    } catch (err) {
      setError(err.response?.data?.detail || err.response?.data?.message || "Failed to create user");
    } finally { setBusy(false); }
  };

  const handleEditSave = async (id, payload) => {
    await api.put(`users/${id}`, payload);
    showSuccess("User updated!", "success");
    setEditTarget(null);
    refresh();
  };

  const handleDelete = async (u) => {
    await api.delete(`users/${u.id}`);
    showSuccess(`User "${u.username}" deleted.`, "success");
    setEditTarget(null);
    refresh();
  };

  const countByRole  = (r) => users.filter(u => u.role === r).length;
  const metricValues = {
    total:    users.length,
    admin:    countByRole("admin"),
    operator: countByRole("operator"),
    other:    countByRole("qc") + countByRole("viewer"),
  };

  const selRc   = ROLE_MAP[addForm.role] || ROLE_MAP.viewer;
  const SelIcon = selRc.Icon;

  return (
    <div className="min-h-screen bg-surface-base" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

        {/* ── Page Header ─────────────────────────────────────────────────── */}
        <div className="rounded-xl bg-surface-panel border border-stroke shadow-sm overflow-hidden">
          <div className="h-1 bg-teal-600" />
          <div className="px-6 py-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-teal-600 flex items-center justify-center shadow-sm flex-shrink-0">
                <Users className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-ink-primary tracking-tight">User Management</h1>
                <p className="text-sm text-ink-muted mt-0.5">Manage system accounts, roles and access permissions</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 px-3 py-1.5 rounded-lg bg-surface-raised border border-stroke">
              <span className="w-2 h-2 rounded-full bg-signal-ok animate-pulse" />
              <span className="text-xs font-semibold text-ink-secondary tabular-nums">
                {users.length} user{users.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        {/* ── Bento Metric Cards ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {METRIC_CFG.map((m) => {
            const MIcon = m.Icon;
            const val   = metricValues[m.key];
            const pct   = users.length > 0 && m.key !== "total"
              ? Math.round((val / users.length) * 100) : 0;
            return (
              <div key={m.key} className="rounded-xl bg-surface-panel border border-stroke shadow-sm overflow-hidden">
                <div className={`h-0.5 ${m.accentBg}`} />
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">{m.label}</p>
                    <div className={`w-7 h-7 rounded-lg ${m.iconBg} flex items-center justify-center flex-shrink-0`}>
                      <MIcon className={`w-3.5 h-3.5 ${m.iconColor}`} />
                    </div>
                  </div>
                  <p className={`text-3xl font-bold tabular-nums tracking-tight ${m.numColor}`}>{val}</p>
                  {m.key !== "total" && users.length > 0 && (
                    <div className="mt-3 h-1 rounded-full bg-surface-raised overflow-hidden">
                      <div
                        className={`h-full rounded-full ${m.accentBg} transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Alerts ──────────────────────────────────────────────────────── */}
        {error && (
          <div className="p-4 bg-signal-error/10 border border-red-500/30 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <span className="text-sm text-red-300 flex-1">{error}</span>
            <button onClick={() => setError("")} className="p-1 text-red-400 hover:text-red-400 hover:bg-signal-error/15 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {successMsg.text && (
          <div className="p-4 bg-signal-ok/10 border border-emerald-500/30 rounded-xl flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <span className="text-sm text-emerald-300">{successMsg.text}</span>
          </div>
        )}

        {/* ── Main Grid ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* ── Users table ── */}
          <div className="xl:col-span-2">
            <div className="rounded-xl bg-surface-panel border border-stroke shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-stroke-subtle flex items-center gap-3">
                <h2 className="text-sm font-semibold text-ink-secondary uppercase tracking-wider flex-1">
                  Current Users
                </h2>
                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-surface-raised text-ink-muted tabular-nums">
                  {users.length}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-base/80">
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wider">User</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wider">Role</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wider hidden md:table-cell">Status</th>
                      <th className="px-5 py-3 text-center text-[11px] font-semibold text-stone-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {users.map((u) => {
                      const rc       = ROLE_MAP[u.role] || ROLE_MAP.viewer;
                      const RIcon    = rc.Icon;
                      const isSelf   = u.username === currentUserName;
                      const isEditing = editTarget?.id === u.id;

                      return (
                        <tr
                          key={u.id}
                          className={`transition-colors duration-150 ${
                            isEditing  ? "bg-teal-500/10 ring-1 ring-inset ring-teal-200"
                            : isSelf   ? "bg-teal-500/10"
                            : "hover:bg-surface-base/70"
                          }`}
                        >
                          {/* User */}
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm text-white flex-shrink-0 ${rc.solidBg}`}>
                                {u.username.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="text-sm font-semibold text-ink-primary">{u.username}</p>
                                  {isSelf && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-teal-500/15 text-teal-400 uppercase tracking-wide leading-none">
                                      You
                                    </span>
                                  )}
                                  {isEditing && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-signal-warn/15 text-amber-400 uppercase tracking-wide leading-none">
                                      Editing
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-stone-400 tabular-nums mt-0.5">ID #{u.id}</p>
                              </div>
                            </div>
                          </td>

                          {/* Role badge */}
                          <td className="px-4 py-3.5">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${rc.bg} ${rc.text} ${rc.border}`}>
                              <RIcon className="w-3 h-3" />
                              {u.role}
                            </span>
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3.5 hidden md:table-cell">
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-signal-ok" />
                              <span className="text-xs font-medium text-ink-muted">Active</span>
                            </div>
                          </td>

                          {/* Edit button */}
                          <td className="px-5 py-3.5">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => setEditTarget(u)}
                                title="Edit user"
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors duration-150 ${
                                  isEditing
                                    ? "bg-teal-500/15 text-teal-400 border-teal-500/30"
                                    : "text-ink-muted border-stroke hover:text-teal-400 hover:bg-teal-500/10 hover:border-teal-500/30"
                                }`}
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Edit</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {users.length === 0 && (
                  <div className="py-16 text-center">
                    <div className="w-14 h-14 rounded-xl bg-surface-raised flex items-center justify-center mx-auto mb-4">
                      <Users className="w-7 h-7 text-stone-300" />
                    </div>
                    <p className="text-sm font-semibold text-stone-400">No users yet</p>
                    <p className="text-xs text-stone-300 mt-1">Create your first user using the form →</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Add form + legend ── */}
          <div className="xl:col-span-1 space-y-4">

            <div className="rounded-xl bg-surface-panel shadow-sm border border-stroke overflow-hidden border-l-4 border-l-teal-500">
              <div className="px-5 py-4 border-b border-stroke-subtle flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
                  <UserPlus className="w-4 h-4 text-teal-400" />
                </div>
                <h2 className="text-sm font-semibold text-ink-secondary uppercase tracking-wider">
                  Add New User
                </h2>
              </div>

              <div className="p-5">
                <form onSubmit={(e) => { e.preventDefault(); add(); }} className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
                      Username
                    </label>
                    <input
                      type="text"
                      value={addForm.username}
                      onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                      placeholder="e.g. john_doe"
                      className="w-full px-3.5 py-2.5 bg-surface-panel text-ink-primary border-2 border-stroke rounded-lg focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-150 text-sm placeholder:text-stone-300"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
                      Password
                    </label>
                    <div className="relative">
                      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                        <Lock className="w-4 h-4 text-stone-300" />
                      </div>
                      <input
                        type={showPw ? "text" : "password"}
                        value={addForm.password}
                        onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                        placeholder="Enter password"
                        className="w-full pl-10 pr-10 py-2.5 bg-surface-panel text-ink-primary border-2 border-stroke rounded-lg focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-150 text-sm placeholder:text-stone-300"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(!showPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-ink-secondary transition-colors"
                      >
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
                      Role
                    </label>
                    <div className="relative">
                      <select
                        value={addForm.role}
                        onChange={(e) => setAddForm({ ...addForm, role: e.target.value })}
                        className="w-full appearance-none px-3.5 py-2.5 bg-surface-panel text-ink-primary border-2 border-stroke rounded-lg focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-150 text-sm pr-9"
                      >
                        <option value="viewer">Viewer — Read only</option>
                        <option value="qc">QC — Quality control</option>
                        <option value="operator">Operator — Production</option>
                        <option value="admin">Admin — Full access</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* Role preview */}
                  <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border ${selRc.border} ${selRc.bg}`}>
                    <div className={`w-6 h-6 rounded-md ${selRc.solidBg} flex items-center justify-center flex-shrink-0`}>
                      <SelIcon className="w-3 h-3 text-white" />
                    </div>
                    <div>
                      <p className={`text-xs font-bold ${selRc.text} capitalize`}>{addForm.role}</p>
                      <p className="text-[10px] text-stone-400">{selRc.detail}</p>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full px-5 py-3 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-bold text-sm rounded-lg shadow-sm active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busy ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Creating…
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <UserPlus className="w-4 h-4" />
                        Create User
                      </span>
                    )}
                  </button>
                </form>
              </div>
            </div>

            {/* Role legend */}
            <div className="rounded-xl bg-surface-panel border border-stroke shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-stroke-subtle">
                <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">
                  Role Permissions
                </h3>
              </div>
              <div className="p-4 space-y-2">
                {(["admin", "operator", "qc", "viewer"]).map((role) => {
                  const rc    = ROLE_MAP[role];
                  const RIcon = rc.Icon;
                  return (
                    <div key={role} className={`flex items-start gap-3 p-2.5 rounded-lg border ${rc.border} ${rc.bg}`}>
                      <div className={`w-7 h-7 rounded-lg ${rc.solidBg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <RIcon className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div>
                        <p className={`text-xs font-bold ${rc.text} capitalize`}>{role}</p>
                        <p className="text-[10px] text-ink-muted mt-0.5 leading-relaxed">{rc.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Edit Modal ── */}
      {editTarget && (
        <EditUserModal
          user={editTarget}
          isSelf={editTarget.username === currentUserName}
          onClose={() => setEditTarget(null)}
          onSave={handleEditSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
