import React from "react";
import { Bar } from "react-chartjs-2";
import { COL_APOWER2, COL_APOWERS, COL_PLAN_BG, COL_PLAN } from "./DashboardConstants";

const datalabelsCfg = (color = '#8d93a5') => ({
  display: true,
  anchor: 'center',
  align: 'center',
  formatter: (value) => value || '',
  font: { size: 12, weight: 'bold' },
  color
});

const AssemblyWeeklyKPICard = ({
  assyWeek, assyPlanOpen, assyPlanEdit,
  setAssyPlanOpen, setAssyPlanEdit, saveAssyPlan,
  optsBar, chartRef
}) => {
  return (
    <div className="dashboard-card">
      <h2 className="card-title">
        Assembly – Weekly Production Target
        <span className="plan-toggle" onClick={e => { e.stopPropagation(); setAssyPlanOpen(!assyPlanOpen); }}>⚙ Planned</span>
      </h2>

      <div className="chart-wrapper">
        <Bar
          ref={chartRef}
          data={{
            labels: assyWeek.labels,
            datasets: [
              {
                label: "Apower 2",
                data: assyWeek.apower2.map(v => v || null),
                backgroundColor: COL_APOWER2,
                stack: "act",
                order: 2,
                datalabels: datalabelsCfg('#8d93a5')
              },
              {
                label: "Apower S",
                data: assyWeek.apowerS.map(v => v || null),
                backgroundColor: COL_APOWERS,
                stack: "act",
                order: 3,
                datalabels: datalabelsCfg('#8d93a5')
              },
              {
                label: "Planned",
                data: assyWeek.plan.slice(0, assyWeek.labels.length),
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
      {assyPlanOpen && (
        <div className="plan-inputs" onKeyDown={e => e.key === "Enter" && saveAssyPlan()}>
          {assyWeek.labels.map((d, i) => (
            <div className="plan-row" key={d}>
              <span>{d}</span>
              <input
                type="number"
                value={assyPlanEdit[i]}
                onChange={e => {
                  const n = Number(e.target.value);
                  if (!isNaN(n)) setAssyPlanEdit(p => p.map((x, idx) => (idx === i ? n : x)));
                }}
              />
            </div>
          ))}
          <button className="save-btn" onClick={saveAssyPlan}>Save</button>
        </div>
      )}
    </div>
  );
};

export default React.memo(AssemblyWeeklyKPICard);
