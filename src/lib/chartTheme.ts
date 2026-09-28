export interface ChartThemeColors {
  bg: string;
  axis: string;
  label: string;
  grid: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  markline: string;
  datazoomBg: string;
  datazoomBorder: string;
  datazoomHandle: string;
  datazoomFiller: string;
  muted: string;
  accent: string;
}

export function getThemeColors(): ChartThemeColors {
  const style = getComputedStyle(document.documentElement);
  return {
    bg: style.getPropertyValue('--chart-bg').trim(),
    axis: style.getPropertyValue('--chart-axis').trim(),
    label: style.getPropertyValue('--chart-label').trim(),
    grid: style.getPropertyValue('--chart-grid').trim(),
    tooltipBg: style.getPropertyValue('--chart-tooltip-bg').trim(),
    tooltipBorder: style.getPropertyValue('--chart-tooltip-border').trim(),
    tooltipText: style.getPropertyValue('--chart-tooltip-text').trim(),
    markline: style.getPropertyValue('--chart-markline').trim(),
    datazoomBg: style.getPropertyValue('--chart-datazoom-bg').trim(),
    datazoomBorder: style.getPropertyValue('--chart-datazoom-border').trim(),
    datazoomHandle: style.getPropertyValue('--chart-datazoom-handle').trim(),
    datazoomFiller: style.getPropertyValue('--chart-datazoom-filler').trim(),
    muted: style.getPropertyValue('--text-muted-chart').trim(),
    accent: style.getPropertyValue('--accent').trim(),
  };
}

export function getRateColors(): { up: string; down: string } {
  const style = getComputedStyle(document.documentElement);
  return {
    up: style.getPropertyValue('--rate-up').trim() || '#ef5350',
    down: style.getPropertyValue('--rate-down').trim() || '#26a69a',
  };
}
