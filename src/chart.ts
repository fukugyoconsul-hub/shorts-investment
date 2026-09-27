export type ChartData = {
  segmentId: string;
  title: string;
  label: string;
  unit: string;
  decimals: number;
  source: string;
  points: { t: string; v: number }[];
};

export const chart: ChartData | null = null;
