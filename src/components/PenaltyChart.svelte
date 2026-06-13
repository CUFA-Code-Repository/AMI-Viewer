<script lang="ts">
  // Penalty-integral breakdown (design_doc §4.3): the shaded area of (I − thresh)
  // over time is the integral that drives P_current; the cumulative P_current is
  // overlaid on a second axis. Shares the global cursor.
  import { onDestroy } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { session } from '../store/session.svelte';
  import type { PenaltyPoint } from '../score/recompute';
  import { cursorSyncPlugin, phaseBandsPlugin } from '../graphs/plugins';

  let { trace }: { trace: PenaltyPoint[] } = $props();

  let el: HTMLDivElement;
  let plot: uPlot | null = null;
  let width = $state(600);
  let syncing = false;

  function render() {
    if (!el || !session.visibleRange) return;
    plot?.destroy();
    const r = session.visibleRange;

    // decimate trace to width buckets keeping the excess silhouette
    const xs: number[] = [];
    const excess: (number | null)[] = [];
    const pcur: (number | null)[] = [];
    const cols = Math.max(200, Math.floor(width));
    const bw = Math.max(1, (r.maxMs - r.minMs) / cols);
    let b = -1;
    for (const p of trace) {
      if (p.tMs < r.minMs || p.tMs > r.maxMs) continue;
      const bi = Math.floor((p.tMs - r.minMs) / bw);
      if (bi !== b) { xs.push(p.tMs); excess.push(p.excessA); pcur.push(p.pCurrent); b = bi; }
      else {
        // keep the max excess within the bucket (worst second)
        const last = excess.length - 1;
        if (p.excessA > (excess[last] ?? 0)) { excess[last] = p.excessA; xs[last] = p.tMs; }
        pcur[excess.length - 1] = p.pCurrent;
      }
    }

    const opts: uPlot.Options = {
      width, height: 170,
      scales: { x: { time: false }, y: {}, yP: { range: [0, 1] } },
      series: [
        {},
        { label: 'I − thresh (A)', stroke: '#ef4444', fill: 'rgba(239,68,68,0.25)', width: 1, scale: 'y', points: { show: false } },
        { label: 'P_current', stroke: '#38bdf8', width: 1.5, scale: 'yP', points: { show: false } },
      ],
      axes: [
        { scale: 'x', stroke: '#94a3b8', grid: { stroke: 'rgba(148,163,184,0.12)' },
          values: (_u, vals) => vals.map((v) => `${((v - r.minMs) / 1000).toFixed(0)}s`) },
        { scale: 'y', stroke: '#94a3b8', side: 3, label: 'A over threshold', grid: { stroke: 'rgba(148,163,184,0.08)' }, size: 50 },
        { scale: 'yP', stroke: '#94a3b8', side: 1, label: 'P', size: 40 },
      ],
      cursor: { sync: { key: 'ami-graphs', setSeries: false }, drag: { x: true, y: false } },
      legend: { show: true, live: true },
      plugins: [
        phaseBandsPlugin(session.model?.phases ?? []),
        cursorSyncPlugin((t) => { if (t != null && !syncing) session.cursorTimeMs = t; }),
      ],
    };
    plot = new uPlot(opts, [xs as any, excess as any, pcur as any], el);
    plot.setScale('x', { min: r.minMs, max: r.maxMs });
  }

  $effect(() => { void trace; void session.visibleRange; void width; void session.model; render(); });

  $effect(() => {
    const t = session.cursorTimeMs;
    if (!plot) return;
    syncing = true;
    plot.setCursor({ left: plot.valToPos(t, 'x'), top: 0 });
    syncing = false;
  });

  $effect(() => {
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      const w = Math.floor(e[0].contentRect.width);
      if (w > 0 && Math.abs(w - width) > 2) width = w;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  onDestroy(() => plot?.destroy());
</script>

<div class="pen" bind:this={el}></div>

<style>
  .pen { width: 100%; }
</style>
