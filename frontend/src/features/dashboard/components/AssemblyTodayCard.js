import React from "react";
import { Line } from "react-chartjs-2";
import RiskBadge from "./RiskBadge";
import { COL_APOWER2, COL_APOWER2_BG, COL_APOWERS, COL_APOWERS_BG } from "./DashboardConstants";

const AssemblyTodayCard = ({ assy, riskData, optsLine }) => {
  return (
    <div className="dashboard-card">
      <h2 className="card-title">Assembly – Today</h2>
      <h1 className="card-big right">{assy.cnt}</h1>

      <RiskBadge data={riskData?.assembly} />

      <Line
        data={{
          labels: assy.labels,
          datasets: [
            { label: "Total", data: assy.data, backgroundColor: "rgba(156, 163, 175, 0.1)", borderColor: "rgb(156, 163, 175)", tension: .3, fill: true, pointRadius: 2, borderWidth: 1, borderDash: [5, 5] },
            { label: "Apower 2", data: assy.apower2Data, backgroundColor: COL_APOWER2_BG, borderColor: COL_APOWER2, tension: .3, fill: true, pointRadius: 2 },
            { label: "Apower S", data: assy.apowerSData, backgroundColor: COL_APOWERS_BG, borderColor: COL_APOWERS, tension: .3, fill: true, pointRadius: 2 }
          ]
        }}
        options={optsLine}
        className="chart"
      />
    </div>
  );
};

export default React.memo(AssemblyTodayCard);
