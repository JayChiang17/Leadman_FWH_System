// 所有階段的定義/標籤，供多個元件共用
import { Clock, Activity, CheckCircle } from "lucide-react";

export const classStage = [
  { key: "aging",    label: "Aging",     color: "bg-signal-warn",  bgGradient: "from-signal-warn/100 to-orange-600",  icon: Clock },
  { key: "coating",  label: "Coating",   color: "bg-cyan-600",   bgGradient: "from-cyan-600 to-teal-600",     icon: Activity },
  { key: "completed",label: "Inventory", color: "bg-signal-ok",  bgGradient: "from-signal-ok/100 to-emerald-600", icon: CheckCircle },
];

export const labelOf = (k) => (
  { aging: "Aging", coating: "Coating", completed: "Inventory" }[
    String(k || "").toLowerCase()
  ] || k
);
