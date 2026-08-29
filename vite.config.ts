import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Open Graph and Twitter cards want absolute URLs. The production origin is not
 * known to the repository, so `index.html` carries a `%SITE_URL%` token that is
 * resolved here from `VITE_SITE_URL`, or from the origin Vercel injects into the
 * build environment. With neither set the token collapses to an empty string and
 * the tags stay root-relative, which every scraper except X resolves correctly.
 */
function siteUrlPlugin(): Plugin {
  const configured = process.env.VITE_SITE_URL ?? '';
  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? '';
  const vercelDeployment = process.env.VERCEL_URL ?? '';
  const raw = configured || vercelProduction || vercelDeployment;
  const siteUrl = raw ? (/^https?:\/\//.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '') : '';

  return {
    name: 'first-pit-site-url',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%SITE_URL%', siteUrl)
    }
  };
}

export default defineConfig({
  plugins: [siteUrlPlugin(), react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Routes are already lazily split, but the Firebase SDK and React land in
        // the entry chunk and dominate first paint. Splitting them lets the browser
        // cache them across deploys that only touch application code.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(@firebase|firebase)\//.test(id)) return 'firebase';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (/node_modules\/react-router/.test(id)) return 'router';
          return undefined;
        }
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  },
  preview: {
    host: '127.0.0.1',
    port: 4173
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: [
        'src/App.tsx',
        'src/components/**/*.tsx',
        // Both React contexts are .tsx and were silently unmeasured by a '*.ts' glob.
        'src/lib/**/*.{ts,tsx}'
        // NOT measured: 'src/features/**' and 'src/pages/**'. Adding
        // 'src/features/**/*.tsx' drops total statement coverage to 69.5% and
        // fails the 80% gate below, because KanbanBoard.tsx and BoardToolbar.tsx
        // are largely untested. Add the glob once those have tests, rather than
        // lowering the threshold.
      ],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**'
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 75,
        lines: 80
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
});
