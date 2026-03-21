import React from "react";
import { Bar } from "react-chartjs-2";
import { WK_A, WK_B, COL_PLAN_BG, COL_PLAN } from "./DashboardConstants";

const datalabelsCfg = (color = '#8d93a5') => ({
  display: true,
  anchor: 'center',
  align: 'center',
  formatter: (value) => value || '',
  font: { size: 12, weight: 'bold' },
  color
});

const ModuleWeeklyKPICard = ({
  week, planOpen, planEdit,
  setPlanOpen, setPlanEdit, savePlan,
  optsBar, chartRef
}) => {
  return (
    <div className="dashboard-card">
      <h2 className="card-title">
        Module – Weekly Production Target
        <span className="plan-toggle" onClick={e => { e.stopPropagation(); setPlanOpen(!planOpen); }}>⚙ Planned</span>
      </h2>

      <div className="chart-wrapper">
        <Bar
          ref={chartRef}
          data={{
            labels: week.labels,
            datasets: [
              {
                label: "Actual A",
                data: week.a.map(v => v || null),
                backgroundColor: WK_A,
                stack: "act",
                order: 1,
                datalabels: datalabelsCfg('#8d93a5')
              },
              {
                label: "Actual B",
                data: week.b.map(v => v || null),
                backgroundColor: WK_B,
                stack: "act",
                order: 2,
                datalabels: datalabelsCfg('#8d93a5')
              },
              {
                label: "Planned",
                data: week.plan.slice(0, week.labels.length),
                backgroundColor: COL_PLAN_BG,
                borderColor: COL_PLAN,
                borderWidth: 1,
                stack: "plan",
                order: 99,
                datalabels: datalabelsCfg('#8d93a5')
              },
            ]
          }}
          options={optsBar}
          className="chart"
        />
      </div>
      {planOpen && (
        <div className="plan-inputs" onKeyDown={e => e.key === "Enter" && savePlan()}>
          {week.labels.map((d, i) => (
            <div className="plan-row" key={d}>
              <span>{d}</span>
              <input
                type="number"
                value={planEdit[i]}
                onChange={e => {
                  const n = Number(e.target.value);
                  if (!isNaN(n)) setPlanEdit(p => p.map((x, idx) => (idx === i ? n : x)));
                }}
              />
            </div>
          ))}
          <button className="save-btn" onClick={savePlan}>Save</button>
        </div>
      )}
    </div>
  );
};

export default React.memo(ModuleWeeklyKPICard);
