<script lang="ts">
  // Graphs tab (design_doc §4.2): a stacked, time-synchronized multi-panel view.
  // All panels share X-range + cursor via the central store; phase bands and
  // event markers give flight-phase context across every panel.
  import { session } from '../store/session.svelte';
  import { buildPanels } from '../graphs/panels';
  import type { EventMark } from '../graphs/plugins';
  import Panel from './Panel.svelte';

  const panels = $derived(session.model ? buildPanels(session.model) : []);

  // event markers: system events + the zero event (design_doc §4.2)
  const events = $derived.by<EventMark[]>(() => {
    const m = session.model;
    if (!m) return [];
    const out: EventMark[] = [];
    for (const e of m.events) {
      if (e.tMs == null) continue;
      const isBoot = e.name === 'boot';
      out.push({
        tMs: e.tMs,
        label: e.name,
        color: isBoot ? 'rgba(56,189,248,0.7)' : 'rgba(148,163,184,0.7)',
      });
    }
    // zero event: first sample over threshold (from summary reason timestamp)
    if (m.summary.zeroFlag && m.score) {
      for (let i = 0; i < m.score.n; i++) {
        if (m.score.zeroFlag[i]) {
          out.push({ tMs: m.score.t[i], label: 'zero', color: 'rgba(239,68,68,0.9)' });
          break;
        }
      }
    }
    return out;
  });

  function resetZoom() {
    if (session.model) {
      const s = session.model.summary;
      session.visibleRange = { minMs: s.startMs, maxMs: s.endMs };
    }
  }

  const zoomed = $derived.by(() => {
    const m = session.model, r = session.visibleRange;
    if (!m || !r) return false;
    return r.minMs > m.summary.startMs + 1 || r.maxMs < m.summary.endMs - 1;
  });
</script>

<div class="graphs">
  <div class="toolbar">
    <span class="dim">{panels.length} panels · box-drag to zoom (all panels) · hover for synced readouts</span>
    <button class="mini" onclick={resetZoom} disabled={!zoomed}>Reset zoom</button>
  </div>
  <div class="stack">
    {#each panels as panel (panel.id)}
      <Panel {panel} {events} />
    {/each}
    {#if panels.length === 0}
      <p class="dim">No plottable data in this session.</p>
    {/if}
  </div>
</div>

<style>
  .graphs { display: flex; flex-direction: column; height: 100%; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; padding: 0 2px 8px; font-size: 12px; }
  .stack { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding-right: 4px; }
  .mini { padding: 3px 10px; font-size: 12px; }
</style>
