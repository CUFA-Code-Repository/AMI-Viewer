<script lang="ts">
  // Score tab (design_doc §4.3): logged score vs independent recompute side by
  // side with the delta; live what-if controls; penalty-integral breakdown; and
  // zero forensics.
  import { session } from '../store/session.svelte';
  import { scoreParams } from '../store/scoreParams.svelte';
  import { recompute, loggedFinal } from '../score/recompute';
  import { num } from '../util/format';
  import PenaltyChart from './PenaltyChart.svelte';

  // seed what-if params from this session's config once per model
  let seededFor: object | null = null;
  $effect(() => {
    const m = session.model;
    if (m && seededFor !== m) {
      scoreParams.seedFromConfig(m.config);
      seededFor = m;
    }
  });

  const logged = $derived(session.model ? loggedFinal(session.model) : null);
  const recomp = $derived(
    session.model ? recompute(session.model, scoreParams.params) : null,
  );

  const p = $derived(scoreParams.params);

  function delta(a: number | null | undefined, b: number | null | undefined): string {
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return '—';
    const d = b - a;
    const sign = d > 0 ? '+' : '';
    return `${sign}${d.toFixed(Math.abs(d) < 1 ? 3 : 1)}`;
  }
  function deltaPct(a: number | null | undefined, b: number | null | undefined): string {
    if (a == null || b == null || !a) return '';
    return `(${((b - a) / a * 100).toFixed(1)}%)`;
  }

  function zoomToZero() {
    const z = recomp?.zero;
    if (!z || !session.model) return;
    const pad = 3000;
    session.visibleRange = { minMs: z.tMs - pad, maxMs: z.tMs + pad };
    session.cursorTimeMs = z.tMs;
  }

  function reset() {
    if (session.model) scoreParams.resetToConfig(session.model.config);
  }
</script>

