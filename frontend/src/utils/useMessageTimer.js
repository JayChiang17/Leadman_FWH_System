import { useState, useRef, useCallback } from "react";

/**
 * Shared hook for timed status messages.
 * Returns [message, showMessage] where message is {text, type}.
 */
export default function useMessageTimer(defaultDuration = 4000) {
  const [message, setMessage] = useState({ text: "", type: "" });
  const timerRef = useRef(null);

  const showMessage = useCallback((text, type = "info", duration = defaultDuration) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setMessage({ text, type });
    timerRef.current = setTimeout(() => {
      setMessage({ text: "", type: "" });
      timerRef.current = null;
    }, duration);
  }, [defaultDuration]);

  return [message, showMessage];
}
