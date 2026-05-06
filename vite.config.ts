import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works under any path prefix, including
  // GitHub Pages project URLs like https://<user>.github.io/<repo>/.
  base: './',
  server: { port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
