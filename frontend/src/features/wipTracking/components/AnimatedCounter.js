import React, { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

export default function AnimatedCounter({ value = 0, className = "" }) {
  const raw     = useMotionValue(0);
  const smooth  = useSpring(raw, { stiffness: 80, damping: 20, mass: 0.8 });
  const display = useTransform(smooth, v => Math.round(v).toLocaleString());

  useEffect(() => {
    raw.set(value);
  }, [value, raw]);

  return <motion.span className={className}>{display}</motion.span>;
}
