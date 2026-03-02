import React from "react";
import { Line } from "react-chartjs-2";
import RiskBadge from "./RiskBadge";
import { COL_A, COL_B, COL_A_BG, COL_B_BG } from "./DashboardConstants";

const ModuleTodayCard = ({ mod, riskData, optsLine }) => {
  const totalTrend = mod.a.map((valA, i) => (valA || 0) + (mod.b[i] || 0));

  return (
    <div className="dashboard-card">
      <h2 className="card-title">Module A/B – Today</h2>
      <h1 className="card-big right">{mod.A + mod.B}</h1>

      <RiskBadge data={riskData?.module} />

      <Line
        data={{
          labels: mod.labels,
          datasets: [
            { label: "A", data: mod.a, backgroundColor: COL_A_BG, borderColor: COL_A, tension: .3, fill: true, pointRadius: 2 },
            { label: "B", data: mod.b, backgroundColor: COL_B_BG, borderColor: COL_B, tension: .3, fill: true, pointRadius: 2 },
            {
              label: "Total",
              data: totalTrend,
              backgroundColor: "rgba(96, 125, 139, 0.1)",
              borderColor: "rgba(96, 125, 139, 0.4)",
              borderWidth: 2,
              borderDash: [5, 5],
              tension: .3,
              fill: false,
              pointRadius: 0,
              pointHoverRadius: 3
            }
          ]
        }}
        options={optsLine}
        className="chart"
      />
      {(mod.ngA > 0 || mod.ngB > 0) && (
        <div className="ng-badge">
          <span className="ng-icon">⚠</span>
          <span className="ng-text">NG: A {mod.ngA} / B {mod.ngB}</span>
          <span className="ng-rate">({((mod.ngA + mod.ngB) / (mod.A + mod.B) * 100).toFixed(1)}%)</span>
        </div>
      )}
    </div>
  );
};

export default React.memo(ModuleTodayCard);
