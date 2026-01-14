// 所有階段的定義/標籤，供多個元件共用
import { Clock, Activity, CheckCircle } from "lucide-react";

export const classStage = [
  { key: "aging",    label: "Aging",     color: "bg-amber-500",  bgGradient: "from-amber-500 to-orange-600",  icon: Clock },
  { key: "coating",  label: "Coating",   color: "bg-cyan-600",   bgGradient: "from-cyan-600 to-teal-600",     icon: Activity },
  { key: "completed",label: "Inventory", color: "bg-green-500",  bgGradient: "from-green-500 to-emerald-600", icon: CheckCircle },
];

export const labelOf = (k) => (
  { aging: "Aging", coating: "Coating", completed: "Inventory" }[
    String(k || "").toLowerCase()
  ] || k
);