{#if session.model && recomp}
  <div class="score">
    <!-- A vs B comparison -->
    <div class="cmp">
      <section class="card track">
        <h3>Logged <span class="dim">(score.csv)</span></h3>
        <div class="big mono">{logged?.rawScore == null ? '—' : logged.rawScore.toFixed(1)}</div>
        <dl>
          <div><dt>Distance</dt><dd>{num(logged?.distanceM, 2, 'm')}</dd></div>
          <div><dt>P_current</dt><dd>{num(logged?.pCurrent, 4)}</dd></div>
          <div><dt>Zeroed</dt><dd>{logged?.zeroed ? 'yes' : 'no'}</dd></div>
        </dl>
      </section>

      <section class="card delta-col">
        <h3 class="dim">Δ (recomp − logged)</h3>
        <div class="big mono delta">{delta(logged?.rawScore, recomp.rawScore)}
          <span class="pct dim">{deltaPct(logged?.rawScore, recomp.rawScore)}</span></div>
        <dl>
          <div><dt>Distance</dt><dd>{delta(logged?.distanceM, recomp.distanceM)} m</dd></div>
          <div><dt>P_current</dt><dd>{delta(logged?.pCurrent, recomp.pCurrentFinal)}</dd></div>
        </dl>
        <p class="note dim">float drift / firmware divergence shows here</p>
      </section>

      <section class="card track recomp">
        <h3>Recomputed <span class="dim">(from raw)</span></h3>
        <div class="big mono">{recomp.rawScore.toFixed(1)}</div>
        <dl>
          <div><dt>Distance</dt><dd>{num(recomp.distanceM, 2, 'm')}</dd></div>
          <div><dt>P_current</dt><dd>{num(recomp.pCurrentFinal, 4)}</dd></div>
          <div><dt>B_takeoff</dt><dd>{recomp.bTakeoff.toFixed(2)}</dd></div>
        </dl>
      </section>
    </div>

    <!-- what-if controls -->
    <section class="card whatif">
      <div class="wi-head">
        <h3>What-if</h3>
        <button class="mini" onclick={reset}>Reset to config</button>
      </div>
      <div class="controls">
        <label>Payload (kg)
          <input type="number" step="0.05" min="0" bind:value={p.payloadKg} />
        </label>
        <label>Announced roll (m)
          <input type="number" step="1" bind:value={p.takeoffAnnouncedM} />
          <span class="hint dim">=40 → B 1.15</span>
        </label>
        <label>Penalty threshold (A)
          <input type="number" step="1" bind:value={p.penaltyThresholdA} />
        </label>
        <label>Penalty coef
          <input type="number" step="0.0005" bind:value={p.penaltyCoef} />
        </label>
        <label>Zero voltage (V)
          <input type="number" step="0.05" bind:value={p.zeroVoltageV} />
        </label>
        <label>Zero current (A)
          <input type="number" step="1" bind:value={p.zeroCurrentA} />
        </label>
      </div>
      <div class="formula mono dim">
        S = B·m·l²·(1−P) = {recomp.bTakeoff.toFixed(2)}·{p.payloadKg}·{recomp.distanceM.toFixed(1)}²·(1−{recomp.pCurrentFinal.toFixed(3)})
        = <strong class="ok">{recomp.rawScore.toFixed(1)}</strong>
      </div>
    </section>

    <!-- zero forensics -->
    {#if recomp.zeroed && recomp.zero}
      <section class="card zero">
        <h3 class="bad">⚠ Zero forensics</h3>
        <p>
          Flight zeroed by
          <strong>{recomp.zero.kind === 'overvoltage' ? 'over-voltage' : 'over-current'}</strong>:
          <span class="mono">{recomp.zero.value.toFixed(2)} {recomp.zero.kind === 'overvoltage' ? 'V' : 'A'}</span>
          at <span class="mono">t={((recomp.zero.tMs - session.model.summary.startMs) / 1000).toFixed(1)}s</span>
          (threshold {recomp.zero.kind === 'overvoltage' ? `${p.zeroVoltageV} V` : `${p.zeroCurrentA} A`}).
        </p>
        <button class="mini" onclick={zoomToZero}>Zoom to event</button>
      </section>
    {/if}

    <!-- penalty breakdown -->
    <section class="card">
      <h3>Penalty integral breakdown <span class="dim">∫(I − {p.penaltyThresholdA} A) dt drives P_current</span></h3>
      <PenaltyChart trace={recomp.penaltyTrace} />
    </section>
  </div>
{:else}
  <p class="dim">No score data.</p>
{/if}

<style>
  .score { display: flex; flex-direction: column; gap: 12px; overflow-y: auto; padding-right: 4px; }
  .cmp { display: grid; grid-template-columns: 1fr 0.8fr 1fr; gap: 12px; }
  .track h3, .delta-col h3, .whatif h3, .zero h3, .card h3 { margin: 0 0 8px; font-size: 14px; }
  .recomp { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
  .big { font-size: 30px; font-weight: 700; }
  .recomp .big { color: var(--accent); }
  .delta { font-size: 22px; color: var(--warn); }
  .pct { font-size: 13px; }
  dl { margin: 10px 0 0; display: flex; flex-direction: column; gap: 4px; }
  dl div { display: flex; justify-content: space-between; gap: 8px; }
  dt { color: var(--text-dim); font-size: 12px; }
  dd { margin: 0; font-family: ui-monospace, monospace; font-size: 13px; }
  .wi-head { display: flex; justify-content: space-between; align-items: center; }
  .controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--text-dim); }
  input { background: var(--bg-elev2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; font: inherit; }
  .hint { font-size: 10px; }
  .formula { margin-top: 12px; font-size: 12px; line-height: 1.6; }
  .ok { color: var(--good); }
  .mini { padding: 3px 10px; font-size: 12px; }
  .zero p { margin: 4px 0 10px; }
  .note { font-size: 11px; margin: 8px 0 0; }
  @media (max-width: 900px) { .cmp { grid-template-columns: 1fr; } }
</style>
