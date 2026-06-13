<script lang="ts">
  // Overview dashboard / left rail (design_doc §4.1, §6): summary card,
  // phase strip, headline numbers, health badges, event list.
  import { session } from '../store/session.svelte';
  import { num, int, fmtDuration } from '../util/format';
  import PhaseStrip from './PhaseStrip.svelte';
  import HealthBadges from './HealthBadges.svelte';

  const s = $derived(session.model?.summary);
  const events = $derived(session.model?.events ?? []);

  const headline = $derived.by(() => {
    if (!s) return [];
    return [
      { k: 'Final RawScore', v: s.finalRawScore == null ? '—' : s.finalRawScore.toFixed(1), big: true },
      { k: 'Scored distance', v: num(s.scoredDistanceM, 1, 'm') },
      { k: 'Peak current', v: num(s.peakCurrentA, 1, 'A') },
      { k: 'Peak voltage', v: num(s.peakVoltageV, 2, 'V') },
      { k: 'Max baro alt', v: num(s.maxBaroAltM, 1, 'm') },
      { k: 'Max speed', v: num(s.maxSpeedKmh, 1, 'km/h') },
      { k: 'Satellites', v: s.satMin == null ? '—' : `${int(s.satMin)}–${int(s.satMax)}` },
      { k: 'HDOP', v: s.hdopMin == null ? '—' : `${num(s.hdopMin, 1)}–${num(s.hdopMax, 1)}` },
    ];
  });
</script>

{#if s}
  <div class="overview">
    <section class="card">
      <div class="head">
        <div>
          <div class="name">Session {s.sessionName}</div>
          <div class="dim mono">
            {#if s.bootUtcMs != null}
              boot {session.utcLabel(s.startMs) ?? '—'} ·
            {/if}
            dur {fmtDuration(s.durationMs)}
          </div>
        </div>
        {#if s.zeroFlag}
          <span class="badge bad" title={s.zeroReason ?? ''}>⚠ ZEROED</span>
        {/if}
      </div>
      {#if s.zeroFlag && s.zeroReason}
        <div class="zero-reason">{s.zeroReason}</div>
      {/if}
    </section>

    <section class="card">
      <div class="section-title">Flight phases</div>
      <PhaseStrip />
    </section>

    <section class="card">
      <div class="section-title">Headline</div>
      <div class="grid">
        {#each headline as item}
          <div class="stat" class:big={item.big}>
            <div class="stat-k dim">{item.k}</div>
            <div class="stat-v mono">{item.v}</div>
          </div>
        {/each}
      </div>
    </section>

    <section class="card">
      <div class="section-title">Data health</div>
      <HealthBadges />
    </section>

    <section class="card events">
      <div class="section-title">Events ({events.length})</div>
      <ul>
        {#each events as e}
          <li>
            <button class="evt" onclick={() => e.tMs != null && (session.cursorTimeMs = e.tMs)}>
              <span class="evt-name mono">{e.name}</span>
              <span class="dim mono">{e.tMs != null ? fmtDuration(e.tMs - s.startMs) : '—'}</span>
            </button>
          </li>
        {/each}
        {#if events.length === 0}
          <li class="dim">No system events.</li>
        {/if}
      </ul>
    </section>
  </div>
{/if}

<style>
  .overview { display: flex; flex-direction: column; gap: 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .name { font-weight: 700; font-size: 16px; }
  .section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); margin-bottom: 8px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
  .stat-k { font-size: 11px; }
  .stat-v { font-size: 15px; font-weight: 600; }
  .stat.big { grid-column: 1 / -1; }
  .stat.big .stat-v { font-size: 22px; color: var(--accent); }
  .zero-reason { margin-top: 8px; color: var(--bad); font-size: 12px; }
  .events ul { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; }
  .events li { margin: 0; }
  .evt {
    width: 100%; display: flex; justify-content: space-between; gap: 8px;
    background: transparent; border: none; border-bottom: 1px solid var(--border);
    padding: 6px 2px; text-align: left; border-radius: 0;
  }
  .evt:hover { background: var(--bg-elev2); border-color: var(--border); }
  .evt-name { font-size: 12px; }
</style>
