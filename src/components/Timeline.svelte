<script lang="ts">
  // Shared bottom timeline + cursor (design_doc §6): one scrubber drives all
  // views. Play/pause/speed scaffolding ready for Graphs/3D sync in later phases.
  import { session } from '../store/session.svelte';
  import { fmtClock } from '../util/format';
  import { PHASE_COLORS } from '../util/phaseColors';

  const s = $derived(session.model?.summary);
  const phases = $derived(session.model?.phases ?? []);

  let playing = $state(false);
  let speed = $state(1);
  const speeds = [0.25, 0.5, 1, 2, 5, 10];
  let rafId = 0;
  let lastTs = 0;

  function pct(ms: number): number {
    if (!s) return 0;
    const span = Math.max(1, s.endMs - s.startMs);
    return ((ms - s.startMs) / span) * 100;
  }

  function onScrub(ev: Event) {
    if (!s) return;
    const v = Number((ev.target as HTMLInputElement).value);
    session.cursorTimeMs = s.startMs + (v / 1000) * (s.endMs - s.startMs);
  }

  function tick(ts: number) {
    if (!playing || !s) return;
    if (lastTs) {
      const dt = (ts - lastTs) * speed;
      let next = session.cursorTimeMs + dt;
      if (next >= s.endMs) { next = s.endMs; playing = false; }
      session.cursorTimeMs = next;
    }
    lastTs = ts;
    if (playing) rafId = requestAnimationFrame(tick);
  }

  function togglePlay() {
    if (!s) return;
    if (session.cursorTimeMs >= s.endMs) session.cursorTimeMs = s.startMs;
    playing = !playing;
    lastTs = 0;
    if (playing) rafId = requestAnimationFrame(tick);
    else cancelAnimationFrame(rafId);
  }

  $effect(() => () => cancelAnimationFrame(rafId));

  const sliderVal = $derived(s ? pct(session.cursorTimeMs) * 10 : 0);
</script>

<footer class="timeline">
  <button onclick={() => s && (session.cursorTimeMs = s.startMs)} title="Start">◀◀</button>
  <button onclick={togglePlay} class="play">{playing ? '❚❚' : '▶'}</button>
  <button onclick={() => s && (session.cursorTimeMs = s.endMs)} title="End">▶▶</button>

  <div class="track">
    {#each phases as p}
      <div class="band" style:left={`${pct(p.startMs)}%`}
        style:width={`${pct(p.endMs) - pct(p.startMs)}%`}
        style:background={PHASE_COLORS[p.phase]}></div>
    {/each}
    <input type="range" min="0" max="1000" value={sliderVal}
      oninput={onScrub} disabled={!s} aria-label="Timeline scrubber" />
  </div>

  <select bind:value={speed} title="Playback speed">
    {#each speeds as sp}<option value={sp}>{sp}×</option>{/each}
  </select>

  <span class="t mono">
    t={fmtClock(s ? session.cursorTimeMs - s.startMs : 0)}
    {#if session.utcLabel(session.cursorTimeMs)}
      <span class="dim">· {session.utcLabel(session.cursorTimeMs)}</span>
    {/if}
  </span>
</footer>

<style>
  .timeline {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 14px; border-top: 1px solid var(--border);
    background: var(--bg-elev);
  }
  .play { min-width: 44px; }
  .track { position: relative; flex: 1; height: 28px; display: flex; align-items: center; }
  .band { position: absolute; top: 4px; bottom: 4px; opacity: 0.25; border-radius: 2px; }
  .track input[type='range'] {
    position: relative; width: 100%; margin: 0; background: transparent; z-index: 1;
  }
  .t { min-width: 180px; text-align: right; font-size: 13px; }
  select { background: var(--bg-elev2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 4px; }
</style>
