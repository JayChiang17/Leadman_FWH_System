import React from "react";
import { badgeBox, getRiskColor } from "./DashboardConstants";

const RiskBadge = ({ data }) => {
  if (!data?.risk_level || data.risk_level === "none") return null;

  const flash = data.risk_level === "red" ? "pulse 2s infinite" : "none";
  const isZeroRate = (data.current_rate ?? 0) === 0;

  return (
    <div
      style={{
        ...badgeBox,
        backgroundColor: getRiskColor(data.risk_level),
        animation: flash,
      }}
    >
      <span
        style={{
          padding: "2px 8px",
          background: "rgba(255,255,255,.2)",
          borderRadius: "12px",
        }}
      >
        {data.frozen ? "ACHIEVED" : data.risk.toUpperCase()}
      </span>

      {!data.frozen && (
        <span style={{ fontSize: "10px", opacity: 0.9 }}>
          {!isZeroRate ? (
            <>
              {data.current_rate?.toFixed(1) ?? "--"} pcs/h&nbsp;
              ·&nbsp;need&nbsp;
              {data.need_rate?.toFixed(1) ?? "--"} pcs/h
            </>
          ) : (
            <>Need {data.need_rate?.toFixed(1) ?? "--"} pcs/h to start</>
          )}
        </span>
      )}

      {data.frozen && !isZeroRate && (
        <span style={{ fontSize: "10px", opacity: 0.9 }}>
          {data.current_rate?.toFixed(1) ?? "--"} pcs/h
        </span>
      )}
    </div>
  );
};

export default React.memo(RiskBadge);
