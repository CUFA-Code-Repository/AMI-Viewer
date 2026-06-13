// Per-panel CSV / PNG export (design_doc §4.2 "CSV/PNG export of any panel").
import type uPlot from 'uplot';

export function exportPanelPng(u: uPlot, name: string): void {
  // uPlot draws to a canvas inside its root; grab it.
  const canvas = u.root.querySelector('canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    downloadBlob(blob, `${name}.png`);
  });
}

export function exportPanelCsv(u: uPlot, labels: string[], name: string): void {
  const data = u.data;
  const rows: string[] = [];
  rows.push(['time_ms', ...labels].join(','));
  const n = data[0].length;
  for (let i = 0; i < n; i++) {
    const cells: string[] = [String(data[0][i])];
    for (let s = 1; s < data.length; s++) {
      const v = data[s][i];
      cells.push(v == null ? '' : String(v));
    }
    rows.push(cells.join(','));
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  downloadBlob(blob, `${name}.csv`);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
