import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  // Relative base so the built site works under any path prefix, including
  // GitHub Pages project URLs like https://<user>.github.io/<repo>/.
  base: './',
  define: {
    __BUILD_SHA__: JSON.stringify(gitShortSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: { port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
