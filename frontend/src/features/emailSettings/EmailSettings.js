import React, { useState, useEffect, useContext, useCallback } from 'react';
import { Mail, Clock, Users, Send, History, Eye, CheckCircle, XCircle, AlertCircle, Plus, Trash2, Power } from 'lucide-react';
import { AuthCtx } from '../../auth/AuthContext';
import './EmailSettings.css';

const EmailSettings = () => {
  const { getValidToken } = useContext(AuthCtx);
  const [activeTab, setActiveTab] = useState('schedule');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Schedule state
  const [scheduleConfig, setScheduleConfig] = useState({
    send_time: '18:00',
    enabled: true
  });

  // Recipients state
  const [recipients, setRecipients] = useState([]);
  const [newRecipient, setNewRecipient] = useState({
    email: '',
    display_name: ''
  });

  // History state
  const [emailHistory, setEmailHistory] = useState([]);

  // Preview state
  const [previewData, setPreviewData] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 5000);
  };

  // Define fetch functions with useCallback before useEffect
  const fetchEmailConfig = useCallback(async () => {
    try {
      const token = await getValidToken();
      const response = await fetch('/api/email-settings/config', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setScheduleConfig({
          send_time: data.send_time,
          enabled: data.enabled
        });
      }
    } catch (error) {
      console.error('Error fetching email config:', error);
    }
  }, [getValidToken]);

  const updateEmailConfig = async () => {
    setLoading(true);
    try {
      const token = await getValidToken();
      const response = await fetch('/api/email-settings/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(scheduleConfig)
      });

      if (response.ok) {
        showMessage('success', 'Email schedule updated successfully');
      } else {
        const error = await response.json();
        showMessage('error', error.detail || 'Failed to update schedule');
      }
    } catch (error) {
      showMessage('error', 'Error updating schedule');
    } finally {
      setLoading(false);
    }
  };

  const fetchRecipients = useCallback(async () => {
    try {
      const token = await getValidToken();
      const response = await fetch('/api/email-settings/recipients', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setRecipients(data);
      }
    } catch (error) {
      console.error('Error fetching recipients:', error);
    }
  }, [getValidToken]);

  const addRecipient = async (e) => {
    e.preventDefault();
    if (!newRecipient.email) {
      showMessage('error', 'Email is required');
      return;
    }

    setLoading(true);
    try {
      const token = await getValidToken();
      const response = await fetch('/api/email-settings/recipients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newRecipient)
      });

      if (response.ok) {
        showMessage('success', 'Recipient added successfully');
        setNewRecipient({ email: '', display_name: '' });
        fetchRecipients();
      } else {
        const error = await response.json();
        showMessage('error', error.detail || 'Failed to add recipient');
      }
    } catch (error) {
      showMessage('error', 'Error adding recipient');
    } finally {
      setLoading(false);
    }
  };

  const deleteRecipient = async (recipientId) => {
    // Find recipient info for confirmation message
    const recipient = recipients.find(r => r.id === recipientId);
    const recipientName = recipient ? (recipient.display_name || recipient.email) : 'this recipient';

    if (!window.confirm(`⚠️ PERMANENT DELETE\n\nAre you sure you want to permanently delete "${recipientName}"?\n\nThis action CANNOT be undone. The recipient will be completely removed from the database.`)) {
      return;
    }

    setLoading(true);
    try {
      const token = await getValidToken();
      const response = await fetch(`/api/email-settings/recipients/${recipientId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        showMessage('success', '✅ Recipient permanently deleted from database');
        fetchRecipients();
      } else if (response.status === 404) {
        showMessage('error', '❌ Recipient not found (may have been already deleted)');
        fetchRecipients(); // Refresh list to sync with server
      } else {
        const errorData = await response.json().catch(() => ({}));
        showMessage('error', `❌ Failed to delete recipient: ${errorData.detail || 'Unknown error'}`);
      }
    } catch (error) {
      showMessage('error', '❌ Error deleting recipient');
    } finally {
      setLoading(false);
    }
  };

  const toggleRecipient = async (recipientId, currentStatus) => {
    setLoading(true);
    try {
      const token = await getValidToken();
      const response = await fetch(`/api/email-settings/recipients/${recipientId}/toggle`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ is_active: !currentStatus })
      });

      if (response.ok) {
        showMessage('success', `Recipient ${!currentStatus ? 'activated' : 'deactivated'}`);
        fetchRecipients();
      } else {
        showMessage('error', 'Failed to toggle recipient status');
      }
    } catch (error) {
      showMessage('error', 'Error toggling recipient');
    } finally {
      setLoading(false);
    }
  };

  const sendTestEmail = async () => {
    if (!window.confirm('Send test email to all active recipients?')) {
      return;
    }

    setLoading(true);
    try {
      const token = await getValidToken();
      const response = await fetch('/api/email-settings/test-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({})
      });

      if (response.ok) {
        const data = await response.json();
        showMessage('success', `Test email sent to ${data.recipients.length} recipient(s)`);
        fetchEmailHistory();
      } else {
        const error = await response.json();
        showMessage('error', error.detail || 'Failed to send test email');
      }
    } catch (error) {
      showMessage('error', 'Error sending test email');
    } finally {
      setLoading(false);
    }
  };

  const fetchEmailHistory = useCallback(async () => {
    try {
      const token = await getValidToken();
      const response = await fetch('/api/email-settings/history?limit=50', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setEmailHistory(data);
      }
    } catch (error) {
      console.error('Error fetching email history:', error);
    }
  }, [getValidToken]);

  // Fetch email config on mount
  useEffect(() => {
    fetchEmailConfig();
    fetchRecipients();
    fetchEmailHistory();
  }, [fetchEmailConfig, fetchRecipients, fetchEmailHistory]);

  const fetchPreview = async () => {
    setLoading(true);
    try {
      const token = await getValidToken();
      const response = await fetch('/api/email-settings/preview', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setPreviewData(data.preview_data);
        setShowPreview(true);
        showMessage('success', 'Preview loaded successfully');
      } else {
        showMessage('error', 'Failed to load preview');
      }
    } catch (error) {
      showMessage('error', 'Error loading preview');
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'schedule', label: 'Schedule', icon: Clock },
    { id: 'recipients', label: 'Recipients', icon: Users },
    { id: 'test', label: 'Test & Preview', icon: Send },
    { id: 'history', label: 'History', icon: History }
  ];

  const formatDateTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status) => {
    const badges = {
      success: { bg: 'status-success', icon: CheckCircle, text: 'Success' },
      failed: { bg: 'status-failed', icon: XCircle, text: 'Failed' },
      error: { bg: 'status-error', icon: AlertCircle, text: 'Error' }
    };
    const badge = badges[status] || badges.error;
    const Icon = badge.icon;

    return (
      <div className={`status-badge ${badge.bg}`}>
        <Icon className="status-icon" />
        <span>{badge.text}</span>
      </div>
    );
  };

  return (
    <div className="email-settings-container">
      {/* Premium Header */}
      <div className="email-header">
        <div className="header-content">
          <div className="header-title-group">
            <div className="header-icon-wrapper">
              <Mail className="header-icon" />
            </div>
            <div className="header-text">
              <h1 className="header-title">Email Configuration</h1>
              <p className="header-subtitle">Automated Production Reports & Notifications</p>
            </div>
          </div>
        </div>
      </div>

      {/* Message Alert */}
      {message.text && (
        <div className={`email-alert ${message.type}`}>
          <div className="alert-content">
            {message.type === 'success' && <CheckCircle className="alert-icon" />}
            {message.type === 'error' && <XCircle className="alert-icon" />}
            <span>{message.text}</span>
          </div>
        </div>
      )}

      {/* Premium Tabs */}
      <div className="email-tabs-wrapper">
        <div className="email-tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`email-tab ${activeTab === tab.id ? 'active' : ''}`}
              >
                <Icon className="tab-icon" />
                <span className="tab-label">{tab.label}</span>
                {activeTab === tab.id && <div className="tab-indicator" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="email-content">
        {/* Schedule Config Tab */}
        {activeTab === 'schedule' && (
          <div className="content-section">
            <div className="luxury-card">
              <div className="card-header">
                <Clock className="card-icon" />
                <h2 className="card-title">Schedule Configuration</h2>
              </div>

              <div className="card-body">
                <div className="form-group">
                  <label className="form-label">Daily Send Time</label>
                  <input
                    type="time"
                    value={scheduleConfig.send_time}
                    onChange={(e) => setScheduleConfig({ ...scheduleConfig, send_time: e.target.value })}
                    className="form-input time-input"
                  />
                  <p className="form-hint">Email will be sent automatically at this time every day</p>
                </div>

                <div className="toggle-group">
                  <div className="toggle-content">
                    <Power className="toggle-icon" />
                    <div className="toggle-text">
                      <span className="toggle-label">Enable Automated Sending</span>
                      <span className="toggle-description">Turn on to activate daily email reports</span>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={scheduleConfig.enabled}
                      onChange={(e) => setScheduleConfig({ ...scheduleConfig, enabled: e.target.checked })}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <button
                  onClick={updateEmailConfig}
                  disabled={loading}
                  className="btn-primary btn-full"
                >
                  {loading ? 'Updating...' : 'Save Configuration'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Recipients Tab */}
        {activeTab === 'recipients' && (
          <div className="content-section">
            {/* Add Recipient Card */}
            <div className="luxury-card">
              <div className="card-header">
                <Plus className="card-icon" />
                <h2 className="card-title">Add New Recipient</h2>
              </div>

              <form onSubmit={addRecipient} className="card-body">
                <div className="form-row">
                  <div className="form-group flex-1">
                    <label className="form-label">Email Address *</label>
                    <input
                      type="email"
                      placeholder="email@company.com"
                      value={newRecipient.email}
                      onChange={(e) => setNewRecipient({ ...newRecipient, email: e.target.value })}
                      className="form-input"
                      required
                    />
                  </div>
                  <div className="form-group flex-1">
                    <label className="form-label">Display Name</label>
                    <input
                      type="text"
                      placeholder="John Doe (optional)"
                      value={newRecipient.display_name}
                      onChange={(e) => setNewRecipient({ ...newRecipient, display_name: e.target.value })}
                      className="form-input"
                    />
                  </div>
                </div>
                <button type="submit" disabled={loading} className="btn-primary">
                  <Plus className="btn-icon" />
                  Add Recipient
                </button>
              </form>
            </div>

            {/* Recipients List */}
            <div className="luxury-card">
              <div className="card-header">
                <Users className="card-icon" />
                <h2 className="card-title">Recipients ({recipients.length})</h2>
              </div>

              <div className="card-body">
                {recipients.length === 0 ? (
                  <div className="empty-state">
                    <Users className="empty-icon" />
                    <p className="empty-text">No recipients configured yet</p>
                  </div>
                ) : (
                  <div className="recipient-list">
                    {recipients.map((recipient) => {
                      return (
                        <div key={recipient.id} className="recipient-card">
                          <div className="recipient-info">
                            <div className={`recipient-status ${recipient.is_active ? 'active' : 'inactive'}`} />
                            <div className="recipient-details">
                              <span className="recipient-name">{recipient.display_name || recipient.email}</span>
                              {recipient.display_name && (
                                <span className="recipient-email">{recipient.email}</span>
                              )}
                            </div>
                          </div>
                          <div className="recipient-actions">
                            <button
                              onClick={() => toggleRecipient(recipient.id, recipient.is_active)}
                              className={`btn-toggle ${recipient.is_active ? 'active' : ''}`}
                              title={recipient.is_active ? 'Click to deactivate (keeps in database)' : 'Click to activate'}
                            >
                              {recipient.is_active ? 'Active' : 'Inactive'}
                            </button>
                            <button
                              onClick={() => deleteRecipient(recipient.id)}
                              className="btn-delete"
                              title="⚠️ PERMANENTLY DELETE from database (cannot be undone)"
                            >
                              <Trash2 className="btn-icon" />
                              Permanently Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Test Email Tab */}
        {activeTab === 'test' && (
          <div className="content-section">
            <div className="luxury-card">
              <div className="card-header">
                <Send className="card-icon" />
                <h2 className="card-title">Test & Preview</h2>
              </div>

              <div className="card-body">
                <div className="info-banner">
                  <AlertCircle className="info-icon" />
                  <p>Test email will be sent to all active recipients with current production data</p>
                </div>

                <div className="action-buttons">
                  <button
                    onClick={sendTestEmail}
                    disabled={loading}
                    className="btn-primary btn-large"
                  >
                    <Send className="btn-icon" />
                    {loading ? 'Sending...' : 'Send Test Email'}
                  </button>

                  <button
                    onClick={fetchPreview}
                    disabled={loading}
                    className="btn-secondary btn-large"
                  >
                    <Eye className="btn-icon" />
                    {loading ? 'Loading...' : 'Preview Report Data'}
                  </button>
                </div>

                {showPreview && previewData && (
                  <div className="preview-panel">
                    <h3 className="preview-title">Report Data Preview</h3>
                    <pre className="preview-code">{JSON.stringify(previewData, null, 2)}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Email History Tab */}
        {activeTab === 'history' && (
          <div className="content-section">
            <div className="luxury-card">
              <div className="card-header">
                <History className="card-icon" />
                <h2 className="card-title">Email Send History</h2>
                <button onClick={fetchEmailHistory} className="btn-refresh">
                  Refresh
                </button>
              </div>

              <div className="card-body">
                {emailHistory.length === 0 ? (
                  <div className="empty-state">
                    <History className="empty-icon" />
                    <p className="empty-text">No email history available</p>
                  </div>
                ) : (
                  <div className="history-list">
                    {emailHistory.map((record) => (
                      <div key={record.id} className="history-card">
                        <div className="history-header">
                          {getStatusBadge(record.status)}
                          <span className="history-time">{formatDateTime(record.sent_at)}</span>
                        </div>
                        <div className="history-details">
                          <div className="history-row">
                            <span className="history-label">Recipients:</span>
                            <span className="history-value">{record.recipients}</span>
                          </div>
                          <div className="history-row">
                            <span className="history-label">Triggered by:</span>
                            <span className="history-value">{record.triggered_by}</span>
                          </div>
                          {record.error_message && (
                            <div className="history-error">
                              <AlertCircle className="error-icon" />
                              <span>{record.error_message}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailSettings;
