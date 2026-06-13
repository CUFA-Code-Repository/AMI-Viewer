<script lang="ts">
  // One uPlot chart panel. Receives a PanelSpec and renders/updates a uPlot
  // instance. X-range, cursor sync, phase bands and event markers are shared
  // across all panels (design_doc §4.2).
  import { onDestroy } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { session } from '../store/session.svelte';
  import type { PanelSpec } from '../graphs/panels';
  import { buildPanelRender } from '../graphs/buildUplotData';
  import { phaseBandsPlugin, type EventMark } from '../graphs/plugins';
  import { exportPanelCsv, exportPanelPng } from '../graphs/export';

  let { panel, events }: { panel: PanelSpec; events: EventMark[] } = $props();

  let el: HTMLDivElement;
  let plot: uPlot | null = null;
  let width = $state(600);

  const bands = $derived(phaseBandsPlugin(session.model?.phases ?? []));

  function render() {
    if (!el || !session.model || !session.visibleRange) return;
    const r = session.visibleRange;
    const out = buildPanelRender(
      session.model, panel, r, width, bands, events,
      (t) => { if (t != null && !syncingFromStore) session.cursorTimeMs = t; },
    );
    if (!out) return;
    // recreate on structural change; update data on range/width change
    plot?.destroy();
    plot = new uPlot(out.opts, out.data, el);
    // apply current shared X scale
    plot.setScale('x', { min: r.minMs, max: r.maxMs });
  }

  // re-render when model, visible range, or width change
  $effect(() => {
    // touch reactive deps
    void session.model; void session.visibleRange; void width; void panel;
    render();
  });

  // when a box-zoom on this panel changes X, propagate to the shared range so
  // every panel zooms together.
  $effect(() => {
    if (!plot) return;
    const u = plot;
    const handler = () => {
      const xs = u.scales.x;
      if (xs.min != null && xs.max != null && session.visibleRange) {
        if (xs.min !== session.visibleRange.minMs || xs.max !== session.visibleRange.maxMs) {
          session.visibleRange = { minMs: xs.min, maxMs: xs.max };
        }
      }
    };
    u.over.addEventListener('mouseup', handler);
    return () => u.over.removeEventListener('mouseup', handler);
  });

  // resize observer for responsive width
  $effect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0 && Math.abs(w - width) > 2) width = w;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // drive the uPlot cursor from the shared store cursor (timeline scrub / other
  // panels / events) without feeding back into the store.
  let syncingFromStore = false;
  $effect(() => {
    const t = session.cursorTimeMs;
    if (!plot || session.visibleRange == null) return;
    const left = plot.valToPos(t, 'x');
    syncingFromStore = true;
    plot.setCursor({ left, top: plot.bbox.height / window.devicePixelRatio / 2 });
    syncingFromStore = false;
  });

  onDestroy(() => plot?.destroy());

  function pngExport() { if (plot) exportPanelPng(plot, panel.id); }
  function csvExport() {
    if (plot) exportPanelCsv(plot, panel.series.map((s) => s.label), panel.id);
  }
</script>

<div class="panel card">
  <div class="bar">
    <span class="title">{panel.title}</span>
    <span class="tools">
      <button class="mini" onclick={csvExport} title="Export visible data as CSV">CSV</button>
      <button class="mini" onclick={pngExport} title="Export panel as PNG">PNG</button>
    </span>
  </div>
  <div class="plot" bind:this={el}></div>
</div>

<style>
  .panel { padding: 8px; }
  .bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .title { font-size: 12px; color: var(--text-dim); }
  .tools { display: flex; gap: 4px; }
  .mini { padding: 2px 8px; font-size: 11px; }
  .plot { width: 100%; }
  :global(.u-legend) { font-size: 11px; }
  :global(.u-legend .u-marker) { width: 10px; height: 10px; }
</style>
