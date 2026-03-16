import { useState, useCallback, useEffect, useRef } from "react";
import api from "../../../services/api";

const STAGES = ["assembling", "aging", "fqc_passed", "shipped"];
const DEFAULT_LOADED_STAGES = ["assembling", "aging", "fqc_passed"];
const PAGE_SIZE = 50;

export default function useWIPData() {
  const [stats, setStats] = useState({ counts: {}, last_updated: {}, total: 0, today_shipped: 0, today_fqc: 0 });
  const [columns, setColumns] = useState({});
  const [offsets, setOffsets] = useState({});
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState(null);

  const isMounted = useRef(true);
  const loadedStagesRef = useRef(new Set(DEFAULT_LOADED_STAGES));
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const { data } = await api.get("wip/stats");
      if (!isMounted.current) return;
      setStats(data);
    } catch (e) {
      if (!isMounted.current) return;
      setError(e?.response?.data?.detail || "Failed to load WIP stats");
    } finally {
      if (isMounted.current) setStatsLoading(false);
    }
  }, []);

  const fetchStage = useCallback(async (stageId, append = false) => {
    setLoading((prev) => ({ ...prev, [stageId]: true }));
    const offset = append ? (offsets[stageId] || 0) : 0;
    try {
      const { data } = await api.get("wip/apower/list", {
        params: { stage: stageId, limit: PAGE_SIZE, offset },
      });
      if (!isMounted.current) return;
      setColumns((prev) => ({
        ...prev,
        [stageId]: append ? [...(prev[stageId] || []), ...data.items] : data.items,
      }));
      setTotals((prev) => ({ ...prev, [stageId]: data.total }));
      setOffsets((prev) => ({ ...prev, [stageId]: offset + data.items.length }));
      loadedStagesRef.current.add(stageId);
    } catch (e) {
      if (!isMounted.current) return;
      setError(e?.response?.data?.detail || `Failed to load stage: ${stageId}`);
    } finally {
      if (isMounted.current) setLoading((prev) => ({ ...prev, [stageId]: false }));
    }
  }, [offsets]);

  const initialLoad = useCallback(async () => {
    setError(null);
    await fetchStats();
    await Promise.all(DEFAULT_LOADED_STAGES.map((s) => fetchStage(s, false)));
  }, [fetchStats, fetchStage]);

  useEffect(() => {
    initialLoad();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const advanceStage = useCallback(async (usSn, newStage) => {
    if (newStage === "shipped") {
      return { ok: false, error: "Shipped is derived from QC shipping data" };
    }

    let fromStage = null;
    let movedCard = null;
    for (const s of STAGES) {
      const existing = (columns[s] || []).find((c) => c.us_sn === usSn);
      if (existing) {
        fromStage = s;
        movedCard = existing;
        break;
      }
    }

    if (fromStage && newStage && fromStage === newStage) {
      return { ok: true, unchanged: true };
    }

    if (fromStage) {
      setColumns((prev) => {
        const next = {
          ...prev,
          [fromStage]: (prev[fromStage] || []).filter((c) => c.us_sn !== usSn),
        };
        if (newStage && newStage !== fromStage && movedCard) {
          next[newStage] = [movedCard, ...(prev[newStage] || []).filter((c) => c.us_sn !== usSn)];
        }
        return next;
      });
    }

    try {
      const { data } = await api.put(`wip/apower/${encodeURIComponent(usSn)}/stage`, {
        new_stage: newStage || null,
      });

      const stagesToRefresh = Array.from(new Set([fromStage, data.to_stage].filter(Boolean)));
      await Promise.all(stagesToRefresh.map((stageId) => fetchStage(stageId, false)));
      await fetchStats();
      return { ok: true, toStage: data.to_stage };
    } catch (e) {
      const stagesToRefresh = Array.from(new Set([fromStage, newStage].filter(Boolean)));
      await Promise.all(stagesToRefresh.map((stageId) => fetchStage(stageId, false)));
      setError(e?.response?.data?.detail || "Failed to advance stage");
      return { ok: false, error: e?.response?.data?.detail || "Failed to advance stage" };
    }
  }, [columns, fetchStage, fetchStats]);

  const loadMore = useCallback((stageId) => {
    fetchStage(stageId, true);
  }, [fetchStage]);

  const loadStage = useCallback((stageId) => {
    fetchStage(stageId, false);
  }, [fetchStage]);

  const refresh = useCallback(() => {
    setError(null);
    fetchStats();
    Array.from(loadedStagesRef.current).forEach((s) => fetchStage(s, false));
  }, [fetchStats, fetchStage]);

  return {
    stats,
    statsLoading,
    columns,
    totals,
    loading,
    error,
    advanceStage,
    loadMore,
    loadStage,
    refresh,
  };
}
