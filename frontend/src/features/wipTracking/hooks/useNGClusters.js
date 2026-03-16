import { useState, useCallback, useEffect, useRef } from "react";
import api from "../../../services/api";

export default function useNGClusters() {
  const [clusters, setClusters] = useState([]);
  const [totalNG, setTotalNG] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchClusters = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("ml/ng-clusters");
      if (!isMounted.current) return;
      setClusters(data.clusters || []);
      setTotalNG(data.total_ng || 0);
    } catch (e) {
      if (!isMounted.current) return;
      setError(e?.response?.data?.detail || "Failed to load NG clusters");
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  const [retraining, setRetraining] = useState(false);
  const [retrainMsg, setRetrainMsg] = useState(null);

  const triggerRetrain = useCallback(async () => {
    setRetraining(true);
    setRetrainMsg(null);
    try {
      const { data } = await api.post("ml/retrain");
      setRetrainMsg(data.message || "Retrain started");
      // Wait a bit then poll for clusters (training runs in background)
      const poll = async (tries) => {
        if (!isMounted.current || tries <= 0) return;
        await new Promise(r => setTimeout(r, 3000));
        await fetchClusters();
        // If still empty, keep polling
        if (tries > 1) poll(tries - 1);
      };
      poll(5); // up to 15s
    } catch (e) {
      setRetrainMsg(e?.response?.data?.detail || "Retrain failed");
    } finally {
      if (isMounted.current) setRetraining(false);
    }
  }, [fetchClusters]);

  // Don't auto-fetch on mount; caller triggers fetch explicitly
  return { clusters, totalNG, loading, error, refresh: fetchClusters, triggerRetrain, retraining, retrainMsg };
}
