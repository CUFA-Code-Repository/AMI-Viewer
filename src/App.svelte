<script lang="ts">
  // App shell (design_doc §6): top bar · left overview rail · tabbed main area ·
  // shared bottom timeline. Graphs/Score/3D/Map arrive in later build phases.
  import { session } from './store/session.svelte';
  import FolderLoader from './components/FolderLoader.svelte';
  import TopBar from './components/TopBar.svelte';
  import Overview from './components/Overview.svelte';
  import Timeline from './components/Timeline.svelte';
  import TabPlaceholder from './components/TabPlaceholder.svelte';
  import SyncGraphs from './components/SyncGraphs.svelte';

  const ready = $derived(session.load.status === 'ready' && session.model != null);
  const hasGps = $derived(!!session.model?.gps && session.model.gps.n > 0);
</script>

{#if !ready}
  <FolderLoader />
{:else}
  <div class="app">
    <TopBar />
    <div class="body">
      <aside class="rail"><Overview /></aside>
      <main class="content">
        {#if session.activeTab === 'graphs'}
          <SyncGraphs />
        {:else if session.activeTab === 'score'}
          <TabPlaceholder title="Score Analysis" phase="Phase 3"
            note="Logged vs independently recomputed score, penalty-integral breakdown, zero forensics, and live what-if controls." />
        {:else if session.activeTab === '3d'}
          {#if hasGps}
            <TabPlaceholder title="3D Flight Replay" phase="Phase 4"
              note="Three.js replay of the GPS + altitude path with a moving aircraft, synced to this timeline." />
          {:else}
            <TabPlaceholder title="3D Flight Replay" phase="No GPS"
              note="No valid GPS path in this session — 3D replay is unavailable." />
          {/if}
        {:else}
          {#if hasGps}
            <TabPlaceholder title="Map Ground Track" phase="Phase 4"
              note="MapLibre ground track colored by phase, linked to the shared cursor." />
          {:else}
            <TabPlaceholder title="Map Ground Track" phase="No GPS"
              note="No valid GPS fixes — map view is unavailable." />
          {/if}
        {/if}
      </main>
    </div>
    <Timeline />
  </div>
{/if}

<style>
  .app { display: flex; flex-direction: column; height: 100%; }
  .body { flex: 1; display: flex; min-height: 0; }
  .rail {
    width: 360px; flex-shrink: 0; overflow-y: auto;
    padding: 12px; border-right: 1px solid var(--border);
  }
  .content { flex: 1; padding: 12px; overflow: auto; min-width: 0; }
  @media (max-width: 820px) {
    .body { flex-direction: column; }
    .rail { width: auto; border-right: none; border-bottom: 1px solid var(--border); max-height: 45%; }
  }
</style>
