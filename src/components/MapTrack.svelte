<script lang="ts">
  // Offline ground-track map (design_doc §4.4, §5.5). Draws the GPS path on a
  // canvas in local ENU metres — no tiles, no network, works fully offline.
  // Phase-colored path, scored DISTANCE segment highlighted with cumulative
  // length, grid + scale bar, cursor marker, click-to-seek the shared cursor.
  import { session } from '../store/session.svelte';
  import { buildFlightPath, pointIndexAtTime, type FlightPath } from '../geo/project';
  import { PHASE_COLORS } from '../util/phaseColors';
  import { PHASE_ORDER } from '../model/types';

  let canvas = $state<HTMLCanvasElement>();
  let wrap = $state<HTMLDivElement>();
  let W = $state(600), H = $state(400);

  const path = $derived(session.model ? buildFlightPath(session.model, 'blend') : null);

  // view transform: fit ENU bounds into the canvas with padding, equal scale
  interface View { ox: number; oy: number; scale: number; }
  function computeView(p: FlightPath, w: number, h: number): View {
    const pad = 40;
    const spanE = Math.max(1, p.bounds.maxE - p.bounds.minE);
    const spanN = Math.max(1, p.bounds.maxN - p.bounds.minN);
    const scale = Math.min((w - 2 * pad) / spanE, (h - 2 * pad) / spanN);
    // center
    const cE = (p.bounds.minE + p.bounds.maxE) / 2;
    const cN = (p.bounds.minN + p.bounds.maxN) / 2;
    return { ox: w / 2 - cE * scale, oy: h / 2 + cN * scale, scale };
  }
  // screen: x = ox + e*scale ; y = oy - n*scale  (north up)
  const toX = (v: View, e: number) => v.ox + e * v.scale;
  const toY = (v: View, n: number) => v.oy - n * v.scale;

  function draw() {
    if (!canvas || !path) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0f17';
    ctx.fillRect(0, 0, W, H);

    const v = computeView(path, W, H);

    drawGrid(ctx, v);

    // path, segment-colored by phase
    const pts = path.points;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      ctx.beginPath();
      ctx.moveTo(toX(v, pts[i - 1].e), toY(v, pts[i - 1].n));
      ctx.lineTo(toX(v, pts[i].e), toY(v, pts[i].n));
      const ph = pts[i].phase;
      ctx.strokeStyle = ph >= 0 ? PHASE_COLORS[PHASE_ORDER[ph]] : '#64748b';
      ctx.stroke();
    }

    // scored DISTANCE segment: thick highlight
    if (path.distanceSeg) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(34,197,94,0.55)';
      ctx.beginPath();
      const { start, end } = path.distanceSeg;
      ctx.moveTo(toX(v, pts[start].e), toY(v, pts[start].n));
      for (let i = start + 1; i <= end; i++) ctx.lineTo(toX(v, pts[i].e), toY(v, pts[i].n));
      ctx.stroke();
    }

    // takeoff marker
    ctx.fillStyle = '#e6edf3';
    ctx.beginPath();
    ctx.arc(toX(v, pts[0].e), toY(v, pts[0].n), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText('takeoff', toX(v, pts[0].e) + 6, toY(v, pts[0].n) - 6);

    // cursor marker
    const ci = pointIndexAtTime(path, session.cursorTimeMs);
    const cp = pts[ci];
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(toX(v, cp.e), toY(v, cp.n), 6, 0, Math.PI * 2);
    ctx.fill();
    // heading tick
    const hd = (cp.course * Math.PI) / 180;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(toX(v, cp.e), toY(v, cp.n));
    ctx.lineTo(toX(v, cp.e) + Math.sin(hd) * 16, toY(v, cp.n) - Math.cos(hd) * 16);
    ctx.stroke();

    drawScaleBar(ctx, v);
  }

  function drawGrid(ctx: CanvasRenderingContext2D, v: View) {
    // grid every "nice" metric step
    const targetPx = 80;
    const mPerPx = 1 / v.scale;
    const raw = targetPx * mPerPx;
    const step = niceStep(raw);
    ctx.strokeStyle = 'rgba(148,163,184,0.10)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(148,163,184,0.5)';
    ctx.font = '10px ui-monospace, monospace';
    // vertical lines (constant E)
    const e0 = Math.floor(((0 - v.ox) / v.scale) / step) * step;
    for (let e = e0; toX(v, e) < W; e += step) {
      const x = toX(v, e);
      if (x < 0) continue;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.fillText(`${e | 0}m`, x + 2, H - 4);
    }
    // horizontal lines (constant N)
    const n0 = Math.floor(((v.oy - H) / v.scale) / step) * step;
    for (let n = n0; toY(v, n) > 0; n += step) {
      const y = toY(v, n);
      if (y > H) continue;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillText(`${n | 0}m`, 2, y - 2);
    }
  }

  function drawScaleBar(ctx: CanvasRenderingContext2D, v: View) {
    const barM = niceStep(100 / v.scale);
    const px = barM * v.scale;
    const x = W - px - 16, y = H - 20;
    ctx.strokeStyle = '#e6edf3'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y); ctx.stroke();
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(`${barM} m`, x + px / 2 - 12, y - 4);
  }

  function niceStep(raw: number): number {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    const nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return nice * pow;
  }

  function onClick(ev: MouseEvent) {
    if (!path || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const v = computeView(path, W, H);
    // nearest path point in screen space
    let best = -1, bestD = Infinity;
    for (let i = 0; i < path.points.length; i++) {
      const dx = toX(v, path.points[i].e) - mx;
      const dy = toY(v, path.points[i].n) - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) session.cursorTimeMs = path.points[best].tMs;
  }

  $effect(() => { void path; void session.cursorTimeMs; void W; void H; draw(); });

  $effect(() => {
    if (!wrap) return;
    const ro = new ResizeObserver((e) => {
      W = Math.floor(e[0].contentRect.width);
      H = Math.max(300, Math.floor(e[0].contentRect.height));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  const segLen = $derived.by(() => {
    if (!path?.distanceSeg) return null;
    let d = 0;
    const { start, end } = path.distanceSeg;
    for (let i = start + 1; i <= end; i++) {
      const a = path.points[i - 1], b = path.points[i];
      d += Math.hypot(b.e - a.e, b.n - a.n);
    }
    return d;
  });
</script>

<div class="map">
  {#if path}
    <div class="legend">
      {#each PHASE_ORDER as ph}
        <span class="chip"><i style:background={PHASE_COLORS[ph]}></i>{ph}</span>
      {/each}
      {#if segLen != null}
        <span class="chip dim">scored DISTANCE ≈ {segLen.toFixed(0)} m</span>
      {/if}
      <span class="chip dim">offline · local ENU metres · click to seek</span>
    </div>
    <div class="canvas-wrap" bind:this={wrap}>
      <canvas bind:this={canvas} onclick={onClick} style:width="100%" style:height="100%"></canvas>
    </div>
  {:else}
    <p class="dim">No valid GPS path in this session — map unavailable.</p>
  {/if}
</div>

<style>
  .map { display: flex; flex-direction: column; height: 100%; gap: 8px; }
  .legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; align-items: center; }
  .chip { display: inline-flex; align-items: center; gap: 5px; }
  .chip i { width: 12px; height: 3px; border-radius: 2px; display: inline-block; }
  .canvas-wrap { flex: 1; min-height: 300px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  canvas { display: block; cursor: crosshair; }
</style>
