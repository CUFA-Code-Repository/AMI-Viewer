<script lang="ts">
  // Landing screen: pick / drop a session folder (design_doc §2).
  import { session } from '../store/session.svelte';
  import {
    isFsAccessSupported, pickDirectory, readFromDataTransfer, readFromFileList,
    hasAnyKnownFile,
  } from '../loader/loadFolder';

  let dragging = $state(false);
  let localError = $state<string | null>(null);

  async function handlePick() {
    localError = null;
    try {
      const raw = await pickDirectory();
      if (raw) await accept(raw);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') localError = (e as Error).message;
    }
  }

  async function onDrop(ev: DragEvent) {
    ev.preventDefault();
    dragging = false;
    localError = null;
    if (!ev.dataTransfer) return;
    try {
      const raw = await readFromDataTransfer(ev.dataTransfer);
      if (raw) await accept(raw);
      else localError = 'Could not read the dropped item as a folder.';
    } catch (e) {
      localError = (e as Error).message;
    }
  }

  async function onInput(ev: Event) {
    localError = null;
    const input = ev.target as HTMLInputElement;
    if (!input.files) return;
    const raw = await readFromFileList(input.files);
    if (raw) await accept(raw);
  }

  async function accept(raw: ReturnType<typeof Object> extends never ? never : any) {
    if (!hasAnyKnownFile(raw)) {
      localError = 'No AMIv2 files (sensors.csv / gps.csv / score.csv …) found in that folder.';
      return;
    }
    await session.ingest(raw);
  }
</script>

<div class="loader">
  <div
    class="dropzone"
    class:dragging
    role="button"
    tabindex="0"
    ondragover={(e) => { e.preventDefault(); dragging = true; }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
  >
    <h1>AMIv2 Flight Data Viewer</h1>
    <p class="dim">Drop a session folder copied off the SD card — or pick one.<br />
      Everything is parsed <strong>in your browser</strong>; no data leaves this machine.</p>

    <div class="actions">
      {#if isFsAccessSupported()}
        <button class="primary" onclick={handlePick}>Open folder…</button>
      {/if}
      <label class="file-btn">
        Choose folder (fallback)
        <input type="file" webkitdirectory multiple onchange={onInput} hidden />
      </label>
    </div>

    <p class="hint dim">
      Expects: <span class="mono">sensors.csv · gps.csv · score.csv · system.txt · config.txt</span>
      <br />Missing files are fine — the app opens with whatever is present.
    </p>

    {#if session.load.status === 'loading'}
      <div class="progress">
        <div class="bar" style:width={`${session.load.pct}%`}></div>
        <span>{session.load.phase}</span>
      </div>
    {/if}
    {#if session.load.status === 'error'}
      <p class="err">Load failed: {session.load.message}</p>
    {/if}
    {#if localError}
      <p class="err">{localError}</p>
    {/if}
  </div>
</div>

<style>
  .loader {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 24px;
  }
  .dropzone {
    max-width: 620px;
    width: 100%;
    text-align: center;
    border: 2px dashed var(--border);
    border-radius: 16px;
    padding: 48px 32px;
    transition: border-color 0.15s, background 0.15s;
  }
  .dropzone.dragging {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  h1 { margin: 0 0 8px; font-size: 24px; }
  .actions { display: flex; gap: 12px; justify-content: center; margin: 24px 0 8px; flex-wrap: wrap; }
  .file-btn {
    display: inline-block;
    background: var(--bg-elev2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
  }
  .file-btn:hover { border-color: var(--accent); }
  .hint { font-size: 12px; margin-top: 16px; line-height: 1.6; }
  .progress {
    margin-top: 20px;
    height: 22px;
    background: var(--bg-elev2);
    border-radius: 6px;
    position: relative;
    overflow: hidden;
  }
  .progress .bar {
    position: absolute; inset: 0 auto 0 0;
    background: var(--accent);
    transition: width 0.2s;
  }
  .progress span {
    position: relative;
    line-height: 22px;
    font-size: 12px;
    mix-blend-mode: difference;
  }
  .err { color: var(--bad); margin-top: 16px; }
</style>
