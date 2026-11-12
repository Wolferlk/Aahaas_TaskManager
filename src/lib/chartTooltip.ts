/**
 * Shared styling for Recharts tooltips.
 *
 * Recharts draws a white tooltip box but lets its title (the date / department
 * name) inherit the page text colour, which in dark mode is near-white — so the
 * title all but vanished. Every colour is pinned here so it reads in either
 * theme. Spread onto any <Tooltip />: `<Tooltip {...CHART_TOOLTIP} />`.
 */
export const CHART_TOOLTIP = {
  contentStyle: { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#111827', fontWeight: 600, marginBottom: 4 },
  itemStyle: { padding: 0 },
};

/** A faint hover band for bar charts, instead of the default heavy grey block. */
export const BAR_CURSOR = { fill: 'rgba(148, 163, 184, 0.15)' };
