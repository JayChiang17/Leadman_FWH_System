import { useState, useCallback, useEffect, useRef } from "react";
import api from "../../../services/api";

export default function useBatteryInventory() {
  const [batteries, setBatteries] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("wip/battery/stats");
      if (!isMounted.current) return;
      setBatteries(data.batteries || []);
    } catch (e) {
      if (!isMounted.current) return;
      setError(e?.response?.data?.detail || "Failed to load battery stats");
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const adjust = useCallback(async ({ kind, delta, reason }) => {
    try {
      await api.post("wip/battery/adjust", { kind, delta, reason });
      await fetchStats();
      return { ok: true };
    } catch (e) {
      const msg = e?.response?.data?.detail || "Adjustment failed";
      setError(msg);
      return { ok: false, error: msg };
    }
  }, [fetchStats]);

  return { batteries, loading, error, adjust, refresh: fetchStats };
}
