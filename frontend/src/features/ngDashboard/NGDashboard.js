import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { Line, Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import api from '../../services/api';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { openDashboardSocket } from '../../utils/wsConnect';
import { AuthCtx } from '../../auth/AuthContext';
import './NGDashboard.css';

const getMonthStart = () => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  monthStart.setHours(0, 0, 0, 0);
  return monthStart;
};

const getCaliforniaTime = () => {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
};

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler
);

// NG原因标准化函数 - 处理大小写和相似原因
const normalizeNGReason = (reason) => {
  if (!reason || reason === 'No reason specified') return 'Unknown';

  const normalized = reason.trim().toLowerCase();

  // 定义原因映射规则
  const reasonMap = {
    // 外观问题
    'scratch': 'Scratch/Damage',
    'scratches': 'Scratch/Damage',
    'damage': 'Scratch/Damage',
    'damaged': 'Scratch/Damage',
    'dent': 'Scratch/Damage',
    'dented': 'Scratch/Damage',

    // 功能测试
    'function test fail': 'Function Test Failed',
    'function fail': 'Function Test Failed',
    'test fail': 'Function Test Failed',
    'test failed': 'Function Test Failed',
    'failed test': 'Function Test Failed',

    // 组装问题
    'assembly issue': 'Assembly Issue',
    'assembly problem': 'Assembly Issue',
    'assembly error': 'Assembly Issue',
    'misassembly': 'Assembly Issue',
    'wrong assembly': 'Assembly Issue',

    // 零件问题
    'missing part': 'Missing Parts',
    'missing parts': 'Missing Parts',
    'part missing': 'Missing Parts',
    'parts missing': 'Missing Parts',

    'wrong part': 'Wrong Parts',
    'wrong parts': 'Wrong Parts',
    'incorrect part': 'Wrong Parts',
    'incorrect parts': 'Wrong Parts',

    // 质量问题
    'quality issue': 'Quality Issue',
    'quality problem': 'Quality Issue',
    'poor quality': 'Quality Issue',
    'qc fail': 'Quality Issue',
    'qc failed': 'Quality Issue',

    // 其他常见问题
    'short circuit': 'Short Circuit',
    'short': 'Short Circuit',
    'electrical short': 'Short Circuit',

    'leakage': 'Leakage',
    'leak': 'Leakage',
    'leaking': 'Leakage',
  };

  // 查找映射
  for (const [key, value] of Object.entries(reasonMap)) {
    if (normalized.includes(key)) {
      return value;
    }
  }

  // 如果没有匹配，首字母大写返回
  return reason.charAt(0).toUpperCase() + reason.slice(1);
};

