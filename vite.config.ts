import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE_FILE=1 vite build → self-contained dist/index.html (design_doc §2 option 2)
const single = process.env.SINGLE_FILE === '1';

export default defineConfig({
  base: './',
  plugins: [svelte(), ...(single ? [viteSingleFile()] : [])],
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 4000,
  },
});
