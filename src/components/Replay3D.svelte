<script lang="ts">
  // 3D flight replay tab (design_doc §4.4): Three.js scene of the ENU path with
  // a moving aircraft following the shared cursor, camera modes, altitude-source
  // toggle, and a HUD. Scrubbing the timeline moves the aircraft and vice-versa.
  import { onDestroy } from 'svelte';
  import { session } from '../store/session.svelte';
  import { buildFlightPath, pointIndexAtTime, type AltSource } from '../geo/project';
  // Three.js (~200 KB) is lazy-loaded so it only ships when the user opens 3D.
  import type { ReplayScene, CameraMode } from '../three/scene';

  let canvas = $state<HTMLCanvasElement>();
  let wrap = $state<HTMLDivElement>();
  let scene: ReplayScene | null = null;
  let SceneCtor: typeof ReplayScene | null = $state(null);
  let loadError = $state<string | null>(null);

  $effect(() => {
    if (SceneCtor) return;
    import('../three/scene')
      .then((m) => (SceneCtor = m.ReplayScene))
      .catch((e) => (loadError = String(e)));
  });

  let altSource = $state<AltSource>('blend');
  let camMode = $state<CameraMode>('orbit');

  const path = $derived(session.model ? buildFlightPath(session.model, altSource) : null);

  // (re)build the scene when the path (model or altitude source) changes
  $effect(() => {
    const p = path;
    const Ctor = SceneCtor;
    scene?.dispose();
    scene = null;
    if (!p || !canvas || !Ctor) return;
    scene = new Ctor(canvas, p);
    scene.setMode(camMode);
    if (wrap) scene.resize(wrap.clientWidth, wrap.clientHeight);
    // place at current cursor
    scene.update(pointIndexAtTime(p, session.cursorTimeMs));
  });

  // camera mode
  $effect(() => { scene?.setMode(camMode); });

  // follow the shared cursor. Guarded: a throw here must NOT escape the effect,
  // or it propagates out of Svelte's flush (which runs inside the Timeline's
  // requestAnimationFrame play loop) and freezes playback on every tab.
  $effect(() => {
    const t = session.cursorTimeMs;
    if (!scene || !path) return;
    try {
      scene.update(pointIndexAtTime(path, t));
    } catch (e) {
      loadError = String(e);
    }
  });

  // resize
  $effect(() => {
    if (!wrap) return;
    const ro = new ResizeObserver((e) => {
      const w = Math.floor(e[0].contentRect.width);
      const h = Math.max(320, Math.floor(e[0].contentRect.height));
      scene?.resize(w, h);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  onDestroy(() => scene?.dispose());

  const hud = $derived.by(() => {
    if (!path) return null;
    const i = pointIndexAtTime(path, session.cursorTimeMs);
    const p = path.points[i];
    return {
      alt: p.up, speed: p.speed, course: p.course,
      current: p.current, voltage: p.voltage,
    };
  });

  const modes: { id: CameraMode; label: string }[] = [
    { id: 'orbit', label: 'Orbit' },
    { id: 'chase', label: 'Chase' },
    { id: 'top', label: 'Top-down' },
  ];
  const altModes: { id: AltSource; label: string }[] = [
    { id: 'blend', label: 'Blend' },
    { id: 'baro', label: 'Baro' },
    { id: 'gps', label: 'GPS' },
  ];
</script>

<div class="replay">
  {#if path}
    <div class="toolbar">
      <span class="group">
        <span class="lbl dim">Camera</span>
        {#each modes as m}
          <button class="mini" class:active={camMode === m.id} onclick={() => (camMode = m.id)}>{m.label}</button>
        {/each}
      </span>
      <span class="group">
        <span class="lbl dim">Altitude (Z)</span>
        {#each altModes as a}
          <button class="mini" class:active={altSource === a.id} onclick={() => (altSource = a.id)}>{a.label}</button>
        {/each}
      </span>
      <span class="note dim">orbit: drag to rotate · scrub timeline to fly</span>
    </div>

    <div class="canvas-wrap" bind:this={wrap}>
      <canvas bind:this={canvas}></canvas>
      {#if !SceneCtor && !loadError}
        <div class="loading dim">Loading 3D engine…</div>
      {/if}
      {#if loadError}
        <div class="loading bad">3D engine failed to load: {loadError}</div>
      {/if}
      {#if hud}
        <div class="hud mono">
          <div>alt <b>{hud.alt.toFixed(1)}</b> m</div>
          <div>spd <b>{hud.speed.toFixed(1)}</b> km/h</div>
          <div>crs <b>{hud.course.toFixed(0)}</b>°</div>
          {#if Number.isFinite(hud.current)}<div>I <b>{hud.current.toFixed(1)}</b> A</div>{/if}
          {#if Number.isFinite(hud.voltage)}<div>V <b>{hud.voltage.toFixed(2)}</b></div>{/if}
        </div>
      {/if}
    </div>
  {:else}
    <p class="dim">No valid GPS path in this session — 3D replay unavailable.</p>
  {/if}
</div>

<style>
  .replay { display: flex; flex-direction: column; height: 100%; gap: 8px; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
  .group { display: inline-flex; align-items: center; gap: 4px; }
  .lbl { font-size: 11px; margin-right: 2px; }
  .mini { padding: 3px 10px; font-size: 12px; }
  .mini.active { background: var(--bg-elev2); border-color: var(--accent); color: var(--accent); }
  .note { font-size: 11px; margin-left: auto; }
  .canvas-wrap { position: relative; flex: 1; min-height: 320px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  canvas { display: block; width: 100%; height: 100%; }
  .hud {
    position: absolute; top: 10px; left: 10px;
    background: rgba(11,15,23,0.7); border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 10px; font-size: 12px; line-height: 1.5; pointer-events: none;
  }
  .hud b { color: var(--accent); }
  .loading { position: absolute; inset: 0; display: grid; place-content: center; font-size: 13px; }
  .bad { color: var(--bad); }
</style>
