<script lang="ts">
  // Data-health badges (design_doc §4.1): rows parsed per file, truncation,
  // clock wrap, GPS valid %.
  import { session } from '../store/session.svelte';
  import type { FileHealth } from '../model/types';

  const h = $derived(session.model?.health);
  const s = $derived(session.model?.summary);

  function fileBadge(name: string, fh: FileHealth | undefined) {
    if (!fh) return null;
    if (!fh.present) return { name, cls: 'warn', text: 'absent' };
    let cls = 'good';
    let text = `${fh.rowsParsed} rows`;
    if (fh.truncatedTail) { cls = 'warn'; text += ' · truncated tail'; }
    else if (fh.rowsSkipped > 0) { cls = 'warn'; text += ` · ${fh.rowsSkipped} skipped`; }
    return { name, cls, text };
  }

  const files = $derived(
    h
      ? [
          fileBadge('sensors', h.sensors),
          fileBadge('gps', h.gps),
          fileBadge('score', h.score),
          fileBadge('system', h.system),
          fileBadge('config', h.config),
        ].filter(Boolean)
      : [],
  );
</script>

<div class="badges">
  {#each files as f}
    <span class={`badge ${f!.cls}`}><strong>{f!.name}</strong> {f!.text}</span>
  {/each}

  {#if h?.clockWrap.detected}
    <span class="badge warn">⏱ clock wrap ×{h.clockWrap.count}</span>
  {/if}

  {#if s?.gpsValidPct != null}
    <span class={`badge ${s.gpsValidPct >= 95 ? 'good' : s.gpsValidPct >= 80 ? 'warn' : 'bad'}`}>
      GPS fix {s.gpsValidPct.toFixed(1)}%
    </span>
  {/if}

  {#if session.model?.config.fromDefaults}
    <span class="badge warn" title="config.txt not found — using firmware defaults">
      config = defaults assumed
    </span>
  {/if}
</div>

<style>
  .badges { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
