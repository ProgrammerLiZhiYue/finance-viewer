import { useCallback, useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export function useEChart() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  const getChart = useCallback((): echarts.ECharts | null => {
    if (!chartRef.current && containerRef.current) {
      chartRef.current = echarts.init(containerRef.current);
    }
    return chartRef.current;
  }, []);

  useEffect(() => {
    const onResize = (): void => chartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return { containerRef, getChart };
}
