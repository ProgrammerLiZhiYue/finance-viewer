import { useCallback, useEffect, useRef, useState } from 'react';

interface CountdownOptions {
  /** 归零后自动回到初始值（用于总览标题栏的循环倒计时） */
  autoRestart?: boolean;
}

export function useCountdown(seconds: number, opts?: CountdownOptions) {
  const [value, setValue] = useState(seconds);
  const secondsRef = useRef(seconds);
  secondsRef.current = seconds;
  const autoRestart = opts?.autoRestart ?? false;

  useEffect(() => {
    setValue(seconds);
  }, [seconds]);

  useEffect(() => {
    const timer = setInterval(() => {
      setValue(v => (v <= 1 ? (autoRestart ? secondsRef.current : 0) : v - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [autoRestart]);

  const reset = useCallback(() => setValue(secondsRef.current), []);

  return { value, reset };
}
