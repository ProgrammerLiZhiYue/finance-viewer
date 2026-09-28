import { useEffect, useRef } from 'react';

export function useAutoRefresh(seconds: number, callback: () => void): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const timer = setInterval(() => callbackRef.current(), seconds * 1000);
    return () => clearInterval(timer);
  }, [seconds]);
}
