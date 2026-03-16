import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Mail, Clock, Users, Send, History, Eye, CheckCircle, XCircle,
  AlertCircle, Plus, Trash2, ChevronDown, ChevronUp, RefreshCw,
  Power, Zap, Save, X, BarChart2,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import api from '../../services/api';
import './EmailSettings.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const CARD = 'bg-white border border-slate-200/80 rounded-xl shadow-sm';

const METRIC_CFG = [
  { key: 'time',       label: 'Schedule Time',     accent: 'bg-teal-500',    iconBg: 'bg-teal-50',    iconColor: 'text-teal-600',   Icon: Clock    },
  { key: 'status',     label: 'Status',             accent: 'bg-emerald-500', iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', Icon: Power    },
  { key: 'recipients', label: 'Active Recipients',  accent: 'bg-cyan-500',    iconBg: 'bg-cyan-50',    iconColor: 'text-cyan-600',   Icon: Users    },
  { key: 'lastSent',   label: 'Last Sent',          accent: 'bg-amber-500',   iconBg: 'bg-amber-50',   iconColor: 'text-amber-600',  Icon: Send     },
];

// ── Plan A: Preview mini-report component ─────────────────────────────────────

const EffBar = ({ value }) => {
  const pct = Math.min(value || 0, 100);
  const color = pct >= 100 ? 'bg-emerald-500' : pct >= 80 ? 'bg-amber-500' : 'bg-red-500';
  const text  = pct >= 100 ? 'text-emerald-600' : pct >= 80 ? 'text-amber-600' : 'text-red-500';
  return (
    <div className="mt-2 space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-400">Efficiency</span>
        <span className={`font-bold ${text}`}>{value || 0}%</span>
      </div>
      <div className="h-1.5 bg-white/80 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const PreviewReport = ({ data }) => {
  if (!data) return null;
  const d = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">
          Report for <span className="text-teal-600">{d.date || 'Today'}</span>
        </p>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-md">
          California Time
        </span>
      </div>

      {/* Today's 4 KPI cards */}
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Today's Production</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

          {/* Module */}
          <div className="p-4 bg-teal-50 border border-teal-100 rounded-xl">
            <p className="text-[10px] font-semibold text-teal-600 uppercase tracking-wider">Module Line</p>
            <p className="text-2xl font-bold text-slate-800 tabular-nums mt-1">
              {(d.module_production || 0).toLocaleString()}
            </p>
            <p className="text-xs text-slate-500">Plan: {(d.module_plan || 0).toLocaleString()}</p>
            <EffBar value={d.module_efficiency} />
          </div>

          {/* Assembly */}
          <div className="p-4 bg-cyan-50 border border-cyan-100 rounded-xl">
            <p className="text-[10px] font-semibold text-cyan-600 uppercase tracking-wider">Assembly Line</p>
            <p className="text-2xl font-bold text-slate-800 tabular-nums mt-1">
              {(d.assembly_production || 0).toLocaleString()}
            </p>
            <p className="text-xs text-slate-500">Plan: {(d.assembly_plan || 0).toLocaleString()}</p>
            <EffBar value={d.assembly_efficiency} />
          </div>

          {/* Total NG */}
          <div className="p-4 bg-red-50 border border-red-100 rounded-xl">
            <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">Total NG</p>
            <p className="text-2xl font-bold text-slate-800 tabular-nums mt-1">{d.total_ng || 0}</p>
            {(d.ng_reasons || []).slice(0, 2).map((r, i) => (
              <p key={i} className="text-[10px] text-slate-500 mt-0.5 truncate">
                {r.reason}: <span className="font-semibold">{r.count}</span>
              </p>
            ))}
          </div>

          {/* Downtime — split Cell / Assembly */}
          <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl">
            <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">Downtime</p>
            <p className="text-2xl font-bold text-slate-800 tabular-nums mt-1">
              {d.downtime_hours || 0}
              <span className="text-sm font-medium text-slate-400 ml-1">hrs total</span>
            </p>
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">Cell</span>
                <span className="text-[11px] font-bold text-slate-700 tabular-nums">
                  {d.cell_downtime_hours || 0}h
                </span>
              </div>
              <div className="h-1 bg-white/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-400 rounded-full"
                  style={{ width: d.downtime_hours > 0 ? `${Math.min(((d.cell_downtime_hours || 0) / d.downtime_hours) * 100, 100)}%` : '0%' }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-cyan-600 uppercase tracking-wider">Assembly</span>
                <span className="text-[11px] font-bold text-slate-700 tabular-nums">
                  {d.assembly_downtime_hours || 0}h
                </span>
              </div>
              <div className="h-1 bg-white/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400 rounded-full"
                  style={{ width: d.downtime_hours > 0 ? `${Math.min(((d.assembly_downtime_hours || 0) / d.downtime_hours) * 100, 100)}%` : '0%' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* NG Breakdown */}
      {(d.ng_reasons || []).length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
            NG Breakdown
          </p>
          <div className="space-y-2.5">
            {d.ng_reasons.map((r, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 min-w-0 flex-1 truncate" title={r.reason}>
                  {r.reason}
                </span>
                <div className="w-28 h-2 bg-slate-100 rounded-full overflow-hidden flex-shrink-0">
                  <div className="h-full bg-red-400 rounded-full" style={{ width: `${r.percentage}%` }} />
                </div>
                <span className="text-xs font-mono text-slate-500 w-7 text-right flex-shrink-0">{r.count}</span>
                <span className="text-[10px] text-slate-400 w-10 text-right flex-shrink-0">{r.percentage}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly Summary */}
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
          This Week
          {d.day_range && <span className="ml-1 font-normal normal-case">({d.day_range})</span>}
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Module</p>
            <p className="text-lg font-bold text-slate-800 tabular-nums">
              {(d.weekly_module_count || 0).toLocaleString()}
            </p>
            <p className="text-xs text-slate-500">Plan: {(d.weekly_module_plan || 0).toLocaleString()}</p>
            <p className={`text-xs font-bold mt-1 ${
              (d.weekly_module_efficiency || 0) >= 100 ? 'text-emerald-600'
              : (d.weekly_module_efficiency || 0) >= 80 ? 'text-amber-600'
              : 'text-red-500'
            }`}>{d.weekly_module_efficiency || 0}% eff.</p>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Assembly</p>
            <p className="text-lg font-bold text-slate-800 tabular-nums">
              {(d.weekly_assembly_count || 0).toLocaleString()}
            </p>
            <p className="text-xs text-slate-500">Plan: {(d.weekly_assembly_plan || 0).toLocaleString()}</p>
            <p className={`text-xs font-bold mt-1 ${
              (d.weekly_assembly_efficiency || 0) >= 100 ? 'text-emerald-600'
              : (d.weekly_assembly_efficiency || 0) >= 80 ? 'text-amber-600'
              : 'text-red-500'
            }`}>{d.weekly_assembly_efficiency || 0}% eff.</p>
          </div>
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl">
            <p className="text-[10px] text-red-400 uppercase tracking-wider mb-1">Weekly NG</p>
            <p className="text-lg font-bold text-slate-800 tabular-nums">{d.weekly_total_ng || 0}</p>
            <p className="text-xs text-slate-500 mt-1">{d.days_counted || 0} day(s)</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const EmailSettings = () => {
  const [activeTab, setActiveTab] = useState('schedule');
  const [loading,   setLoading]   = useState(false);
  const [message,   setMessage]   = useState({ type: '', text: '' });
  const messageTimerRef = useRef(null);

  // ── Existing state ──
  const [scheduleConfig, setScheduleConfig] = useState({ send_time: '18:00', enabled: true });
  const [recipients,     setRecipients]     = useState([]);
  const [newRecipient,   setNewRecipient]   = useState({ email: '', display_name: '' });
  const [showAddForm,    setShowAddForm]    = useState(false);
  const [emailHistory,   setEmailHistory]   = useState([]);
  const [expandedHistory,setExpandedHistory]= useState(null);
  const [previewData,    setPreviewData]    = useState(null);
  const [showPreview,    setShowPreview]    = useState(false);

  // ── Plan B: Countdown ──
  const [countdown, setCountdown] = useState('—');
  const countdownRef = useRef(null);

  // ── Plan C: Test targeting ──
  const [sendToMode,    setSendToMode]    = useState('all');
  const [specificEmail, setSpecificEmail] = useState('');
  const [lastSendResult, setLastSendResult] = useState(null);

  // ── Plan D: History filter ──
  const [historyFilter, setHistoryFilter] = useState('all');

  // ── Helpers ──
  const showMessage = useCallback((type, text) => {
    setMessage({ type, text });
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage({ type: '', text: '' }), 5000);
  }, []);

  useEffect(() => () => { if (messageTimerRef.current) clearTimeout(messageTimerRef.current); }, []);

  // ── Data fetches ──
  const fetchEmailConfig = useCallback(async () => {
    try {
      const { data } = await api.get('email-settings/config');
      setScheduleConfig({ send_time: data.send_time, enabled: data.enabled });
    } catch (e) { console.error('Error fetching email config:', e); }
  }, []);

  const fetchRecipients = useCallback(async () => {
    try {
      const { data } = await api.get('email-settings/recipients');
      setRecipients(data);
    } catch (e) { console.error('Error fetching recipients:', e); }
  }, []);

  const fetchEmailHistory = useCallback(async () => {
    try {
      const { data } = await api.get('email-settings/history', { params: { limit: 50 } });
      setEmailHistory(data);
    } catch (e) { console.error('Error fetching history:', e); }
  }, []);

  useEffect(() => {
    fetchEmailConfig();
    fetchRecipients();
    fetchEmailHistory();
  }, [fetchEmailConfig, fetchRecipients, fetchEmailHistory]);

  // ── Plan B: Countdown interval ──
  useEffect(() => {
    const update = () => {
      if (!scheduleConfig.send_time || !scheduleConfig.enabled) {
        setCountdown('—');
        return;
      }
      const [h, m] = scheduleConfig.send_time.split(':').map(Number);
      const now   = new Date();
      const pst   = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      const tgt   = new Date(pst);
      tgt.setHours(h, m, 0, 0);
      if (tgt <= pst) tgt.setDate(tgt.getDate() + 1);
      const diffMins = Math.floor((tgt - pst) / 60000);
      const hrs  = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      setCountdown(hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`);
    };
    update();
    countdownRef.current = setInterval(update, 30000);
    return () => clearInterval(countdownRef.current);
  }, [scheduleConfig.send_time, scheduleConfig.enabled]);

  // ── Plan D: Computed history data ──
  const historyStats = useMemo(() => {
    const total   = emailHistory.length;
    const success = emailHistory.filter(h => h.status === 'success').length;
    const failed  = emailHistory.filter(h => h.status !== 'success').length;
    return {
      total,
      success,
      failed,
      rate: total > 0 ? Math.round(success / total * 100) : 0,
    };
  }, [emailHistory]);

  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all') return emailHistory;
    if (historyFilter === 'success') return emailHistory.filter(h => h.status === 'success');
    return emailHistory.filter(h => h.status !== 'success');
  }, [emailHistory, historyFilter]);

  const chartData = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });
    return days.map(day => {
      const recs = emailHistory.filter(h => (h.sent_at || '').toString().slice(0, 10) === day);
      return {
        day:  day.slice(5).replace('-', '/'),
        ok:   recs.filter(h => h.status === 'success').length,
        fail: recs.filter(h => h.status !== 'success').length,
      };
    });
  }, [emailHistory]);

  // ── Derived ──
  const activeRecipients = recipients.filter(r => r.is_active).length;

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'America/Los_Angeles', timeZoneName: 'short',
    });
  };

  const lastSent = emailHistory.length > 0 ? fmtDate(emailHistory[0].sent_at) : 'Never';

  const metricValues = {
    time:       scheduleConfig.send_time,
    status:     scheduleConfig.enabled ? 'Enabled' : 'Disabled',
    recipients: activeRecipients,
    lastSent,
  };
  const metricColors = {
    time:       'text-teal-600',
    status:     scheduleConfig.enabled ? 'text-emerald-600' : 'text-slate-400',
    recipients: 'text-cyan-600',
    lastSent:   'text-amber-500',
  };

  // ── Plan C: Unified send (replaces sendTestEmail) ──
  const triggerSend = async (targetEmail = null) => {
    if (!targetEmail && activeRecipients === 0) {
      showMessage('error', 'No active recipients configured');
      return;
    }
    setLoading(true);
    setLastSendResult(null);
    try {
      const payload = targetEmail ? { recipient_email: targetEmail } : {};
      const { data: d } = await api.post('email-settings/test-email', payload);
      setLastSendResult({ recipients: d.recipients, sent_at: d.sent_at });
      showMessage('success', `Sent to ${d.recipients.length} recipient(s)`);
      fetchEmailHistory();
    } catch (err) {
      showMessage('error', err.response?.data?.detail || 'Error sending email');
    } finally {
      setLoading(false);
    }
  };

  // ── Schedule handlers ──
  const updateEmailConfig = async () => {
    setLoading(true);
    try {
      await api.put('email-settings/config', scheduleConfig);
      showMessage('success', 'Schedule updated');
    } catch (err) {
      showMessage('error', err.response?.data?.detail || 'Error updating schedule');
    } finally { setLoading(false); }
  };

  // ── Recipients handlers ──
  const addRecipient = async (e) => {
    e.preventDefault();
    if (!newRecipient.email) { showMessage('error', 'Email is required'); return; }
    setLoading(true);
    try {
      await api.post('email-settings/recipients', newRecipient);
      showMessage('success', 'Recipient added');
      setNewRecipient({ email: '', display_name: '' });
      setShowAddForm(false);
      fetchRecipients();
    } catch (err) {
      showMessage('error', err.response?.data?.detail || 'Error adding recipient');
    } finally { setLoading(false); }
  };

  const deleteRecipient = async (id) => {
    const r = recipients.find(x => x.id === id);
    if (!window.confirm(`Permanently delete "${r?.display_name || r?.email}"?\n\nThis cannot be undone.`)) return;
    setLoading(true);
    try {
      await api.delete(`email-settings/recipients/${id}`);
      showMessage('success', 'Recipient deleted');
      fetchRecipients();
    } catch { showMessage('error', 'Error deleting recipient'); }
    finally { setLoading(false); }
  };

  const toggleRecipient = async (id, current) => {
    setLoading(true);
    try {
      await api.patch(`email-settings/recipients/${id}/toggle`, { is_active: !current });
      showMessage('success', `Recipient ${!current ? 'activated' : 'deactivated'}`);
      fetchRecipients();
    } catch { showMessage('error', 'Error toggling recipient'); }
    finally { setLoading(false); }
  };

  const fetchPreview = async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get('email-settings/preview');
      setPreviewData(d.preview_data);
      setShowPreview(true);
    } catch { showMessage('error', 'Error loading preview'); }
    finally { setLoading(false); }
  };

  const parseRecipients = (str) =>
    str ? str.split(',').map(e => e.trim()).filter(Boolean) : [];

  const tabs = [
    { id: 'schedule',   label: 'Schedule',     icon: Clock    },
    { id: 'recipients', label: 'Recipients',   icon: Users    },
    { id: 'test',       label: 'Test & Preview', icon: Send   },
    { id: 'history',    label: 'History',      icon: History  },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen p-4 md:p-6"
      style={{ fontFamily: "'Inter', system-ui, sans-serif", background: 'rgba(248, 250, 252, 0.8)' }}
    >
      {/* Toast */}
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

        {/* Metric Cards */}
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

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg mb-6 overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-colors duration-150 whitespace-nowrap ${active ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Icon size={15} />
                <span>{label}</span>
                {id === 'recipients' && recipients.length > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded ${active ? 'bg-teal-50 text-teal-600' : 'bg-slate-200 text-slate-500'}`}>
                    {recipients.length}
                  </span>
                )}
                {id === 'history' && historyStats.failed > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-600">
                    {historyStats.failed}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ══════════════════════════════════════════
            Schedule Tab  (Plan B)
        ══════════════════════════════════════════ */}
        {activeTab === 'schedule' && (
          <div className={CARD}>
            <div className="px-5 md:px-6 pt-5 md:pt-6 pb-4 border-b border-slate-100 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
                <Clock className="w-4 h-4 text-teal-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">Schedule Settings</h2>
            </div>

            <div className="p-5 md:p-6 space-y-5">
              {/* Time + Toggle */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="p-4 bg-slate-50/80 border border-slate-200/60 rounded-xl">
                  <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2">
                    Daily Send Time <span className="ml-1 text-slate-300 font-normal normal-case">(PST / PDT)</span>
                  </label>
                  <input
                    type="time"
                    value={scheduleConfig.send_time}
                    onChange={(e) => setScheduleConfig({ ...scheduleConfig, send_time: e.target.value })}
                    className="w-full px-4 py-3 bg-white border-2 border-slate-200 rounded-lg text-xl font-mono font-bold text-slate-800 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all"
                  />
                  <p className="text-[11px] text-slate-400 mt-2">Report is sent automatically at this time daily</p>
                </div>

                <div className="p-4 bg-slate-50/80 border border-slate-200/60 rounded-xl flex flex-col gap-3">
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
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold w-fit ${scheduleConfig.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    <div className={`w-2 h-2 rounded-full ${scheduleConfig.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                    {scheduleConfig.enabled ? 'Active' : 'Inactive'}
                  </div>
                </div>
              </div>

              {/* Plan B: Next send / Last sent row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-teal-50/60 border border-teal-100 rounded-xl">
                  <p className="text-[10px] font-semibold text-teal-500 uppercase tracking-wider mb-1">Next Send In</p>
                  <p className={`text-2xl font-bold tabular-nums ${scheduleConfig.enabled ? 'text-teal-700' : 'text-slate-400'}`}>
                    {scheduleConfig.enabled ? countdown : '—'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    At {scheduleConfig.send_time} PST/PDT
                  </p>
                </div>
                <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-xl">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Last Sent</p>
                  <p className="text-sm font-semibold text-slate-700 leading-snug">{lastSent}</p>
                  {emailHistory.length > 0 && (
                    <span className={`text-[11px] font-bold ${emailHistory[0].status === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
                      {emailHistory[0].status === 'success' ? '✓ Success' : '✗ Failed'}
                    </span>
                  )}
                </div>
              </div>

              {/* Save + Trigger Now */}
              <div className="pt-5 border-t border-slate-100 flex flex-wrap gap-3">
                <button
                  onClick={updateEmailConfig}
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  <Save size={15} />
                  {loading ? 'Saving…' : 'Save Configuration'}
                </button>

                {/* Plan B: Trigger Now */}
                <button
                  onClick={() => {
                    if (!window.confirm(`Trigger daily report now?\nWill send to ${activeRecipients} active recipient(s).`)) return;
                    triggerSend(null);
                  }}
                  disabled={loading || !scheduleConfig.enabled || activeRecipients === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                  title={activeRecipients === 0 ? 'No active recipients' : 'Send report immediately'}
                >
                  <Zap size={15} />
                  Trigger Now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════
            Recipients Tab
        ══════════════════════════════════════════ */}
        {activeTab === 'recipients' && (
          <div className={CARD}>
            <div className="px-5 md:px-6 pt-5 md:pt-6 pb-4 border-b border-slate-100 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center">
                <Users className="w-4 h-4 text-cyan-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
                  Recipients
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-500 tabular-nums normal-case">
                    {recipients.length}
                  </span>
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
                          <Plus size={15} /><span>Add</span>
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

        {/* ══════════════════════════════════════════
            Test & Preview Tab  (Plan C + Plan A)
        ══════════════════════════════════════════ */}
        {activeTab === 'test' && (
          <div className={CARD}>
            <div className="px-5 md:px-6 pt-5 md:pt-6 pb-4 border-b border-slate-100 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
                <Zap className="w-4 h-4 text-teal-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">Test & Preview</h2>
            </div>

            <div className="p-5 md:p-6 space-y-5">

              {/* Plan C: Send-to selector */}
              <div className="p-4 bg-slate-50/80 border border-slate-200/60 rounded-xl space-y-4">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Send To</p>

                {/* All recipients */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="sendTo"
                    value="all"
                    checked={sendToMode === 'all'}
                    onChange={() => setSendToMode('all')}
                    className="w-4 h-4 accent-teal-600"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">All active recipients</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${activeRecipients > 0 ? 'bg-cyan-50 text-cyan-700' : 'bg-slate-100 text-slate-400'}`}>
                      {activeRecipients} {activeRecipients === 1 ? 'person' : 'people'}
                    </span>
                  </div>
                </label>

                {/* Specific recipient */}
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="sendTo"
                      value="specific"
                      checked={sendToMode === 'specific'}
                      onChange={() => setSendToMode('specific')}
                      className="w-4 h-4 accent-teal-600"
                    />
                    <span className="text-sm font-medium text-slate-700">Specific person</span>
                  </label>

                  {sendToMode === 'specific' && (
                    <div className="ml-7">
                      {recipients.filter(r => r.is_active).length === 0 ? (
                        <p className="text-sm text-slate-400 italic">No active recipients available</p>
                      ) : (
                        <select
                          value={specificEmail}
                          onChange={(e) => setSpecificEmail(e.target.value)}
                          className="w-full px-4 py-2.5 bg-white border-2 border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all"
                        >
                          <option value="">Select recipient…</option>
                          {recipients.filter(r => r.is_active).map(r => (
                            <option key={r.id} value={r.email}>
                              {r.display_name ? `${r.display_name}  —  ${r.email}` : r.email}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Info banner */}
              <div className="flex items-start gap-3 p-4 bg-amber-50/60 border border-amber-200/60 rounded-xl">
                <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-slate-600 leading-relaxed">
                  {sendToMode === 'all'
                    ? <>Test email will be sent to all <strong className="text-slate-800">{activeRecipients} active</strong> recipient(s) with current production data.</>
                    : specificEmail
                      ? <>Test email will be sent only to <strong className="text-slate-800">{specificEmail}</strong>.</>
                      : <>Select a recipient from the dropdown above.</>
                  }
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => triggerSend(sendToMode === 'specific' ? specificEmail : null)}
                  disabled={loading || (sendToMode === 'specific' && !specificEmail)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  <Send size={15} />
                  {loading ? 'Sending…' : 'Send Test Email'}
                </button>
                <button
                  onClick={fetchPreview}
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white border-2 border-slate-200 text-sm font-semibold text-slate-700 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors duration-150 disabled:opacity-50"
                >
                  <Eye size={15} />
                  {loading ? 'Loading…' : 'Preview Report Data'}
                </button>
              </div>

              {/* Plan C: Send result confirmation */}
              {lastSendResult && (
                <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <CheckCircle size={18} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-emerald-700">Email sent successfully</p>
                    <p className="text-xs text-slate-500 mt-1 truncate">
                      To: {lastSendResult.recipients.join(', ')}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      At: {fmtDate(lastSendResult.sent_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => setLastSendResult(null)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors flex-shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Plan A: Structured preview (replaces raw JSON) */}
              {showPreview && previewData && (
                <div className="pt-5 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Report Data Preview</p>
                    <button
                      onClick={() => setShowPreview(false)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <PreviewReport data={previewData} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════
            History Tab  (Plan D)
        ══════════════════════════════════════════ */}
        {activeTab === 'history' && (
          <div className={CARD}>
            <div className="px-5 md:px-6 pt-5 md:pt-6 pb-4 border-b border-slate-100 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <History className="w-4 h-4 text-slate-500" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">Send History</h2>
              <button
                onClick={fetchEmailHistory}
                className="ml-auto flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-teal-600 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>

            <div className="p-5 md:p-6 space-y-5">

              {/* Plan D: Stats row */}
              <div className="grid grid-cols-4 gap-3">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                  <p className="text-xl font-bold text-slate-800 tabular-nums">{historyStats.total}</p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">Total</p>
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
                  <p className="text-xl font-bold text-emerald-700 tabular-nums">{historyStats.success}</p>
                  <p className="text-[10px] text-emerald-500 uppercase tracking-wider mt-0.5">Success</p>
                </div>
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-center">
                  <p className="text-xl font-bold text-red-600 tabular-nums">{historyStats.failed}</p>
                  <p className="text-[10px] text-red-400 uppercase tracking-wider mt-0.5">Failed</p>
                </div>
                <div className={`p-3 border rounded-xl text-center ${
                  historyStats.rate >= 90 ? 'bg-emerald-50 border-emerald-100'
                  : historyStats.rate >= 70 ? 'bg-amber-50 border-amber-100'
                  : 'bg-red-50 border-red-100'
                }`}>
                  <p className={`text-xl font-bold tabular-nums ${
                    historyStats.rate >= 90 ? 'text-emerald-700'
                    : historyStats.rate >= 70 ? 'text-amber-600'
                    : 'text-red-600'
                  }`}>{historyStats.rate}%</p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">Success Rate</p>
                </div>
              </div>

              {/* Plan D: 7-day bar chart */}
              {emailHistory.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Last 7 Days
                    <span className="ml-2 font-normal normal-case text-slate-300">(stacked: success / failed)</span>
                  </p>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <ResponsiveContainer width="100%" height={80}>
                      <BarChart data={chartData} barSize={22} barGap={3}>
                        <XAxis
                          dataKey="day"
                          tick={{ fontSize: 10, fill: '#94a3b8' }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          formatter={(v, name) => [v, name === 'ok' ? 'Success' : 'Failed']}
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,.06)' }}
                          cursor={{ fill: 'rgba(0,0,0,.03)' }}
                        />
                        <Bar dataKey="ok"   stackId="s" fill="#0d9488" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="fail" stackId="s" fill="#ef4444" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Plan D: Status filter */}
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { key: 'all',     label: `All (${historyStats.total})` },
                  { key: 'success', label: `Success (${historyStats.success})` },
                  { key: 'failed',  label: `Failed (${historyStats.failed})` },
                ].map(f => (
                  <button
                    key={f.key}
                    onClick={() => setHistoryFilter(f.key)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors duration-150 ${
                      historyFilter === f.key
                        ? f.key === 'success' ? 'bg-emerald-600 text-white'
                          : f.key === 'failed' ? 'bg-red-600 text-white'
                          : 'bg-slate-700 text-white'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* History table */}
              {filteredHistory.length === 0 ? (
                <div className="py-12 text-center">
                  <History size={36} className="text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">
                    {historyFilter === 'all' ? 'No history available' : `No ${historyFilter} records`}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto -mx-5 md:-mx-6 px-5 md:px-6">
                  {/* Desktop header */}
                  <div className="hidden md:grid grid-cols-[100px_160px_140px_1fr] gap-4 px-4 py-2.5 bg-slate-50 rounded-lg mb-1">
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Status</span>
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Date</span>
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Trigger</span>
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Recipients</span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {filteredHistory.map((rec) => {
                      const recipientList = parseRecipients(rec.recipients);
                      const isExpanded    = expandedHistory === rec.id;
                      const statusClass   =
                        rec.status === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : rec.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200';
                      const StatusIcon    =
                        rec.status === 'success' ? CheckCircle
                        : rec.status === 'failed' ? XCircle : AlertCircle;

                      return (
                        <div key={rec.id} className="group">
                          {/* Desktop row */}
                          <div className="hidden md:grid grid-cols-[100px_160px_140px_1fr] gap-4 px-4 py-3.5 items-center hover:bg-slate-50/60 rounded-lg transition-colors">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold w-fit uppercase tracking-wide border ${statusClass}`}>
                              <StatusIcon size={12} />
                              {rec.status}
                            </span>
                            <span className="text-sm text-slate-600 font-mono tabular-nums">{fmtDate(rec.sent_at)}</span>
                            <span className="text-sm text-slate-600 font-medium">{rec.triggered_by}</span>
                            <button
                              onClick={() => setExpandedHistory(isExpanded ? null : rec.id)}
                              className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-600 transition-colors w-fit"
                            >
                              <Users size={12} />
                              <span>{recipientList.length}</span>
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          </div>

                          {/* Mobile row */}
                          <div className="md:hidden p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide border ${statusClass}`}>
                                <StatusIcon size={12} />
                                {rec.status}
                              </span>
                              <span className="text-xs text-slate-400 font-mono tabular-nums">{fmtDate(rec.sent_at)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-slate-500">
                                Trigger: <span className="font-medium text-slate-700">{rec.triggered_by}</span>
                              </span>
                              <button
                                onClick={() => setExpandedHistory(isExpanded ? null : rec.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-bold text-slate-600"
                              >
                                <span>{recipientList.length}</span>
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                            </div>
                          </div>

                          {/* Expanded recipient list */}
                          {isExpanded && (
                            <div className="px-4 pb-4 md:pl-[116px]">
                              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/60">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Recipient List</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
                                  {recipientList.map((email, i) => (
                                    <span key={i} className="text-xs text-slate-600 font-mono truncate bg-white px-2.5 py-1.5 rounded-md border border-slate-100">
                                      {email}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Error message */}
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
