// src/features/userPerm/UserPerm.js
import { useEffect, useState, useCallback } from "react";
import {
  Users,
  UserPlus,
  Edit3,
  Trash2,
  Shield,
  Eye,
  UserCheck,
  AlertCircle,
  Save,
} from "lucide-react";
import api from "../../services/api";
import useMessageTimer from "../../utils/useMessageTimer";

const CARD = "bg-white border border-slate-200/80 rounded-xl shadow-sm";

const ROLE_MAP = {
  admin:    { bg: "bg-teal-50",    text: "text-teal-700",    border: "border-teal-200",   dot: "bg-teal-500",    ring: "ring-teal-500/20",  Icon: Shield },
  operator: { bg: "bg-cyan-50",    text: "text-cyan-700",    border: "border-cyan-200",   dot: "bg-cyan-500",    ring: "ring-cyan-500/20",  Icon: UserCheck },
  qc:       { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500", ring: "ring-emerald-500/20", Icon: Eye },
  viewer:   { bg: "bg-slate-100",  text: "text-slate-600",   border: "border-slate-200",  dot: "bg-slate-400",   ring: "ring-slate-400/20", Icon: Users },
};

const METRIC_CFG = [
  { key: "total",    label: "Total Users", color: "text-teal-600",  accent: "bg-teal-500",  iconBg: "bg-teal-50",  iconColor: "text-teal-600",  Icon: Users },
  { key: "admin",    label: "Admin",       color: "text-cyan-600",  accent: "bg-cyan-500",  iconBg: "bg-cyan-50",  iconColor: "text-cyan-600",  Icon: Shield },
  { key: "operator", label: "Operator",    color: "text-amber-500", accent: "bg-amber-500", iconBg: "bg-amber-50", iconColor: "text-amber-600", Icon: UserCheck },
  { key: "other",    label: "QC + Viewer", color: "text-slate-600", accent: "bg-slate-400", iconBg: "bg-slate-100",iconColor: "text-slate-500", Icon: Eye },
];

export default function UserPerm() {
  const empty = { id: null, username: "", password: "", role: "viewer" };

  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(empty);
  const [mode, setMode] = useState("add");
  const [error, setError] = useState("");
  const [successMsg, showSuccess] = useMessageTimer(3000);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("users/");
      setUsers(data);
    } catch {
      setError("Failed to load users");
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    setError("");
    const uname = form.username.trim();
    const pw = form.password.trim();
    if (!uname) { setError("Username is required"); return; }
    if (mode === "add" && !pw) { setError("Password is required"); return; }

    const payload = { username: uname, role: form.role };
    if (pw) payload.password = pw;

    try {
      setBusy(true);
      if (mode === "add") {
        await api.post("users/", payload);
        showSuccess("User created successfully!", "success");
      } else {
        await api.put(`users/${form.id}`, payload);
        showSuccess("User updated successfully!", "success");
      }
      setForm(empty); setMode("add"); refresh();
    } catch (err) {
      setError(err.response?.data?.detail || err.response?.data?.message || "Failed to save user");
    } finally { setBusy(false); }
  };

  const del = async (u) => {
    if (!window.confirm(`Are you sure you want to delete user "${u.username}"?`)) return;
    try {
      await api.delete(`users/${u.id}`);
      showSuccess("User deleted successfully!", "success");
      refresh();
    } catch { setError("Failed to delete user"); }
  };

  const edit = (u) => { setForm({ ...u, password: "" }); setMode("edit"); setError(""); };
  const newUser = () => { setForm(empty); setMode("add"); setError(""); };

  const countByRole = (r) => users.filter(u => u.role === r).length;
  const metricValues = {
    total: users.length,
    admin: countByRole("admin"),
    operator: countByRole("operator"),
    other: countByRole("qc") + countByRole("viewer"),
  };

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ fontFamily: "'Inter', system-ui, sans-serif", background: 'rgba(248, 250, 252, 0.8)' }}>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center">
              <Users className="w-[18px] h-[18px] text-teal-600" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-slate-800">User Management</h1>
              <p className="text-sm text-slate-500">Manage system users and permissions</p>
            </div>
          </div>
        </div>

        {/* ── Metric Cards ── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
          {METRIC_CFG.map((m) => {
            const MIcon = m.Icon;
            return (
              <div key={m.key} className={`${CARD} p-4 relative overflow-hidden`}>
                {/* accent top stripe */}
                <div className={`absolute top-0 inset-x-0 h-[3px] ${m.accent}`} />
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">{m.label}</p>
                    <p className={`text-2xl font-bold tabular-nums ${m.color}`}>{metricValues[m.key]}</p>
                  </div>
                  <div className={`w-8 h-8 rounded-lg ${m.iconBg} flex items-center justify-center flex-shrink-0`}>
                    <MIcon className={`w-4 h-4 ${m.iconColor}`} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <span className="text-sm text-red-800">{error}</span>
          </div>
        )}
        {successMsg.text && (
          <div className="mb-5 p-4 bg-teal-50 border border-teal-200 rounded-lg flex items-center gap-3">
            <UserCheck className="w-5 h-5 text-teal-600 flex-shrink-0" />
            <span className="text-sm text-teal-800">{successMsg.text}</span>
          </div>
        )}

        {/* ── Content Grid ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* ── Users Table Card ── */}
          <div className="xl:col-span-2">
            <div className={CARD}>
              {/* card header zone */}
              <div className="px-5 md:px-6 pt-5 md:pt-6 pb-4 border-b border-slate-100 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                  <Users className="w-4 h-4 text-slate-500" />
                </div>
                <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">Current Users</h2>
                <span className="ml-auto inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-500 tabular-nums">
                  {users.length}
                </span>
              </div>

              {/* table body */}
              <div className="overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50/80">
                      <th className="px-5 md:px-6 py-3 text-left text-[11px] font-medium text-slate-400 uppercase tracking-wider">User</th>
                      <th className="px-5 py-3 text-left text-[11px] font-medium text-slate-400 uppercase tracking-wider">Role</th>
                      <th className="px-5 md:px-6 py-3 text-center text-[11px] font-medium text-slate-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((u) => {
                      const rc = ROLE_MAP[u.role] || ROLE_MAP.viewer;
                      const RIcon = rc.Icon;
                      return (
                        <tr key={u.id} className="hover:bg-slate-50/60 transition-colors duration-150">
                          <td className="px-5 md:px-6 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-semibold text-sm ring-2 ${rc.ring} ${rc.bg} ${rc.text}`}>
                                {u.username.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-slate-800">{u.username}</p>
                                <p className="text-[11px] text-slate-400 tabular-nums">ID: {u.id}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${rc.bg} ${rc.text} ${rc.border}`}>
                              <RIcon className="w-3 h-3" />
                              {u.role}
                            </span>
                          </td>
                          <td className="px-5 md:px-6 py-3.5">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => edit(u)} className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors duration-150" title="Edit user">
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button onClick={() => del(u)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-150" title="Delete user">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {users.length === 0 && (
                  <div className="py-12 text-center">
                    <Users className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                    <p className="text-sm text-slate-400">No users found. Create your first user!</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Sidebar: Form + Role Legend ── */}
          <div className="xl:col-span-1">
            <div className={CARD}>
              {/* tinted header banner */}
              <div className={`px-5 md:px-6 pt-5 md:pt-6 pb-4 border-b border-slate-100 flex items-center gap-3 ${mode === "edit" ? "bg-amber-50/40" : "bg-teal-50/40"}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${mode === "edit" ? "bg-amber-100" : "bg-teal-100"}`}>
                  {mode === "add"
                    ? <UserPlus className="w-4 h-4 text-teal-600" />
                    : <Edit3 className="w-4 h-4 text-amber-600" />
                  }
                </div>
                <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
                  {mode === "add" ? "Add New User" : "Edit User"}
                </h2>
              </div>

              {/* form body */}
              <div className="p-5 md:p-6">
                <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2">Username</label>
                    <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                      className="w-full px-4 py-2.5 bg-white text-slate-800 border-2 border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-150 text-sm"
                      placeholder="Enter username" />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2">
                      Password
                      {mode === "edit" && <span className="text-slate-400 font-normal ml-2 normal-case tracking-normal">(leave blank to keep current)</span>}
                    </label>
                    <div className="relative">
                      <input type={showPassword ? "text" : "password"} value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white text-slate-800 border-2 border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-150 pr-10 text-sm"
                        placeholder={mode === "edit" ? "New password (optional)" : "Enter password"} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2">Role</label>
                    <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                      className="w-full px-4 py-2.5 bg-white text-slate-800 border-2 border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-150 text-sm">
                      <option value="viewer">Viewer - Read only access</option>
                      <option value="qc">QC - Quality control access</option>
                      <option value="operator">Operator - Production access</option>
                      <option value="admin">Admin - Full system access</option>
                    </select>
                  </div>

                  {/* preview selected role */}
                  {(() => {
                    const rc = ROLE_MAP[form.role] || ROLE_MAP.viewer;
                    const RIcon = rc.Icon;
                    return (
                      <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border ${rc.border} ${rc.bg}`}>
                        <div className={`w-2 h-2 rounded-full ${rc.dot}`} />
                        <RIcon className={`w-3.5 h-3.5 ${rc.text}`} />
                        <span className={`text-xs font-semibold ${rc.text} capitalize`}>{form.role}</span>
                      </div>
                    );
                  })()}

                  <button type="submit" disabled={busy}
                    className={`w-full px-5 py-3 text-white font-semibold text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 shadow-sm ${
                      mode === "edit"
                        ? "bg-amber-500 hover:bg-amber-600 active:bg-amber-700"
                        : "bg-teal-600 hover:bg-teal-700 active:bg-teal-800"
                    }`}>
                    {busy ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        {mode === "add" ? "Creating..." : "Updating..."}
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <Save className="w-4 h-4" />
                        {mode === "add" ? "Create User" : "Update User"}
                      </span>
                    )}
                  </button>

                  {mode === "edit" && (
                    <button type="button" onClick={newUser}
                      className="w-full px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm rounded-lg transition-colors duration-150">
                      Cancel
                    </button>
                  )}
                </form>

                {/* Role Legend */}
                <div className="pt-5 mt-5 border-t border-slate-100">
                  <h3 className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-3">Role Permissions</h3>
                  <div className="space-y-2.5">
                    {[
                      ["admin",    "Full system control"],
                      ["operator", "Manage production"],
                      ["qc",       "Perform quality checks"],
                      ["viewer",   "View production data"],
                    ].map(([role, desc]) => {
                      const rc = ROLE_MAP[role];
                      const RIcon = rc.Icon;
                      return (
                        <div key={role} className="flex items-center gap-2.5">
                          <div className={`w-6 h-6 rounded-md flex items-center justify-center ${rc.bg}`}>
                            <RIcon className={`w-3 h-3 ${rc.text}`} />
                          </div>
                          <span className={`text-xs font-semibold capitalize ${rc.text} w-16`}>{role}</span>
                          <span className="text-xs text-slate-400">{desc}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
