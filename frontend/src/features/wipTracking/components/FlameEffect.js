import React from "react";

export default function FlameEffect() {
  return (
    <div
      className="absolute top-2 right-2 pointer-events-none select-none"
      aria-hidden="true"
    >
      <span className="aging-flame text-orange-500 text-xl">🔥</span>
    </div>
  );
}
