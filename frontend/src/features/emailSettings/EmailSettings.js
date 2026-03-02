import React, { useState, useEffect, useCallback } from 'react';
import { Mail, Clock, Users, Send, History, Eye, CheckCircle, XCircle, AlertCircle, Plus, Trash2, ChevronDown, ChevronUp, RefreshCw, Power, Zap, Save } from 'lucide-react';
import api from '../../services/api';
import './EmailSettings.css';

const CARD = "bg-white border border-slate-200/80 rounded-xl shadow-sm";

const METRIC_CFG = [
  { key: "time",       label: "Schedule Time",    accent: "bg-teal-500",   iconBg: "bg-teal-50",    iconColor: "text-teal-600",   Icon: Clock },
  { key: "status",     label: "Status",           accent: "bg-emerald-500",iconBg: "bg-emerald-50", iconColor: "text-emerald-600", Icon: Power },
  { key: "recipients", label: "Active Recipients", accent: "bg-cyan-500",  iconBg: "bg-cyan-50",    iconColor: "text-cyan-600",   Icon: Users },
  { key: "lastSent",   label: "Last Sent",        accent: "bg-amber-500",  iconBg: "bg-amber-50",   iconColor: "text-amber-600",  Icon: Send },
];

const EmailSettings = () => {
  const [activeTab, setActiveTab] = useState('schedule');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [scheduleConfig, setScheduleConfig] = useState({ send_time: '18:00', enabled: true });
  const [recipients, setRecipients] = useState([]);
  const [newRecipient, setNewRecipient] = useState({ email: '', display_name: '' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [emailHistory, setEmailHistory] = useState([]);
  const [expandedHistory, setExpandedHistory] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 5000);
  };

  const fetchEmailConfig = useCallback(async () => {
    try {
      const { data } = await api.get('email-settings/config');
      setScheduleConfig({ send_time: data.send_time, enabled: data.enabled });
    } catch (e) { console.error('Error fetching email config:', e); }
  }, []);

  const updateEmailConfig = async () => {
    setLoading(true);
    try {
      await api.put('email-settings/config', scheduleConfig);
      showMessage('success', 'Schedule updated');
    } catch (err) { showMessage('error', err.response?.data?.detail || 'Error updating schedule'); }
    finally { setLoading(false); }
  };

  const fetchRecipients = useCallback(async () => {
    try {
      const { data } = await api.get('email-settings/recipients');
      setRecipients(data);
    } catch (e) { console.error('Error fetching recipients:', e); }
  }, []);

  const addRecipient = async (e) => {
    e.preventDefault();
    if (!newRecipient.email) { showMessage('error', 'Email is required'); return; }
    setLoading(true);
    try {
      await api.post('email-settings/recipients', newRecipient);
      showMessage('success', 'Recipient added'); setNewRecipient({ email: '', display_name: '' }); setShowAddForm(false); fetchRecipients();
    } catch (err) { showMessage('error', err.response?.data?.detail || 'Error adding recipient'); }
    finally { setLoading(false); }
  };

  const deleteRecipient = async (id) => {
    const r = recipients.find(x => x.id === id);
    if (!window.confirm(`Permanently delete "${r?.display_name || r?.email}"?\n\nThis cannot be undone.`)) return;
    setLoading(true);
    try {
      await api.delete(`email-settings/recipients/${id}`);
      showMessage('success', 'Recipient deleted'); fetchRecipients();
    } catch { showMessage('error', 'Error deleting recipient'); }
    finally { setLoading(false); }
  };

  const toggleRecipient = async (id, current) => {
    setLoading(true);
    try {
      await api.patch(`email-settings/recipients/${id}/toggle`, { is_active: !current });
      showMessage('success', `Recipient ${!current ? 'activated' : 'deactivated'}`); fetchRecipients();
    } catch { showMessage('error', 'Error toggling recipient'); }
    finally { setLoading(false); }
  };

  const sendTestEmail = async () => {
    if (!window.confirm('Send test email to all active recipients?')) return;
    setLoading(true);
    try {
      const { data: d } = await api.post('email-settings/test-email', {});
      showMessage('success', `Test sent to ${d.recipients.length} recipient(s)`); fetchEmailHistory();
    } catch (err) { showMessage('error', err.response?.data?.detail || 'Error sending test email'); }
    finally { setLoading(false); }
  };

  const fetchEmailHistory = useCallback(async () => {
    try {
      const { data } = await api.get('email-settings/history', { params: { limit: 50 } });
      setEmailHistory(data);
    } catch (e) { console.error('Error fetching history:', e); }
  }, []);

  const fetchPreview = async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get('email-settings/preview');
      setPreviewData(d.preview_data); setShowPreview(true);
    } catch { showMessage('error', 'Error loading preview'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchEmailConfig(); fetchRecipients(); fetchEmailHistory(); }, [fetchEmailConfig, fetchRecipients, fetchEmailHistory]);

  const tabs = [
    { id: 'schedule', label: 'Schedule', icon: Clock },
    { id: 'recipients', label: 'Recipients', icon: Users },
    { id: 'test', label: 'Test & Preview', icon: Send },
    { id: 'history', label: 'History', icon: History }
  ];

  const fmtDate = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const parseRecipients = (str) => str ? str.split(',').map(e => e.trim()).filter(Boolean) : [];

  const activeRecipients = recipients.filter(r => r.is_active).length;
  const lastSent = emailHistory.length > 0 ? fmtDate(emailHistory[0].sent_at) : 'Never';

  const metricValues = {
    time: scheduleConfig.send_time,
    status: scheduleConfig.enabled ? 'Enabled' : 'Disabled',
    recipients: activeRecipients,
    lastSent,
  };
  const metricColors = {
    time: "text-teal-600",
    status: scheduleConfig.enabled ? "text-emerald-600" : "text-slate-400",
    recipients: "text-cyan-600",
    lastSent: "text-amber-500",
  };

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ fontFamily: "'Inter', system-ui, sans-serif", background: 'rgba(248, 250, 252, 0.8)' }}>
      {/* Alert Toast */}
      {message.text && (
        <div className={`swiss-alert-enter fixed top-6 right-6 z-50 flex items-center gap-3 px-6 py-4 rounded-xl text-sm font-semibold text-white shadow-lg ${message.type === 'success' ? 'bg-teal-600' : 'bg-red-600'}`}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center">
              <Mail size={18} className="text-teal-600" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-slate-800">Email Configuration</h1>
              <p className="text-sm text-slate-500">Automated production reports & notifications</p>
            </div>
          </div>
        </div>

        {/* ── Metric Cards ── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
          {METRIC_CFG.map((m) => {
            const MIcon = m.Icon;
            return (
              <div key={m.key} className={`${CARD} p-4 relative overflow-hidden`}>
                <div className={`absolute top-0 inset-x-0 h-[3px] ${m.accent}`} />
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">{m.label}</p>
                    <p className={`text-2xl font-bold tabular-nums ${metricColors[m.key]}`}>{metricValues[m.key]}</p>
                  </div>
                  <div className={`w-8 h-8 rounded-lg ${m.iconBg} flex items-center justify-center flex-shrink-0`}>
                    <MIcon className={`w-4 h-4 ${m.iconColor}`} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg mb-6 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-colors duration-150 whitespace-nowrap ${active ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
                {tab.id === 'recipients' && recipients.length > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded ${active ? 'bg-teal-50 text-teal-600' : 'bg-slate-200 text-slate-500'}`}>
                    {recipients.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Schedule Tab ── */}
        {activeTab === 'schedule' && (
          <div className={CARD}>
            <div className="px-5 md:px-6 pt-5 md:pt-6 pb-4 border-b border-slate-100 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
                <Clock className="w-4 h-4 text-teal-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">Schedule Settings</h2>
            </div>

            <div className="p-5 md:p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Time input zone */}
                <div className="p-4 bg-slate-50/80 border border-slate-200/60 rounded-xl">
                  <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2">Daily Send Time</label>
                  <input
                    type="time"
                    value={scheduleConfig.send_time}
                    onChange={(e) => setScheduleConfig({ ...scheduleConfig, send_time: e.target.value })}
                    className="w-full px-4 py-3 bg-white border-2 border-slate-200 rounded-lg text-xl font-mono font-bold text-slate-800 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all"
                  />
                  <p className="text-[11px] text-slate-400 mt-2">Report sent automatically at this time daily</p>
                </div>

                {/* Toggle zone */}
                <div className="p-4 bg-slate-50/80 border border-slate-200/60 rounded-xl flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Automated Sending</p>
                      <p className="text-xs text-slate-500 mt-1">Enable scheduled daily reports</p>
                    </div>
                    <label className="swiss-toggle mt-0.5">
                      <input
                        type="checkbox"
                        checked={scheduleConfig.enabled}
                        onChange={(e) => setScheduleConfig({ ...scheduleConfig, enabled: e.target.checked })}
                      />
                      <span className="swiss-toggle-track" />
                    </label>
                  </div>
                  <div className={`mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold ${scheduleConfig.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    <div className={`w-2 h-2 rounded-full ${scheduleConfig.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    {scheduleConfig.enabled ? 'Active' : 'Inactive'}
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-5 border-t border-slate-100">
                <button
                  onClick={updateEmailConfig}
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  <Save size={15} />
                  {loading ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Recipients Tab ── */}
        {activeTab === 'recipients' && (
          <div className={CARD}>
            <div className="px-5 md:px-6 pt-5 md:pt-6 pb-4 border-b border-slate-100 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center">
                <Users className="w-4 h-4 text-cyan-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
                  Recipients
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-500 tabular-nums normal-case">{recipients.length}</span>
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden sm:block text-xs text-slate-400">{activeRecipients} active</span>
                <button
                  onClick={() => setShowAddForm(!showAddForm)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors duration-150 shadow-sm"
                >
                  <Plus size={14} />
                  <span>Add</span>
                </button>
              </div>
            </div>

            <div className="p-5 md:p-6">
              {/* Inline Add Form (collapsible) */}
              {showAddForm && (
                <div className="mb-5 pb-5 border-b border-slate-100">
                  <div className="p-4 bg-teal-50/50 border border-teal-200/60 rounded-xl">
                    <p className="text-[11px] font-medium text-teal-600 uppercase tracking-wider mb-3">New Recipient</p>
                    <form onSubmit={addRecipient} className="flex flex-col md:flex-row gap-3 items-end">
                      <div className="flex-1 w-full">
                        <label htmlFor="recipient-email" className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">Email *</label>
                        <input
                          id="recipient-email"
                          type="email"
                          placeholder="name@company.com"
                          value={newRecipient.email}
                          onChange={(e) => setNewRecipient({ ...newRecipient, email: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white border-2 border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all"
                          required
                        />
                      </div>
                      <div className="flex-1 w-full">
                        <label htmlFor="recipient-name" className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">Name</label>
                        <input
                          id="recipient-name"
                          type="text"
                          placeholder="Optional"
                          value={newRecipient.display_name}
                          onChange={(e) => setNewRecipient({ ...newRecipient, display_name: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white border-2 border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all"
                        />
                      </div>
                      <div className="flex gap-2 w-full md:w-auto">
                        <button type="submit" disabled={loading}
                          className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors duration-150 disabled:opacity-50 whitespace-nowrap shadow-sm">
                          <Plus size={15} />
                          <span>Add</span>
                        </button>
                        <button type="button" onClick={() => setShowAddForm(false)}
                          className="px-4 py-2.5 bg-slate-100 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors duration-150">
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Recipients List */}
              {recipients.length === 0 ? (
                <div className="py-16 text-center">
                  <Users size={40} className="text-slate-200 mx-auto mb-3" />
                  <p className="text-base text-slate-400">No recipients configured</p>
                  <p className="text-xs text-slate-400 mt-1">Click "Add" to get started</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {recipients.map((r) => (
                    <div key={r.id} className="flex items-center gap-4 py-4 group">
                      {/* avatar circle */}
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-semibold text-sm flex-shrink-0 ${r.is_active ? 'bg-cyan-50 text-cyan-700' : 'bg-slate-100 text-slate-400'}`}>
                        {(r.display_name || r.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{r.display_name || r.email}</p>
                        {r.display_name && <p className="text-[11px] text-slate-400 truncate mt-0.5">{r.email}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => toggleRecipient(r.id, r.is_active)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors duration-150 ${
                            r.is_active
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200 border border-slate-200'
                          }`}
                        >
                          <div className={`w-1.5 h-1.5 rounded-full ${r.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {r.is_active ? 'Active' : 'Inactive'}
                        </button>
                        <button
                          onClick={() => deleteRecipient(r.id)}
                          className="p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-150"
                          title="Delete permanently"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Test & Preview Tab ── */}
        {activeTab === 'test' && (
          <div className={CARD}>
            <div className="px-5 md:px-6 pt-5 md:pt-6 pb-4 border-b border-slate-100 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
                <Zap className="w-4 h-4 text-teal-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">Test & Preview</h2>
            </div>

            <div className="p-5 md:p-6">
              <div className="flex items-start gap-3 p-4 bg-amber-50/60 border border-amber-200/60 rounded-xl mb-6">
                <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-slate-600 leading-relaxed">Test email will be sent to all <strong className="font-semibold text-slate-800">{activeRecipients} active</strong> recipients with current production data.</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button onClick={sendTestEmail} disabled={loading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors duration-150 disabled:opacity-50 shadow-sm">
                  <Send size={15} />
                  {loading ? 'Sending...' : 'Send Test Email'}
                </button>
                <button onClick={fetchPreview} disabled={loading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white border-2 border-slate-200 text-sm font-semibold text-slate-700 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors duration-150 disabled:opacity-50">
                  <Eye size={15} />
                  {loading ? 'Loading...' : 'Preview Data'}
                </button>
              </div>

              {showPreview && previewData && (
                <div className="mt-6 pt-5 border-t border-slate-100">
                  <h3 className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-3">Report Data</h3>
                  <pre className="p-4 bg-slate-900 border border-slate-700 rounded-xl text-xs text-emerald-400 font-mono leading-relaxed overflow-auto max-h-80">
                    {JSON.stringify(previewData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── History Tab ── */}
        {activeTab === 'history' && (
          <div className={CARD}>
            <div className="px-5 md:px-6 pt-5 md:pt-6 pb-4 border-b border-slate-100 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <History className="w-4 h-4 text-slate-500" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">Send History</h2>
              <span className="ml-auto">
                <button onClick={fetchEmailHistory} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-teal-600 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors">
                  <RefreshCw size={14} />
                  <span>Refresh</span>
                </button>
              </span>
            </div>

            <div className="p-5 md:p-6">
              {emailHistory.length === 0 ? (
                <div className="py-12 text-center">
                  <History size={36} className="text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">No history available</p>
                </div>
              ) : (
                <div className="overflow-x-auto -mx-5 md:-mx-6 px-5 md:px-6">
                  {/* table header */}
                  <div className="hidden md:grid grid-cols-[100px_160px_140px_1fr] gap-4 px-4 py-2.5 bg-slate-50 rounded-lg mb-1">
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Status</span>
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Date</span>
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Trigger</span>
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Recipients</span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {emailHistory.map((rec) => {
                      const recipientList = parseRecipients(rec.recipients);
                      const isExpanded = expandedHistory === rec.id;
                      return (
                        <div key={rec.id} className="group">
                          {/* Desktop */}
                          <div className="hidden md:grid grid-cols-[100px_160px_140px_1fr] gap-4 px-4 py-3.5 items-center hover:bg-slate-50/60 rounded-lg transition-colors">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold w-fit uppercase tracking-wide ${
                              rec.status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                              rec.status === 'failed' ? 'bg-red-50 text-red-700 border border-red-200' :
                              'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}>
                              {rec.status === 'success' ? <CheckCircle size={12} /> : rec.status === 'failed' ? <XCircle size={12} /> : <AlertCircle size={12} />}
                              {rec.status}
                            </span>
                            <span className="text-sm text-slate-600 font-mono tabular-nums">{fmtDate(rec.sent_at)}</span>
                            <span className="text-sm text-slate-600 font-medium">{rec.triggered_by}</span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setExpandedHistory(isExpanded ? null : rec.id)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-600 transition-colors"
                              >
                                <Users size={12} />
                                <span>{recipientList.length}</span>
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                            </div>
                          </div>

                          {/* Mobile */}
                          <div className="md:hidden p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide ${
                                rec.status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                rec.status === 'failed' ? 'bg-red-50 text-red-700 border border-red-200' :
                                'bg-amber-50 text-amber-700 border border-amber-200'
                              }`}>
                                {rec.status === 'success' ? <CheckCircle size={12} /> : rec.status === 'failed' ? <XCircle size={12} /> : <AlertCircle size={12} />}
                                {rec.status}
                              </span>
                              <span className="text-xs text-slate-400 font-mono tabular-nums">{fmtDate(rec.sent_at)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-slate-500">Trigger: <span className="font-medium text-slate-700">{rec.triggered_by}</span></span>
                              <button
                                onClick={() => setExpandedHistory(isExpanded ? null : rec.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-bold text-slate-600"
                              >
                                <span>{recipientList.length}</span>
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                            </div>
                          </div>

                          {/* Expanded recipients */}
                          {isExpanded && (
                            <div className="px-4 pb-4 md:pl-[116px]">
                              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/60">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Recipient List</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
                                  {recipientList.map((email, i) => (
                                    <span key={i} className="text-xs text-slate-600 font-mono truncate bg-white px-2.5 py-1.5 rounded-md border border-slate-100">{email}</span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}

                          {rec.error_message && (
                            <div className="mx-4 mb-4 flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200/60 rounded-xl text-sm text-red-700">
                              <AlertCircle size={14} className="flex-shrink-0" />
                              <span>{rec.error_message}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailSettings;
