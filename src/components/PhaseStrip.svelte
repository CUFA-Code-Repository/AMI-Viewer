<script lang="ts">
  // Phase timeline strip (design_doc §4.1): IDLE → CLIMBING → DISTANCE → LANDING
  // with durations, proportional widths, click-to-seek the shared cursor.
  import { session } from '../store/session.svelte';
  import { PHASE_COLORS } from '../util/phaseColors';
  import { fmtDuration } from '../util/format';

  const phases = $derived(session.model?.phases ?? []);
  const span = $derived.by(() => {
    const s = session.model?.summary;
    return s ? Math.max(1, s.endMs - s.startMs) : 1;
  });
  const startMs = $derived(session.model?.summary.startMs ?? 0);
</script>

{#if phases.length}
  <div class="strip" role="list">
    {#each phases as p}
      {@const w = ((p.endMs - p.startMs) / span) * 100}
      <button
        class="seg"
        style:width={`${w}%`}
        style:background={PHASE_COLORS[p.phase]}
        title={`${p.phase} — ${fmtDuration(p.endMs - p.startMs)}`}
        onclick={() => (session.cursorTimeMs = p.startMs)}
      >
        <span class="lbl">{p.phase}</span>
        <span class="dur">{fmtDuration(p.endMs - p.startMs)}</span>
      </button>
    {/each}
  </div>
  <div class="axis dim mono">
    <span>+0s</span>
    <span>+{fmtDuration(span)}</span>
  </div>
{:else}
  <p class="dim">No phase data (sensors.csv missing).</p>
{/if}

<style>
  .strip {
    display: flex;
    height: 44px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .seg {
    border: none;
    border-radius: 0;
    padding: 4px 6px;
    color: #04121c;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    min-width: 0;
    overflow: hidden;
    cursor: pointer;
  }
  .seg:hover { filter: brightness(1.1); border: none; }
  .lbl { font-weight: 700; font-size: 11px; white-space: nowrap; }
  .dur { font-size: 10px; opacity: 0.8; white-space: nowrap; }
  .axis { display: flex; justify-content: space-between; font-size: 11px; margin-top: 4px; }
</style>
