<script lang="ts">
  // Top bar (design_doc §6): open-folder, session id, boot UTC, duration, tabs.
  import { session } from '../store/session.svelte';
  import { fmtDuration } from '../util/format';

  const s = $derived(session.model?.summary);
  const tabs: { id: typeof session.activeTab; label: string }[] = [
    { id: 'graphs', label: 'Graphs' },
    { id: 'score', label: 'Score' },
    { id: '3d', label: '3D Replay' },
    { id: 'map', label: 'Map' },
  ];
</script>

<header class="topbar">
  <button onclick={() => session.reset()}>Open folder</button>
  {#if s}
    <div class="meta mono">
      <strong>Session {s.sessionName}</strong>
      {#if s.bootUtcMs != null}<span class="dim">{session.utcLabel(s.startMs)}</span>{/if}
      <span class="dim">dur {fmtDuration(s.durationMs)}</span>
    </div>
  {/if}
  <nav class="tabs">
    {#each tabs as t}
      <button class="tab" class:active={session.activeTab === t.id}
        onclick={() => (session.activeTab = t.id)}>{t.label}</button>
    {/each}
  </nav>
</header>

<style>
  .topbar {
    display: flex; align-items: center; gap: 16px;
    padding: 8px 14px; border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
  }
  .meta { display: flex; gap: 12px; align-items: baseline; }
  .tabs { margin-left: auto; display: flex; gap: 4px; }
  .tab { background: transparent; border: 1px solid transparent; }
  .tab.active { background: var(--bg-elev2); border-color: var(--border); color: var(--accent); }
</style>
