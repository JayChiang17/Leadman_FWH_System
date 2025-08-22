/*  Downtime – moved to features/downtime  */
import React, { useState, useEffect, useCallback } from "react";
import api from "../../services/api";                     // ← new path
import FlipClockTimer from "../../components/FlipClockTimer";  // ← new path

import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import "./Downtime.css";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const EditIcon = () => (
  <svg height="18" viewBox="0 0 24 24" fill="#e76f51">
    <path d="M3 17.25V21h3.75l11.02-11.02-3.75-3.75L3 17.25z"/>
    <path d="M20.71 7.04a1 1 0 0 0 0-1.42l-2.34-2.34a1 1 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/>
  </svg>
);
const SaveIcon = () => (
  <svg height="18" viewBox="0 0 24 24" fill="#2a9d8f">
    <path d="M17 3H5a2 2 0 0 0-2 2v14l4-4h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/>
  </svg>
);
const DeleteIcon = () => (
  <svg height="18" viewBox="0 0 24 24" fill="#b00020">
    <path d="M6 7h12v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm13-3v2H5V4h3.5l1-1h5l1 1H19z"/>
  </svg>
);

const cellPositions = [
  'Battery Loading','OSV','Insulator Installation','Cell Stacking',
  'End Plate and Steel Frame install','Cell Pole/Laser Cleaning',
  'CCS Installation','Busbar/laser Welding','Weld Inspection and Cleaning',
  'EOL Inspection & Testing','Install Heating Film','Module Line Crane Lift'
];

const assemblyPositions = [
  'Remove Carton Cover','Remove Front Cover','Module Gluing','Module Installation',
  'Install Single Boards','Install Copper Bars','Cable Organization',
  'Install Crossover Copper Bars','Inspection Area','AOI Inspection',
  'Install Front Cover','Safety Test','Function Test','Pre-Box QC',
  'Install Carton Cover','Final Packing'
];

const minToHHMM = (m) => {
  const mm = Math.round(m);
  return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
};

// 處理今日數據 - 每個工站一個柱狀圖，顏色區分產線
const processTodayDataByLine = (records) => {
  const today = new Date().toLocaleDateString('en-CA');
  const todayRecords = records.filter(record => 
    record.start_local.startsWith(today)
  );
  
  // 分別聚合每條產線的工站數據
  const stationData = [];
  
  todayRecords.forEach(record => {
    const existingStation = stationData.find(item => item.station === record.station);
    if (existingStation) {
      existingStation.duration += record.duration_min;
      // 如果有多條產線的數據，選擇時間較長的產線顏色
      if (record.duration_min > existingStation.maxDuration) {
        existingStation.line = record.line;
        existingStation.maxDuration = record.duration_min;
      }
    } else {
      stationData.push({
        station: record.station,
        duration: record.duration_min,
        line: record.line,
        maxDuration: record.duration_min
      });
    }
  });
  
  // 排序並取前10個工站
  const sortedStations = stationData
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10);
  
  const labels = sortedStations.map(item => item.station);
  const minutes = sortedStations.map(item => Math.round(item.duration));
  const hhmm = minutes.map(m => minToHHMM(m));
  
  // 根據產線設置顏色
  const backgroundColors = sortedStations.map(item => 
    item.line === 'cell' ? 'rgba(255, 99, 132, 0.7)' : 'rgba(54, 162, 235, 0.7)'
  );
  const borderColors = sortedStations.map(item => 
    item.line === 'cell' ? 'rgba(255, 99, 132, 1)' : 'rgba(54, 162, 235, 1)'
  );
  
  return {
    labels,
    datasets: [{
      label: 'Downtime',
      data: minutes,
      backgroundColor: backgroundColors,
      borderColor: borderColors,
      borderWidth: 1,
      borderRadius: 4,
      barThickness: 26,
    }],
    hhmm,
    lineInfo: sortedStations.map(item => item.line) // 保存每個工站的產線信息
  };
};

