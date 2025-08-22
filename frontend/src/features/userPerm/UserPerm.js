// src/features/userPerm/UserPerm.js
import { useEffect, useState } from "react";
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

export default function UserPerm() {
  /* ────────── local state ────────── */
  const empty = { id: null, username: "", password: "", role: "viewer" };

  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(empty);
  const [mode, setMode] = useState("add"); // add | edit
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  /* ────────── fetch list on mount ────────── */
  useEffect(() => {
    refresh();
  }, []);

  const refresh = async () => {
    try {
      const { data } = await api.get("/users/");
      setUsers(data);
    } catch {
      setError("Failed to load users");
    }
  };

  /* ────────── create / update ────────── */
  const save = async () => {
    setError("");
    setSuccess("");

    const uname = form.username.trim();
    const pw = form.password.trim();

    if (!uname) {
      setError("Username is required");
      return;
    }
    if (mode === "add" && !pw) {
      setError("Password is required");
      return;
    }

    // 後端 schema：{ username, password?, role }
    const payload = {
      username: uname,
      role: form.role,
    };
    if (pw) payload.password = pw; // edit 模式可留空 → 不送 password

    try {
      setBusy(true);

      if (mode === "add") {
        await api.post("/users/", payload);
        setSuccess("User created successfully!");
      } else {
        await api.put(`/users/${form.id}`, payload);
        setSuccess("User updated successfully!");
      }

      setForm(empty);
      setMode("add");
      refresh();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(
        err.response?.data?.detail ||
          err.response?.data?.message ||
          "Failed to save user"
      );
    } finally {
      setBusy(false);
    }
  };

  /* ────────── delete ────────── */
  const del = async (u) => {
    if (
      !window.confirm(`Are you sure you want to delete user "${u.username}"?`)
    )
      return;
    try {
      await api.delete(`/users/${u.id}`);
      setSuccess("User deleted successfully!");
      refresh();
      setTimeout(() => setSuccess(""), 3000);
    } catch {
      setError("Failed to delete user");
    }
  };

  /* ────────── edit / reset helpers ────────── */
  const edit = (u) => {
    setForm({ ...u, password: "" }); // 清空密碼欄位
    setMode("edit");
    setError("");
    setSuccess("");
  };

  const newUser = () => {
    setForm(empty);
    setMode("add");
    setError("");
    setSuccess("");
  };

  /* ────────── UI helpers ────────── */
  const getRoleStyle = (role) => {
    const styles = {
      admin: "bg-purple-100 text-purple-800 border-purple-200",
      operator: "bg-blue-100 text-blue-800 border-blue-200",
      qc: "bg-green-100 text-green-800 border-green-200",
      viewer: "bg-gray-100 text-gray-800 border-gray-200",
    };
    return styles[role] || styles.viewer;
  };

  const getRoleIcon = (role) => {
    const icons = {
      admin: <Shield className="w-3 h-3" />,
      operator: <UserCheck className="w-3 h-3" />,
      qc: <Eye className="w-3 h-3" />,
      viewer: <Users className="w-3 h-3" />,
    };
    return icons[role] || icons.viewer;
  };

  /* ────────── render ────────── */
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 mb-6">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-sky-100 to-cyan-100 rounded-lg">
                <Users className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  User Management
                </h1>
                <p className="text-gray-600 mt-1">
                  Manage system users and permissions
                </p>
              </div>
            </div>
          </div>

          {/* Alerts */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <span className="text-red-800">{error}</span>
            </div>
          )}

          {success && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
              <UserCheck className="w-5 h-5 text-green-600 flex-shrink-0" />
              <span className="text-green-800">{success}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Users Table */}
            <div className="lg:col-span-2">
              <div className="bg-gradient-to-br from-sky-50 to-indigo-100 rounded-xl p-6 border border-indigo-200">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5 text-gray-600" />
                  Current Users
                </h2>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gradient-to-r from-sky-100 to-indigo-50 border-b border-indigo-200">
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Username
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Role
                        </th>
                        <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {users.map((u) => (
                        <tr
                          key={u.id}
                          className="hover:bg-gray-50 transition-colors duration-150"
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full flex items-center justify-center font-semibold bg-amber-100 text-amber-700">
                                {u.username.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {u.username}
                                </p>
                                <p className="text-xs text-gray-500">
                                  ID: {u.id}
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${getRoleStyle(
                                u.role
                              )}`}
                            >
                              {getRoleIcon(u.role)}
                              {u.role}
                            </span>
                          </td>

                          <td className="px-6 py-4">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => edit(u)}
                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors duration-200"
                                title="Edit user"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => del(u)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-200"
                                title="Delete user"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {users.length === 0 && (
                    <div className="p-8 text-center text-gray-500">
                      No users found. Create your first user!
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* User Form */}
            <div className="lg:col-span-1">
              <div className="bg-gradient-to-br from-sky-50 to-indigo-100 rounded-xl p-6 border border-indigo-200">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2 ">
                  {mode === "add" ? (
                    <>
                      <UserPlus className="w-5 h-5 text-indigo-600" />
                      Add New User
                    </>
                  ) : (
                    <>
                      <Edit3 className="ww-5 h-5 text-indigo-600" />
                      Edit User
                    </>
                  )}
                </h2>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    save();
                  }}
                  className="space-y-5"
                >
                  {/* Username */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Username
                    </label>
                    <input
                      type="text"
                      value={form.username}
                      onChange={(e) =>
                        setForm({ ...form, username: e.target.value })
                      }
                      className="w-full px-4 py-2.5 bg-white text-black border border-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200 pr-10"
                      placeholder="Enter username"
                    />
                  </div>

                  {/* Password */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Password
                      {mode === "edit" && (
                        <span className="text-xs text-gray-500 font-normal ml-2">
                          (leave blank to keep current)
                        </span>
                      )}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={(e) =>
                          setForm({ ...form, password: e.target.value })
                        }
                        className="w-full px-4 py-2.5 bg-white text-black border border-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200 pr-10"
                        placeholder={
                          mode === "edit"
                            ? "Enter new password (optional)"
                            : "Enter password"
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        {showPassword ? (
                          <Eye className="w-5 h-5" />
                        ) : (
                          <Eye className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Role */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Role
                    </label>
                    <select
                      value={form.role}
                      onChange={(e) =>
                        setForm({ ...form, role: e.target.value })
                      }
                      className="w-full px-4 py-2.5 bg-white text-black border border-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                    >
                      <option value="viewer">
                        Viewer - Read only access
                      </option>
                      <option value="qc">QC - Quality control access</option>
                      <option value="operator">
                        Operator - Production access
                      </option>
                      <option value="admin">
                        Admin - Full system access
                      </option>
                    </select>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full px-6 py-3 bg-gradient-to-r from-sky-600 to-indigo-600 text-white font-medium rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transform transition-all duration-200 hover:scale-[1.02] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    {busy ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg
                          className="animate-spin h-5 w-5"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="none"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        {mode === "add" ? "Creating..." : "Updating..."}
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <Save className="w-5 h-5" />
                        {mode === "add" ? "Create User" : "Update User"}
                      </span>
                    )}
                  </button>

                  {/* Cancel button (edit mode) */}
                  {mode === "edit" && (
                    <button
                      type="button"
                      onClick={newUser}
                      className="w-full px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-all duration-200"
                    >
                      Cancel
                    </button>
                  )}
                </form>
              </div>

              {/* Role Legend */}
              <div className="mt-6 bg-white rounded-xl p-6 border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">
                  Role Permissions
                </h3>
                <div className="space-y-2 text-sm">
                  {[
                    ["viewer", "View production data"],
                    ["qc", "Perform quality checks"],
                    ["operator", "Manage production"],
                    ["admin", "Full system control"],
                  ].map(([role, desc]) => (
                    <div key={role} className="flex items-start gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border mt-0.5 ${getRoleStyle(
                          role
                        )}`}
                      >
                        {getRoleIcon(role)}
                      </span>
                      <span className="text-gray-600">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