const NGDashboard = () => {
  const { getValidToken } = useContext(AuthCtx);
  const [assemblyNGs, setAssemblyNGs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ngTrend, setNGTrend] = useState({ labels: [], data: [] });
  const dashboardRef = useRef(null);
  const wsRef = useRef(null);
  const assemblyScrollRef = useRef(null);


  // 获取NG数据
  // Monthly trend aggregation - Assembly only
  const generateTrendData = useCallback((assemblies) => {
    const californiaToday = getCaliforniaTime();
    const monthStart = getMonthStart();

    const labels = [];
    const data = [];

    const daysSinceMonthStart = Math.floor((californiaToday - monthStart) / (1000 * 60 * 60 * 24));
    const daysToShow = daysSinceMonthStart + 1;

    for (let i = 0; i < daysToShow; i++) {
      const currentDay = new Date(monthStart);
      currentDay.setDate(monthStart.getDate() + i);

      const dayLabel = currentDay.toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
        timeZone: 'America/Los_Angeles'
      });
      labels.push(dayLabel);

      const dayStart = new Date(currentDay);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(currentDay);
      dayEnd.setHours(23, 59, 59, 999);

      const assemblyCount = assemblies.filter(item => {
        const itemTime = new Date(item.timestamp);
        return itemTime >= dayStart && itemTime <= dayEnd;
      }).length;

      data.push(assemblyCount);
    }

    setNGTrend({ labels, data });
  }, []);

  const fetchNGData = useCallback(async () => {
    try {
      setLoading(true);

      // 只获取Assembly的NG数据，包含已修好的
      const assemblyRes = await api.get('assembly_inventory/list/ng', {
        params: {
          limit: 2000,
          include_fixed: true  // 包含已修好的NG
        }
      });

      // 去重：根据序列号(us_sn)去重，保留最新的记录
      const uniqueAssemblies = Array.from(
        new Map((assemblyRes.data || []).map(item => [item.us_sn || item.id, item])).values()
      );

      // 只保留本月的NG数据
      const monthStart = getMonthStart();
      const thisMonthAssemblies = uniqueAssemblies.filter(item => {
        if (!item.timestamp) return false;
        const itemDate = new Date(item.timestamp);
        return itemDate >= monthStart;
      });

      setAssemblyNGs(thisMonthAssemblies);

      // 生成趋势数据（本月每日）
      generateTrendData(thisMonthAssemblies);
    } catch (error) {
      console.error('Failed to fetch NG data:', error);
    } finally {
      setLoading(false);
    }
  }, [generateTrendData]);



  // 自动滚动功能
  useEffect(() => {
    const container = assemblyScrollRef.current;
    if (!container) return;

    const interval = setInterval(() => {
      const { scrollTop, scrollHeight, clientHeight } = container;

      // 如果已经到底部，回到顶部
      if (scrollTop + clientHeight >= scrollHeight - 2) {
        container.scrollTop = 0;
      } else {
        // 直接向下滚动，不使用 smooth 避免抖动
        container.scrollTop += 1;
      }
    }, 50); // 每50ms滚动1px（比原来的30ms慢）

    return () => clearInterval(interval);
  }, [assemblyNGs]);

  useEffect(() => {
    fetchNGData();

    // WebSocket实时更新
    const { ws, destroy } = openDashboardSocket(
      (msg) => {

        if (msg.event === 'assembly_status_updated' ||
            msg.event === 'assembly_updated') {
          // 当有状态更新时，重新获取NG数据
          fetchNGData();
        }
      },
      (err) => {
        console.error('NG Dashboard WebSocket error:', err);
      },
      30_000,
      getValidToken
    );

    wsRef.current = { ws, destroy };

    return () => {
      if (wsRef.current?.destroy) {
        wsRef.current.destroy();
      }
    };
  }, [fetchNGData, getValidToken]);

  // 双击全屏功能
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      dashboardRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  // 格式化时间
  const formatTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return timestamp;
    }
  };

  // 计算总计
  const totalAssemblyNG = assemblyNGs.length;
  const fixedCount = assemblyNGs.filter(item => {
    const status = (item.status || '').toUpperCase();
    return status === 'FIXED' || status === 'OK' || item.fixed === true;
  }).length;
  const activeNGCount = totalAssemblyNG - fixedCount;

  // 计算风险等级
  const getRiskLevel = (ngCount) => {
    if (ngCount >= 100) return { level: 'critical', color: '#ef4444', label: 'CRITICAL' };
    if (ngCount >= 50) return { level: 'warning', color: '#f97316', label: 'WARNING' };
    if (ngCount >= 20) return { level: 'caution', color: '#eab308', label: 'CAUTION' };
    return { level: 'good', color: '#22c55e', label: 'GOOD' };
  };

  const assemblyRisk = getRiskLevel(totalAssemblyNG);

  // 计算 NG 原因分布（饼图数据）
  const getNGReasonDistribution = useCallback(() => {
    const reasonCounts = {};

    assemblyNGs.forEach(item => {
      const normalizedReason = normalizeNGReason(item.ng_reason);
      reasonCounts[normalizedReason] = (reasonCounts[normalizedReason] || 0) + 1;
    });

    // 转换为数组并排序（按数量降序）
    const sortedReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8); // 只取前8个原因，避免饼图过于复杂

    // 如果有其他原因，合并为 "Others"
    const totalShown = sortedReasons.reduce((sum, [_, count]) => sum + count, 0);
    const othersCount = totalAssemblyNG - totalShown;

    if (othersCount > 0) {
      sortedReasons.push(['Others', othersCount]);
    }

    const labels = sortedReasons.map(([reason]) => reason);
    const data = sortedReasons.map(([_, count]) => count);

    // 美观的配色方案
    const colors = [
      '#ef4444', // red
      '#f97316', // orange
      '#eab308', // yellow
      '#84cc16', // lime
      '#22c55e', // green
      '#14b8a6', // teal
      '#3b82f6', // blue
      '#8b5cf6', // purple
      '#ec4899', // pink
    ];

    return {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, labels.length),
        borderColor: '#ffffff',
        borderWidth: 3,
      }]
    };
  }, [assemblyNGs, totalAssemblyNG]);

  // 风险徽章组件
  const RiskBadge = ({ risk, count }) => (
    <div className={`ng-risk-badge ${risk.level}`} style={{ borderColor: risk.color }}>
      <AlertTriangle size={16} style={{ color: risk.color }} />
      <span style={{ color: risk.color }}>{risk.label}</span>
      <span className="ng-risk-count">{count} units</span>
    </div>
  );

  return (
    <div
      ref={dashboardRef}
      className="ng-dashboard-container"
      onDoubleClick={toggleFullscreen}
    >
      <div className="ng-dashboard-layout">
        {/* Left Side: Statistics Panel */}
        <div className="ng-stats-panel">
          {/* Assembly NG Summary Card */}
          <div className="ng-stats-card ng-total-card">
            <h2 className="ng-card-title">Assembly NG • This Month</h2>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
              <h1 className="ng-card-big">{totalAssemblyNG}</h1>
              {fixedCount > 0 && (
                <span style={{ fontSize: '1.2rem', color: '#059669', fontWeight: '600' }}>
                  ({fixedCount} Fixed)
                </span>
              )}
            </div>
            <RiskBadge risk={assemblyRisk} count={totalAssemblyNG} />

            {/* NG Trend Chart */}
            <div className="ng-trend-chart">
              {ngTrend.labels.length > 0 && (
                <Line
                  data={{
                    labels: ngTrend.labels,
                    datasets: [
                      {
                        label: 'Assembly NG',
                        data: ngTrend.data,
                        borderColor: assemblyRisk.color,
                        backgroundColor: assemblyRisk.color + '33',
                        tension: 0.4,
                        fill: true,
                        pointRadius: 4,
                        pointBackgroundColor: assemblyRisk.color,
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                      }
                    ]
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: {
                      padding: {
                        top: 5,
                        bottom: 20, // 增加底部 padding 避免 X 軸標籤被切掉
                        left: 5,
                        right: 5
                      }
                    },
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.9)',
                        padding: 16,
                        titleFont: { size: 16, weight: 'bold' },
                        bodyFont: { size: 14 },
                        cornerRadius: 8,
                      }
                    },
                    scales: {
                      y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.08)' },
                        ticks: {
                          font: { size: 12 },
                          padding: 8
                        }
                      },
                      x: {
                        grid: { display: false },
                        ticks: {
                          font: { size: 11 },
                          padding: 8, // 增加 X 軸標籤的 padding
                          maxRotation: 0, // 防止標籤旋轉
                          minRotation: 0,
                          autoSkip: true,
                          maxTicksLimit: 15 // 限制最多顯示標籤數量
                        }
                      }
                    }
                  }}
                />
              )}
            </div>
          </div>

          {/* NG Reason Distribution Pie Chart */}
          <div className="ng-stats-card ng-reason-card">
            <h3 className="ng-reason-title">NG Reason Distribution</h3>
            <div className="ng-reason-chart">
              {totalAssemblyNG > 0 && (
                <Pie
                  data={getNGReasonDistribution()}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        position: 'right',
                        labels: {
                          font: { size: 10, weight: '600' },
                          padding: 10,
                          color: '#525252',
                          boxWidth: 10,
                          boxHeight: 10,
                          usePointStyle: true,
                          pointStyle: 'circle',
                        }
                      },
                      tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.9)',
                        padding: 14,
                        titleFont: { size: 14, weight: 'bold' },
                        bodyFont: { size: 13 },
                        cornerRadius: 8,
                        callbacks: {
                          label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value} (${percentage}%)`;
                          }
                        }
                      }
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Assembly NG List */}
        <div className="ng-lists-panel">
          <div className="ng-section ng-section-full">
            <div className="ng-section-header">
              <div>
                <p className="ng-section-kicker">Assembly Line • This Month</p>
                <h2 className="ng-section-title">Assembly NG Units</h2>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {fixedCount > 0 && (
                  <span className="ng-section-count fixed-count">
                    {fixedCount} Fixed
                  </span>
                )}
                <span className="ng-section-count">{activeNGCount} Active</span>
              </div>
            </div>

            <div className="ng-section-body">
              {loading && assemblyNGs.length === 0 ? (
                <div className="ng-empty">
                  <RefreshCw className="rotating" size={32} />
                  <p>Loading NG data...</p>
                </div>
              ) : assemblyNGs.length === 0 ? (
                <div className="ng-empty">
                  <p>No Assembly NG units found this month</p>
                </div>
              ) : (
                <div className="ng-table assembly">
                  <div className="ng-table-header">
                    <div className="ng-col ng-col-id">Serial Number</div>
                    <div className="ng-col ng-col-reason">NG Reason</div>
                    <div className="ng-col ng-col-time">NG Time</div>
                  </div>

                  <div className="ng-table-body" ref={assemblyScrollRef}>
                    {assemblyNGs.map((item, index) => {
                      const status = (item.status || '').toUpperCase();
                      const isFixed = status === 'FIXED' || status === 'OK' || item.fixed === true;
                      return (
                        <div key={item.id || index} className="ng-table-row assembly">
                          <div className="ng-col ng-col-id">
                            <span className="ng-id-badge">{item.us_sn || item.id || 'N/A'}</span>
                          </div>
                          <div className="ng-col ng-col-reason">
                            <span className={isFixed ? 'ng-reason-fixed' : 'ng-reason-text'}>
                              {item.ng_reason || 'No reason specified'}{isFixed ? ' (FIXED)' : ''}
                            </span>
                          </div>
                          <div className="ng-col ng-col-time">
                            {formatTime(item.timestamp)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NGDashboard;