// 處理週數據 - 每天兩條柱狀圖，區分產線
const processWeekDataByLine = (records) => {
  // 過去7天的日期
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = new Date(date.getTime() - date.getTimezoneOffset()*60000)
                   .toISOString().split('T')[0];
    days.push(dateStr);
  }
  
  // 按日期和產線聚合數據
  const dailyData = {};
  days.forEach(day => {
    dailyData[day] = { cell: 0, assembly: 0 };
  });
  
  records.forEach(record => {
    const recordDate = record.start_local.split(' ')[0];
    if (days.includes(recordDate)) {
      if (record.line === 'cell') {
        dailyData[recordDate].cell += record.duration_min;
      } else if (record.line === 'assembly') {
        dailyData[recordDate].assembly += record.duration_min;
      }
    }
  });
  
  const labels = days.map(day => day.substring(5)); // MM-DD 格式
  const cellMinutes = days.map(day => Math.round(dailyData[day].cell));
  const assemblyMinutes = days.map(day => Math.round(dailyData[day].assembly));
  
  return {
    labels,
    datasets: [
      {
        label: 'Cell Line',
        data: cellMinutes,
        backgroundColor: 'rgba(255, 99, 132, 0.7)',
        borderColor: 'rgba(255, 99, 132, 1)',
        borderWidth: 1,
        borderRadius: 4,
        barThickness: 20,
      },
      {
        label: 'Assembly Line',
        data: assemblyMinutes,
        backgroundColor: 'rgba(54, 162, 235, 0.7)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1,
        borderRadius: 4,
        barThickness: 20,
      }
    ],
    hhmm: {
      cell: cellMinutes.map(m => minToHHMM(m)),
      assembly: assemblyMinutes.map(m => minToHHMM(m))
    }
  };
};

