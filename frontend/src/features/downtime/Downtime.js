/*  Downtime – features/downtime  */
import React, { useState, useEffect, useCallback } from "react";
import api from "../../services/api";
import FlipClockTimer from "../../components/FlipClockTimer";

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

// ===== 時區與日期工具（鎖 Pacific） ==========================================
const PACIFIC_TZ = "America/Los_Angeles";

const partsFromDate = (date, timeZone = PACIFIC_TZ) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return map; // {year,month,day,hour,minute,second}
};

// 用於提交 API：回傳「YYYY-MM-DDTHH:mm:ss」(Pacific local, 無時區資訊)
const toPacificLocalIsoSeconds = (msOrDate) => {
  const d = msOrDate instanceof Date ? msOrDate : new Date(msOrDate);
  const p = partsFromDate(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

// 取「今天」(Pacific) 的 YYYY-MM-DD
const pacificTodayISODate = () => {
  const p = partsFromDate(new Date());
  return `${p.year}-${p.month}-${p.day}`;
};

// 從某個 ISO(YYYY-MM-DD) 算前一天（純曆法）
const prevDayISO = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

// 取最近 n 天（含今天, Pacific）陣列：最舊→最新
const pacificLastNDaysISO = (n = 7) => {
  const days = new Array(n);
  let cur = pacificTodayISODate();
  for (let i = n - 1; i >= 0; i--) {
    days[i] = cur;
    cur = prevDayISO(cur);
  }
  return days;
};

// ===== 小工具 ===============================================================
const EditIcon = () => (
  <svg height="18" viewBox="0 0 24 24" fill="#e76f51">
    <path d="M3 17.25V21h3.75l11.02-11.02-3.75-3.75L3 17.25z" />
    <path d="M20.71 7.04a1 1 0 0 0 0-1.42l-2.34-2.34a1 1 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z" />
  </svg>
);
const SaveIcon = () => (
  <svg height="18" viewBox="0 0 24 24" fill="#2a9d8f">
    <path d="M17 3H5a2 2 0 0 0-2 2v14l4-4h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
  </svg>
);
const DeleteIcon = () => (
  <svg height="18" viewBox="0 0 24 24" fill="#b00020">
    <path d="M6 7h12v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm13-3v2H5V4h3.5l1-1h5l1 1H19z" />
  </svg>
);

const cellPositions = [
  "Battery Loading",
  "OSV",
  "Insulator Installation",
  "Cell Stacking",
  "End Plate and Steel Frame install",
  "Cell Pole/Laser Cleaning",
  "CCS Installation",
  "Busbar/laser Welding",
  "Weld Inspection and Cleaning",
  "EOL Inspection & Testing",
  "Install Heating Film",
  "Module Line Crane Lift",
];

const assemblyPositions = [
  "Remove Carton Cover",
  "Remove Front Cover",
  "Module Gluing",
  "Module Installation",
  "Install Single Boards",
  "Install Copper Bars",
  "Cable Organization",
  "Install Crossover Copper Bars",
  "Inspection Area",
  "AOI Inspection",
  "Install Front Cover",
  "Safety Test",
  "Function Test",
  "Pre-Box QC",
  "Install Carton Cover",
  "Final Packing",
];

const minToHHMM = (m) => {
  const mm = Math.round(m);
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
};

// ===== 今日數據（依 Pacific 今日） ==========================================
const processTodayDataByLine = (records) => {
  const todayISO = pacificTodayISODate(); // "YYYY-MM-DD" in Pacific
  const todayRecords = records.filter((r) => r.start_local?.startsWith(todayISO));

  const stationData = [];
  todayRecords.forEach((r) => {
    const item = stationData.find((s) => s.station === r.station);
    if (item) {
      item.duration += r.duration_min;
      if (r.duration_min > item.maxDuration) {
        item.line = r.line;
        item.maxDuration = r.duration_min;
      }
    } else {
      stationData.push({
        station: r.station,
        duration: r.duration_min,
        line: r.line,
        maxDuration: r.duration_min,
      });
    }
  });

  const sortedStations = stationData.sort((a, b) => b.duration - a.duration).slice(0, 10);
  const labels = sortedStations.map((x) => x.station);
  const minutes = sortedStations.map((x) => Math.round(x.duration));
  const hhmm = minutes.map((m) => minToHHMM(m));

  const backgroundColors = sortedStations.map((x) =>
    x.line === "cell" ? "rgba(255, 99, 132, 0.7)" : "rgba(54, 162, 235, 0.7)"
  );
  const borderColors = sortedStations.map((x) =>
    x.line === "cell" ? "rgba(255, 99, 132, 1)" : "rgba(54, 162, 235, 1)"
  );

  return {
    labels,
    datasets: [
      {
        label: "Downtime",
        data: minutes,
        backgroundColor: backgroundColors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 4,
        barThickness: 26,
      },
    ],
    hhmm,
    lineInfo: sortedStations.map((x) => x.line),
  };
};

// ===== 最近 7 天（依 Pacific 曆法天） ========================================
const processWeekDataByLine = (records) => {
  const days = pacificLastNDaysISO(7); // oldest → newest (YYYY-MM-DD in Pacific)

  const dailyData = {};
  days.forEach((d) => (dailyData[d] = { cell: 0, assembly: 0 }));

  records.forEach((r) => {
    const recordDate = r.start_local?.split(" ")[0]; // DB 已存 Pacific local "YYYY-MM-DD HH:MM:SS"
    if (dailyData[recordDate]) {
      if (r.line === "cell") dailyData[recordDate].cell += r.duration_min;
      else if (r.line === "assembly") dailyData[recordDate].assembly += r.duration_min;
    }
  });

  const labels = days.map((d) => d.substring(5));
  const cellMinutes = days.map((d) => Math.round(dailyData[d].cell));
  const assemblyMinutes = days.map((d) => Math.round(dailyData[d].assembly));

  return {
    labels,
    datasets: [
      {
        label: "Cell Line",
        data: cellMinutes,
        backgroundColor: "rgba(255, 99, 132, 0.7)",
        borderColor: "rgba(255, 99, 132, 1)",
        borderWidth: 1,
        borderRadius: 4,
        barThickness: 20,
      },
      {
        label: "Assembly Line",
        data: assemblyMinutes,
        backgroundColor: "rgba(54, 162, 235, 0.7)",
        borderColor: "rgba(54, 162, 235, 1)",
        borderWidth: 1,
        borderRadius: 4,
        barThickness: 20,
      },
    ],
    hhmm: {
      cell: cellMinutes.map((m) => minToHHMM(m)),
      assembly: assemblyMinutes.map((m) => minToHHMM(m)),
    },
  };
};

// ============================================================================

export default function Downtime() {
  const [step, setStep] = useState(1);
  const [line, setLine] = useState("");
  const [station, setStation] = useState("");
  const [startTs, setStartTs] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [alert, setAlert] = useState(false);
  const [msg, setMsg] = useState("");

  // 圖表狀態
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

  const loadSummaries = useCallback(() => {
    api.get("/downtime/list").then((r) => {
      if (r.data.status === "success") {
        const list = r.data.records || [];
        setToday(processTodayDataByLine(list));
        setWeek(processWeekDataByLine(list));
      }
    });
  }, []);

  const loadRecords = useCallback(() => {
    api.get("/downtime/list").then((r) => {
      if (r.data.status === "success") setRecords(r.data.records || []);
    });
  }, []);

  useEffect(() => {
    loadSummaries();
    loadRecords();
  }, [loadSummaries, loadRecords]);

  // 圖表選項
  const getTodayChartOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "top",
        labels: {
          generateLabels: () => [
            {
              text: "Cell Line",
              fillStyle: "rgba(255, 99, 132, 0.7)",
              strokeStyle: "rgba(255, 99, 132, 1)",
              pointStyle: "rect",
            },
            {
              text: "Assembly Line",
              fillStyle: "rgba(54, 162, 235, 0.7)",
              strokeStyle: "rgba(54, 162, 235, 1)",
              pointStyle: "rect",
            },
          ],
          font: { size: 11 },
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const lineName =
              today.lineInfo?.[context.dataIndex] === "cell" ? "Cell Line" : "Assembly Line";
            return `${lineName}: ${today.hhmm?.[context.dataIndex] || minToHHMM(context.parsed.y)}`;
          },
        },
      },
    },
    scales: {
      y: { ticks: { callback: (v) => minToHHMM(v) } },
      x: { ticks: { padding: 4 } },
    },
  });

  const getWeekChartOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: "top", labels: { usePointStyle: true, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: (context) => {
            const isCell = context.dataset.label.includes("Cell");
            const hhmm = isCell ? week.hhmm?.cell?.[context.dataIndex] : week.hhmm?.assembly?.[context.dataIndex];
            return `${context.dataset.label}: ${hhmm || minToHHMM(context.parsed.y)}`;
          },
        },
      },
    },
    scales: {
      y: { ticks: { callback: (v) => minToHHMM(v) } },
      x: { ticks: { padding: 4 }, categoryPercentage: 0.8, barPercentage: 0.6 },
    },
  });

  // Flow
  const reset = () => {
    setStep(1);
    setLine("");
    setStation("");
    setStartTs(null);
    setElapsed(0);
    setAlert(false);
  };
  const chooseLine = (l) => {
    setLine(l);
    setStep(2);
  };
  const chooseStation = (s) => {
    setStation(s);
    setStep(3);
    setStartTs(null);
    setElapsed(0);
  };
  const startTimer = () => setStartTs(Date.now());

  // 送出（送「Pacific local 無時區字串」）
  const submit = async () => {
    try {
      const endTime = Date.now();
      const durationMin = Math.round((endTime - startTs) / 1000 / 60);

      await api.post("/downtime", {
        line,
        station,
        start_time: toPacificLocalIsoSeconds(startTs), // ← 關鍵：不要用 toISOString()
        end_time: toPacificLocalIsoSeconds(endTime),
      });

      setMsg(`✅${line === "cell" ? "Cell Line" : "Assembly Line"} – ${station} – ${durationMin} min`);

      reset();
      loadSummaries();
      loadRecords();
    } catch (e) {
      setMsg(`❌ ${e.response?.data?.message || e.message}`);
    }
  };

  // 編輯（用後端提供的 *_edit，送 naive Pacific）
  const saveEdit = async (u) => {
    try {
      await api.put(`/downtime/${u.id}`, {
        line: u.line,
        station: u.station,
        // 直接送 "YYYY-MM-DDTHH:mm"（無時區），後端會當 Pacific
        start_time: u.start_local,
        end_time: u.end_local,
      });

      setEditing(null);
      loadRecords();
      loadSummaries();
    } catch (e) {
      setMsg(`❌ ${e.response?.data?.message || e.message}`);
    }
  };

  const del = async (id) => {
    if (!window.confirm(`Delete #${id}?`)) return;
    try {
      await api.delete(`/downtime/${id}`);
      loadRecords();
      loadSummaries();
    } catch (e) {
      setMsg(`❌ ${e.response?.data?.message || e.message}`);
    }
  };

  return (
    <div className={`dt-container ${alert ? "dt-flash" : ""}`}>
      <h1 className="dt-title">Downtime Log</h1>

      {step === 1 && (
        <div className="dt-line-select">
          <button onClick={() => chooseLine("cell")}>Cell Line</button>
          <button onClick={() => chooseLine("assembly")}>Assembly Line</button>
        </div>
      )}

      {step === 2 && (
        <div className="dt-station-btns">
          {(line === "cell" ? cellPositions : assemblyPositions).map((p) => (
            <button key={p} onClick={() => chooseStation(p)}>
              {p}
            </button>
          ))}
        </div>
      )}

      {step === 3 && (
        <div className="dt-timer">
          <div className="dt-info">
            <p>
              <strong>Line:</strong> {line}
            </p>
            <p>
              <strong>Station:</strong> {station}
            </p>
          </div>
          {startTs && (
            <div className="flip-timer-wrapper">
              <FlipClockTimer seconds={elapsed} />
            </div>
          )}
          <div className="dt-timer-btns">
            {startTs ? (
              <button className="dt-end-btn" onClick={submit}>
                End &amp; Submit
              </button>
            ) : (
              <button onClick={startTimer}>Start</button>
            )}
          </div>
        </div>
      )}

      {msg && <div className="dt-msg">{msg}</div>}

      <div className="dt-charts">
        <div className="dt-chart">
          <div className="dt-chart-head">
            <button className="dt-edit-btn" onClick={() => setModalOpen(true)}>
              Edit
            </button>
            <h2 className="dt-chart-title">Today's Downtime by Station</h2>
          </div>
          <Bar data={today} options={getTodayChartOptions()} />
        </div>

        <div className="dt-chart">
          <h2 className="dt-chart-title">Past 7 Days Downtime</h2>
          <Bar data={week} options={getWeekChartOptions()} />
        </div>
      </div>

      {modalOpen && (
        <div className="dt-modal">
          <button className="dt-close" onClick={() => setModalOpen(false)}>
            ✖
          </button>
          <h3>View / Edit Downtime Records</h3>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Line</th>
                <th>Station</th>
                <th>Start</th>
                <th>End</th>
                <th>Duration</th>
                <th>By</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const isEditing = editing?.id === r.id;
                return (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>
                      {isEditing ? (
                        <input
                          value={editing.line}
                          onChange={(e) => setEditing({ ...editing, line: e.target.value })}
                        />
                      ) : (
                        r.line
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          value={editing.station}
                          onChange={(e) => setEditing({ ...editing, station: e.target.value })}
                        />
                      ) : (
                        r.station
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="datetime-local"
                          value={editing.start_local}
                          onChange={(e) => setEditing({ ...editing, start_local: e.target.value })}
                        />
                      ) : (
                        r.start_local
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="datetime-local"
                          value={editing.end_local}
                          onChange={(e) => setEditing({ ...editing, end_local: e.target.value })}
                        />
                      ) : (
                        r.end_local
                      )}
                    </td>
                    <td>{minToHHMM(r.duration_min)}</td>
                    <td>{r.modified_by || r.created_by}</td>
                    <td>
                      {isEditing ? (
                        <>
                          <button className="dt-icon-btn" onClick={() => saveEdit(editing)}>
                            <SaveIcon />
                          </button>
                          <button className="dt-icon-btn" onClick={() => setEditing(null)}>
                            <DeleteIcon />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="dt-icon-btn"
                            onClick={() =>
                              setEditing({
                                id: r.id,
                                line: r.line,
                                station: r.station,
                                // 用 *_edit 當 input 值（YYYY-MM-DDTHH:mm）
                                start_local: r.start_local_edit,
                                end_local: r.end_local_edit,
                              })
                            }
                          >
                            <EditIcon />
                          </button>
                          <button className="dt-icon-btn" onClick={() => del(r.id)}>
                            <DeleteIcon />
                          </button>
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
