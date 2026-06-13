<script lang="ts">
  let { title, phase, note }: { title: string; phase: string; note: string } = $props();
</script>

<div class="ph card">
  <h2>{title}</h2>
  <p class="badge warn">{phase}</p>
  <p class="dim">{note}</p>
</div>

<style>
  .ph { display: grid; place-content: center; text-align: center; gap: 12px; height: 100%; }
  h2 { margin: 0; }
</style>