export default function Downtime() {
  const [step, setStep] = useState(1);
  const [line, setLine] = useState('');
  const [station, setStation] = useState('');
  const [startTs, setStartTs] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [alert, setAlert] = useState(false);
  const [msg, setMsg] = useState('');

  // 更新狀態來支持新的圖表數據格式
  const [today, setToday] = useState({ labels: [], datasets: [], hhmm: [], lineInfo: [] });
  const [week, setWeek] = useState({ labels: [], datasets: [], hhmm: {} });

  const [records, setRecords] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (step !== 3 || !startTs) return;
    const id = setInterval(() => {
      const sec = Math.floor((Date.now() - startTs) / 1000);
      setElapsed(sec);
      if (sec >= 600) setAlert(true);
    }, 1000);
    return () => clearInterval(id);
  }, [step, startTs]);

  // 修改加載數據的函數
  const loadSummaries = useCallback(() => {
    api.get('/downtime/list').then(r => {
      if (r.data.status === 'success') {
        const records = r.data.records;
        
        // 處理今日數據
        const todayData = processTodayDataByLine(records);
        setToday(todayData);
        
        // 處理週數據
        const weekData = processWeekDataByLine(records);
        setWeek(weekData);
      }
    });
  }, []);
  
  const loadRecords = useCallback(() => {
    api.get('/downtime/list').then(r => {
      if (r.data.status === 'success') setRecords(r.data.records);
    });
  }, []);
  
  useEffect(() => {
    loadSummaries(); 
    loadRecords();
  }, [loadSummaries, loadRecords]);

  // 圖表選項函數定義在這裡
  const getTodayChartOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { 
        display: true,
        position: 'top',
        labels: {
          generateLabels: () => [
            {
              text: 'Cell Line',
              fillStyle: 'rgba(255, 99, 132, 0.7)',
              strokeStyle: 'rgba(255, 99, 132, 1)',
              pointStyle: 'rect'
            },
            {
              text: 'Assembly Line', 
              fillStyle: 'rgba(54, 162, 235, 0.7)',
              strokeStyle: 'rgba(54, 162, 235, 1)',
              pointStyle: 'rect'
            }
          ],
          font: { size: 11 }
        }
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const lineName = today.lineInfo?.[context.dataIndex] === 'cell' ? 'Cell Line' : 'Assembly Line';
            return `${lineName}: ${today.hhmm?.[context.dataIndex] || minToHHMM(context.parsed.y)}`;
          }
        }
      }
    },
    scales: {
      y: { ticks: { callback: v => minToHHMM(v) } },
      x: { ticks: { padding: 4 } }
    }
  });

  const getWeekChartOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { 
        display: true,
        position: 'top',
        labels: {
          usePointStyle: true,
          font: { size: 11 }
        }
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const isCell = context.dataset.label.includes('Cell');
            const hhmm = isCell ? 
              week.hhmm?.cell?.[context.dataIndex] : 
              week.hhmm?.assembly?.[context.dataIndex];
            return `${context.dataset.label}: ${hhmm || minToHHMM(context.parsed.y)}`;
          }
        }
      }
    },
    scales: {
      y: { ticks: { callback: v => minToHHMM(v) } },
      x: { 
        ticks: { padding: 4 },
        categoryPercentage: 0.8,
        barPercentage: 0.6
      }
    }
  });

  const reset = () => { setStep(1); setLine(''); setStation(''); setStartTs(null); setElapsed(0); setAlert(false); };
  const chooseLine = l => { setLine(l); setStep(2); };
  const chooseStation = s => { setStation(s); setStep(3); setStartTs(null); setElapsed(0); };
  const startTimer = () => setStartTs(Date.now());

  const submit = async () => {
    try {
      const endTime = Date.now();
      const durationMin = Math.round((endTime - startTs) / 1000 / 60);
  
      await api.post('/downtime', {
        line,
        station,
        start_time: new Date(startTs).toISOString(),
        end_time: new Date(endTime).toISOString()
      });
  
      setMsg(`✅${line === 'cell' ? 'Cell Line' : 'Assembly Line'} – ${station} – ${durationMin} min`);
  
      reset();
      loadSummaries();
      loadRecords();
    } catch (e) {
      setMsg(`❌ ${e.response?.data?.message || e.message}`);
    }
  };
  
  const saveEdit = async (u) => {
  try {
    // ❶ 這裡不要再 new Date().toISOString()，否則會被轉成 UTC
    await api.put(`/downtime/${u.id}`, {
      line: u.line,
      station: u.station,
      start_time: u.start_local, // 例如 "2025-08-07T14:33"
      end_time:   u.end_local
    });

    // ❷ 成功後收尾
    setEditing(null);
    loadRecords();
    loadSummaries();
  } catch (e) {
    setMsg(`❌ ${e.response?.data?.message || e.message}`);
  }
};

  const del = async id => {
    if (!window.confirm(`Delete #${id}?`)) return;
    try { 
      await api.delete(`/downtime/${id}`); 
      loadRecords(); 
      loadSummaries(); 
    }
    catch (e) { setMsg(`❌ ${e.response?.data?.message || e.message}`); }
  };

  return (
    <div className={`dt-container ${alert ? 'dt-flash' : ''}`}>
      <h1 className="dt-title">Downtime Log</h1>

      {step === 1 && (
        <div className="dt-line-select">
          <button onClick={() => chooseLine('cell')}>Cell Line</button>
          <button onClick={() => chooseLine('assembly')}>Assembly Line</button>
        </div>
      )}

      {step === 2 && (
        <div className="dt-station-btns">
          {(line === 'cell' ? cellPositions : assemblyPositions).map(p =>
            <button key={p} onClick={() => chooseStation(p)}>{p}</button>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="dt-timer">
          <div className="dt-info">
            <p><strong>Line:</strong> {line}</p>
            <p><strong>Station:</strong> {station}</p>
          </div>
          {startTs && <div className="flip-timer-wrapper"><FlipClockTimer seconds={elapsed} /></div>}
          <div className="dt-timer-btns">
            {startTs
              ? <button className="dt-end-btn" onClick={submit}>End &amp; Submit</button>
              : <button onClick={startTimer}>Start</button>}
          </div>
        </div>
      )}

      {msg && <div className="dt-msg">{msg}</div>}

      <div className="dt-charts">

        <div className="dt-chart">
          <div className="dt-chart-head">
            <button className="dt-edit-btn" onClick={() => setModalOpen(true)}>Edit</button>
            <h2 className="dt-chart-title">Today's Downtime by Station</h2>
          </div>
          <Bar
            data={today}
            options={getTodayChartOptions()}
          />
        </div>

        <div className="dt-chart">
          <h2 className="dt-chart-title">Past 7 Days Downtime</h2>
          <Bar
            data={week}
            options={getWeekChartOptions()}
          />
        </div>
      </div>

      {modalOpen && (
        <div className="dt-modal">
          <button className="dt-close" onClick={() => setModalOpen(false)}>✖</button>
          <h3>View / Edit Downtime Records</h3>
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Line</th><th>Station</th><th>Start</th><th>End</th><th>Duration</th><th>By</th><th />
              </tr>
            </thead>
            <tbody>
              {records.map(r => {
                const edit = editing?.id === r.id;
                return (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{edit ? <input value={editing.line} onChange={e => setEditing({ ...editing, line: e.target.value })} /> : r.line}</td>
                    <td>{edit ? <input value={editing.station} onChange={e => setEditing({ ...editing, station: e.target.value })} /> : r.station}</td>
                    <td>{edit ? <input type="datetime-local" value={editing.start_local} onChange={e => setEditing({ ...editing, start_local: e.target.value })} /> : r.start_local}</td>
                    <td>{edit ? <input type="datetime-local" value={editing.end_local} onChange={e => setEditing({ ...editing, end_local: e.target.value })} /> : r.end_local}</td>
                    <td>{minToHHMM(r.duration_min)}</td>
                    <td>{r.modified_by || r.created_by}</td>
                    <td>
                      {edit ? (
                        <>
                          <button className="dt-icon-btn" onClick={() => saveEdit(editing)}><SaveIcon /></button>
                          <button className="dt-icon-btn" onClick={() => setEditing(null)}><DeleteIcon /></button>
                        </>
                      ) : (
                        <>
                          <button className="dt-icon-btn" onClick={() => setEditing(r)}><EditIcon /></button>
                          <button className="dt-icon-btn" onClick={() => del(r.id)}><DeleteIcon /></button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}